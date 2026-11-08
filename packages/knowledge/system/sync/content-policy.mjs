// Shared publication admission only. An accepted path grants no download route.
const nativePath = /^(wiki|raw-sources|domains|groups|domain-groups|Clippings|assets|attachments)\//;
const nativeExtension = /\.(md|txt|png|jpe?g|webp|gif|pdf)$/i;
const researchExtension = /\.(md|txt|json|png|jpe?g|webp|gif|pdf|svg|mp4|webm|mov|m4v|mp3|ogg|wav|m4a|flac|js|mjs|cjs|css|scss|html|hx|lua|py|xml|zip)$/i;
const queryExtension = /\.(md|txt|png|jpe?g|webp|gif|pdf|svg)$/i;
const groupReceiptPath = value => /^docs\/audits\/raw-fidelity-\d{8}\/full-b\d+-group-[a-z0-9]+(?:-[a-z0-9]+)*\.adjudication\.json$/.test(value);

export function safeContentPath(value) {
 if (typeof value !== 'string' || value.length > 512 || value.normalize('NFC') !== value ||
     /[\\:\x00-\x1f]/.test(value) || /%[a-f0-9]{2}/i.test(value) || value.startsWith('/') ||
     value.split('/').some(part => !part || part === '.' || part === '..')) return false;
 return nativePath.test(value) && nativeExtension.test(value) ||
  value.startsWith('research-reports/') && (researchExtension.test(value) || /\/[^/.]+$/.test(value)) ||
  groupReceiptPath(value);
}

export function validContentAccess(row) {
 if (!row || !safeContentPath(row.path) ||
     row.access !== undefined && !['query', 'private_evidence'].includes(row.access)) return false;
 const privateOnly = groupReceiptPath(row.path) ||
  row.path.startsWith('research-reports/') && !queryExtension.test(row.path);
 return !privateOnly || row.access === 'private_evidence';
}
