/** Derive a technical identity map only from a fully verified accepted public snapshot. */
import {acceptedManifest} from '../sync/clients.mjs';
import {principleIdsFromText} from '../query/query-evidence.mjs';
import {researchSnapshotSources} from './research-reports.mjs';
import {queryPackageDigest} from './query-package.mjs';

/** Inputs are already approved identity tables. TTL/control remains package-owned. */
export function mergeQueryPackageSnapshotCatalog(previous,current){
  if(!Array.isArray(previous)||!Array.isArray(current))throw Error('Approved snapshot tables required');
  const snapshots=new Map();
  for(const entry of [...previous,...current]){
    if(!entry||typeof entry.snapshot_id!=='string'||typeof entry.manifest_sha256!=='string'||!entry.sources||typeof entry.sources!=='object'||Array.isArray(entry.sources))throw Error('Invalid approved snapshot identity');
    const prior=snapshots.get(entry.snapshot_id);
    if(prior&&queryPackageDigest(prior)!==queryPackageDigest(entry))throw Error('Approved snapshot identity conflict');
    snapshots.set(entry.snapshot_id,structuredClone(entry));
  }
  return [...snapshots.values()];
}

export function buildQueryPackageSnapshotCatalog(publicationConfig,{previousSnapshots=[]}={}) {
  const {manifest, manifestSha, objects} = acceptedManifest(publicationConfig);
  const sources = {};
  function add(ref, version) {
    if (sources[ref] !== undefined && sources[ref] !== version) throw Error('Ambiguous public source identity ' + ref);
    sources[ref] = version;
  }
  for (const entry of manifest.entries) {
    if ((entry.access??'query')!=='query') continue;
    if (!entry.path.endsWith('.md')) continue;
    const kind = {wiki:'wiki',raw:'raw',domain:'domain',group:'group',clipping:'clipping'}[entry.kind];
    if (!kind) continue;
    const name = entry.path.split('/').slice(1).join('/');
    add('knowledge:' + kind + ':' + name.slice(0, -3), entry.sha256);
    add('knowledge:' + kind + ':' + name, entry.sha256);
    if (entry.path.startsWith('domains/')) {
      for (const id of principleIdsFromText(objects.get(entry.sha256).toString('utf8'))) add('knowledge:principle:' + id, entry.sha256);
    }
  }
  for(const unit of researchSnapshotSources({manifest,readObject:sha=>objects.get(sha)}))add(unit.ref,unit.source_sha256);
  return mergeQueryPackageSnapshotCatalog(previousSnapshots,[{snapshot_id: manifest.snapshot_id, manifest_sha256: manifestSha, sources}]);
}
