// Reproduce an existing Clipping SHA without changing source bytes or old receipts.
import crypto from 'node:crypto';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function sourceByteIdentity(bytes, expected, sourcePath) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) throw Error('Invalid expected source SHA-256');
  expected = expected.toLowerCase();
  const actual = sha(bytes);
  const result = {matches: actual === expected, kind: actual === expected ? 'exact_bytes' : 'mismatch', expected_sha256: expected, actual_sha256: actual, replayed_sha256: null};
  if (result.matches || typeof sourcePath !== 'string' || !/^Clippings\/.+\.md$/.test(sourcePath) || sourcePath.includes('\\') || sourcePath.split('/').some(p => ['', '.', '..'].includes(p))) return result;
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); } catch { return result; }
  // Preserve BOM, final newline, spaces, Unicode form, and every non-EOL byte.
  if (!text.includes('\n') || /\r(?!\n)/.test(text)) return result;
  let candidate, kind;
  if (!text.includes('\r')) { candidate = text.replaceAll('\n', '\r\n'); kind = 'lf_to_crlf'; }
  else if (!/(?<!\r)\n/.test(text)) { candidate = text.replaceAll('\r\n', '\n'); kind = 'crlf_to_lf'; }
  else return result;
  result.replayed_sha256 = sha(Buffer.from(candidate, 'utf8'));
  if (result.replayed_sha256 === expected) { result.matches = true; result.kind = kind; }
  return result;
}
