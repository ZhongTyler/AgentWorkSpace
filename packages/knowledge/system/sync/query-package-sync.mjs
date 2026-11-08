/** Named query-package actions on the original authenticated pull-compounding transport. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {requireValue, readJson, atomicJson, namespaceKey, hash, canonical} from './state.mjs';

async function packageModules() {
  const installed = path.join(import.meta.dirname, 'query-package-local.mjs');
  const root = fs.existsSync(installed) ? import.meta.dirname : path.resolve(import.meta.dirname, '../integrations');
  const local = await import(pathToFileURL(path.join(root, 'query-package-local.mjs')));
  const contract = await import(pathToFileURL(path.join(root, 'query-package.mjs')));
  return {...local, ...contract};
}

export async function syncQueryPackages(job, request, {home, toolsRoot, clock = Date.now, receiverFactory} = {}) {
  const config = job.queryPackages;
  if (config?.enabled !== true) return {status: 'disabled', received: 0, acknowledged: 0, resultsAcknowledged: 0, failures: []};
  requireValue(job.retentionPolicyConfirmed === true && job.improvementUseOnLocalConfirmed === true, 'query_package_permission_unconfirmed');
  const maximum = config.maxPackagesPerRun ?? 5;
  requireValue(Number.isSafeInteger(maximum) && maximum >= 1 && maximum <= 20, 'query_package_budget_invalid');
  requireValue(typeof config.snapshotCatalogPath === 'string' && path.isAbsolute(config.snapshotCatalogPath), 'query_package_snapshot_catalog_required');
  const catalogBytes = fs.readFileSync(config.snapshotCatalogPath);
  requireValue(catalogBytes.length <= 8 * 1024 * 1024 && hash(catalogBytes) === config.snapshotCatalogSha256, 'query_package_snapshot_catalog_changed');
  const snapshots = JSON.parse(catalogBytes.toString('utf8').replace(/^\uFEFF/, ''));
  requireValue(Array.isArray(snapshots), 'query_package_snapshot_catalog_invalid');
  const {createQueryPackageInbox, createQueryPackageResults} = await packageModules();
  let received = 0, acknowledged = 0, resultsAcknowledged = 0;
  const failures = [];
  for (const namespace of job.allowedNamespaces) {
    const key = namespaceKey(namespace);
    const privateHome = path.join(home, 'query-packages', key);
    let inbox;
    try {
      inbox = await (receiverFactory ?? createQueryPackageInbox)({home: privateHome, feedbackHome: path.join(home, 'inbox'), namespace, snapshots, toolsRoot, now: clock, tombstoneRetentionMs: job.tombstoneRetentionMs});
      requireValue(!['busy','cursor_conflict'].includes(inbox.maintain().status), 'query_package_receiver_busy');
      for (let count = 0; count < maximum; count++) {
        const cursorFile = path.join(privateHome, 'cursor.json');
        const cursor = readJson(cursorFile, {source_cursor: 0});
        const next = await request('query-package-next', {namespace, after_cursor: cursor.source_cursor});
        requireValue(['package','unchanged'].includes(next?.status) && Number.isSafeInteger(next.source_cursor) && next.source_cursor >= cursor.source_cursor, 'query_package_inventory_invalid');
        if (next.status === 'unchanged') break;
        requireValue(next.source_cursor > cursor.source_cursor && canonical(next.package?.namespace) === canonical(namespace), 'query_package_cursor_conflict');
        const packet = next.package;
        const receiptFile = path.join(privateHome, 'receipts', next.source_cursor + '.json');
        const old = readJson(receiptFile);
        const identity = {namespace, package_id: packet.package_id, revision: packet.revision, manifest_sha256: packet.manifest_sha256, source_cursor: next.source_cursor};
        if (old) requireValue(canonical(old.identity) === canonical(identity), 'query_package_revision_conflict');
        const stored = inbox.receive(packet, {trustedTransport: true});
        requireValue(stored.acknowledged === true, stored.reason ?? 'query_package_not_durable');
        if (!old) {
          atomicJson(receiptFile, {identity, acknowledged: false});
          received++;
        }
        const ack = await request('query-package-ack', identity);
        requireValue(ack?.status === 'acked' && Object.entries(identity).filter(([field]) => field !== 'namespace').every(([field, value]) => ack[field] === value), 'query_package_ack_unconfirmed');
        atomicJson(receiptFile, {identity, acknowledged: true});
        atomicJson(cursorFile, {source_cursor: next.source_cursor, acknowledged_at: new Date(clock()).toISOString()});
        acknowledged++;
      }
    } catch (error) {
      failures.push({namespace: key, code: error.code ?? 'query_package_receive_failed'});
    }
    // Return controls/results even when a new incoming package is temporarily blocked.
    if (inbox && config.publicReturnConfirmed === true) try {
      const exported = inbox.exportResults({publicTransferAllowed: true});
      const rows = [...exported.controls.map(control => ({control})), ...exported.results.map(result => ({result}))];
      const frames = [];
      for (let offset = 0; offset < rows.length; offset += 20) {
        const batch = rows.slice(offset, offset + 20);
        frames.push(createQueryPackageResults({namespace, controls: batch.filter(row => row.control).map(row => row.control), results: batch.filter(row => row.result).map(row => row.result)}));
      }
      let returned = 0;
      for (const frame of frames) {
        const receiptFile = path.join(privateHome, 'results', frame.manifest_sha256 + '.json');
        if (readJson(receiptFile)?.acknowledged === true) continue;
        if (returned >= maximum) break;
        const ack = await request('query-package-results', frame);
        requireValue(ack?.status === 'acked' && ack.manifest_sha256 === frame.manifest_sha256, 'query_package_results_unconfirmed');
        atomicJson(receiptFile, {manifest_sha256: frame.manifest_sha256, acknowledged: true, at: new Date(clock()).toISOString()});
        resultsAcknowledged++;
        returned++;
      }
    } catch (error) {
      failures.push({namespace: key, code: error.code ?? 'query_package_return_failed'});
    }
  }
  return {status: failures.length ? 'partial' : received || resultsAcknowledged ? 'synchronized' : 'unchanged', received, acknowledged, resultsAcknowledged, failures};
}
