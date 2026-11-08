/** Local owner entry. Uses the original private receiver without starting an Agent or transport. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createQueryPackageInbox} from './query-package-local.mjs';
import {queryPackageDigest} from './query-package.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function readBound(file, maximum = 65536) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || !samePath(fs.realpathSync(file), file)) throw Error('unsafe_owner_binding');
  return fs.readFileSync(file);
}

function installedInbox({home, toolsRoot}) {
  const binding = JSON.parse(readBound(path.join(home, 'online-inbox.json')));
  if (binding.schemaVersion !== 1 || binding.enabled !== true || !path.isAbsolute(binding.configPath)) throw Error('owner_binding_disabled');
  if (!path.isAbsolute(binding.configRoot ?? '')) throw Error('owner_config_root_required');
  const ownerRoot = fs.realpathSync(binding.configRoot);
  const relative = file => path.relative(ownerRoot, file).replaceAll('\\', '/');
  const inside = file => { const value = relative(file); return value && value !== '..' && !value.startsWith('../') && !path.isAbsolute(value); };
  if (!inside(binding.configPath)) throw Error('owner_config_outside_install');
  const bytes = readBound(binding.configPath);
  if (digest(bytes) !== binding.configSha256) throw Error('owner_config_changed');
  const config = JSON.parse(bytes);
  const job = config.jobs?.['pull-compounding'];
  if (config.schemaVersion !== 1 || !samePath(config.toolsRoot, toolsRoot) || job?.enabled !== true || job.retentionPolicyConfirmed !== true || job.improvementUseOnLocalConfirmed !== true) throw Error('owner_permission_unconfirmed');
  if (!path.isAbsolute(config.privateHome) || !inside(config.privateHome) || !samePath(fs.realpathSync(config.privateHome), config.privateHome)) throw Error('owner_private_home_outside_install');
  for (const name of ['core.mjs', 'store.mjs']) {
    if (digest(fs.readFileSync(path.join(toolsRoot, 'integrations/knowledge-feedback', name))) !== binding.coreHashes?.[name]) throw Error('owner_core_changed');
  }
  const namespace = binding.namespace;
  if (!namespace || !['host','library_id','view'].every(key => typeof namespace[key] === 'string' && namespace[key].length > 0)) throw Error('owner_namespace_required');
  if (!job.allowedNamespaces?.some(item => Object.keys(namespace).every(key => item[key] === namespace[key]))) throw Error('owner_namespace_unconfirmed');
  const health = JSON.parse(readBound(path.join(config.privateHome, 'health/pull-compounding.json')));
  const now = Date.now();
  const success = Date.parse(health.lastSuccessAt);
  const attempt = Date.parse(health.at);
  if (health.exitCode !== 0 || !Number.isFinite(success) || !Number.isFinite(attempt) || attempt > now + 300000 || success > now + 300000 || now - success > 3600000) throw Error('owner_sync_health_unavailable');
  return {config, job, namespace};
}

export async function runOwnerQueryPackages({action = 'pending', input = {}, context, home, toolsRoot, terms = [], limit = 3}) {
  if (context?.host !== 'local-agent' || !context.library_id || context.view !== 'local-owner') return null;
  const policy = context.policy;
  if (context.enabled === false || context.knowledge_allowed === false
      || policy?.analysis_allowed !== true || policy?.temporary !== false
      || policy?.retention_confirmed !== true || policy?.withdrawn === true || !policy?.version
      || !Number.isFinite(Date.parse(context.expires_at)) || Date.parse(context.expires_at) <= Date.now()) return null;
  if (!['pending', 'read', 'assess'].includes(action)) throw Error('unknown_owner_package_action');
  if (!Array.isArray(terms) || !terms.every(term => typeof term === 'string') || !Number.isSafeInteger(limit) || limit < 1 || limit > 5) return {status: 'unavailable', packages: [], reason: 'invalid_package_selection'};
  try {
    const localBinding = JSON.parse(readBound(path.join(home, 'online-inbox.json')));
    if (!localBinding.ownerNamespace || !['host','library_id','view'].every(key => localBinding.ownerNamespace[key] === context[key])) return null;
    const {config, job, namespace} = installedInbox({home, toolsRoot});
    const lane = job.queryPackages;
    if (lane?.enabled !== true) return {status: 'disabled', packages: []};
    if (!path.isAbsolute(lane.snapshotCatalogPath)) throw Error('owner_catalog_required');
    const bytes = readBound(lane.snapshotCatalogPath, 8 * 1024 * 1024);
    if (digest(bytes) !== lane.snapshotCatalogSha256) throw Error('owner_catalog_changed');
    const receiver = await createQueryPackageInbox({
      home: path.join(config.privateHome, 'pull-compounding/query-packages', queryPackageDigest(namespace)),
      feedbackHome: path.join(config.privateHome, 'pull-compounding/inbox'),
      namespace,
      snapshots: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')),
      toolsRoot,
      tombstoneRetentionMs: job.tombstoneRetentionMs,
    });
    if (action === 'read') return {status: 'package_read', package: receiver.read(input.package_id), writes: false};
    if (action === 'assess') return receiver.assess(input);
    return {
      status: 'selected', packages: receiver.pending({terms, limit}), owner: 'knowledge',
      trigger: 'current_agent_task', action: 'query_package_read_then_query_package_assess',
      scope: 'summaries_only', writes: false,
    };
  } catch (error) {
    if (action !== 'pending') throw error;
    return {status: 'unavailable', packages: [], reason: 'online_package_inbox_unavailable'};
  }
}
