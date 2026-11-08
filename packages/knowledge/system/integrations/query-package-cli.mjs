import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createQueryPackageInbox} from './query-package-local.mjs';

/** Config is installed by the local owner, never supplied in a transported package. */
export async function runQueryPackageLocal(action, input, config) {
  if (config?.enabled !== true) return {status: 'disabled', acknowledged: false};
  const inbox = await createQueryPackageInbox(config);
  if (action === 'receive') return inbox.receive(input, {trustedTransport: config.trustedTransportConfirmed === true});
  if (action === 'pending') return {status: 'selected', packages: inbox.pending(input)};
  if (action === 'read') return inbox.read(input.package_id);
  if (action === 'assess') return inbox.assess(input);
  if (action === 'prepare-public-records') return inbox.preparePublicRecords(input);
  if (action === 'export-results') return inbox.exportResults({publicTransferAllowed: config.publicTransferAllowed === true});
  if (action === 'maintain') return inbox.maintain();
  throw Error('Unknown query package action');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [action, configPath, inputPath] = process.argv.slice(2);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    const input = JSON.parse(fs.readFileSync(inputPath === '-' ? 0 : inputPath, 'utf8').replace(/^\uFEFF/, ''));
    console.log(JSON.stringify(await runQueryPackageLocal(action, input, config)));
  } catch (error) {
    console.error(JSON.stringify({status: 'rejected', acknowledged: false, reason: error.code ?? error.message}));
    process.exitCode = 2;
  }
}
