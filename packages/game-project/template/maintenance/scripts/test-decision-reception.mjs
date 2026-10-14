import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDecisionReception, receptionHash } from './check-decision-reception.mjs';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-reception-'));
  const source = '| DEC-001 | Recover HP |\n| DEC-002 | Dispatch resets |\n';
  fs.mkdirSync(path.join(root, 'docs/decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source.md'), source);
  fs.writeFileSync(path.join(root, 'docs/decisions/current.md'), 'Current owner\n');
  const contract = { schema_version: 1, state: 'received', sources: [
    { key: 'BS', path: 'source.md', sha256: receptionHash(source), id_pattern: '^\\| (DEC-\\d+) \\|' }
  ] };
  const rows = [
    '| BS:DEC-001 | inherited | Health reset | [Owner](current.md) | - | Preserve |',
    '| BS:DEC-002 | deferred | Dispatch reset | [Owner](current.md) | - | Next multi-battle slice |'
  ];
  const write = (c = contract, r = rows) => fs.writeFileSync(path.join(root, 'docs/decisions/decision-reception.md'),
    '# Reception\n\n```decision-reception\n' + JSON.stringify(c) + '\n```\n\n' + r.join('\n'));
  try { write(); run({ root, contract, rows, write, source }); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('decision-reception-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('received ledger covers deferred as well as current decisions', () => fixture(({ root }) => {
  assert.deepEqual(checkDecisionReception(root), { errors: [], warnings: [] });
}));
test('empty template is allowed but does not claim acceptance', () => fixture(({ root, write }) => {
  write({ schema_version: 1, state: 'empty', sources: [] }, []);
  const result = checkDecisionReception(root);
  assert.equal(result.errors.length, 0); assert.match(result.warnings.join(), /not an acceptance/);
}));
test('missing prior recovery decision is detected', () => fixture(({ root, write, contract, rows }) => {
  write(contract, rows.slice(1)); assert.match(checkDecisionReception(root).errors.join(), /missing reception: BS:DEC-001/);
}));
test('duplicate and unknown identities are rejected', () => fixture(({ root, write, contract, rows }) => {
  write(contract, [...rows, rows[0], rows[0].replace('DEC-001', 'DEC-999')]);
  const errors = checkDecisionReception(root).errors.join(); assert.match(errors, /duplicate reception/); assert.match(errors, /unknown reception/);
}));
test('source drift is not automatically accepted', () => fixture(({ root, source }) => {
  fs.appendFileSync(path.join(root, 'source.md'), 'Changed scope\n');
  assert.match(checkDecisionReception(root).errors.join(), /source changed/);
  fs.writeFileSync(path.join(root, 'source.md'), source.replace(/\n/g, '\r\n'));
  assert.equal(checkDecisionReception(root).errors.length, 0);
}));
test('new source decision requires a new disposition even after hash refresh', () => fixture(({ root, contract, write, source }) => {
  const updated = source + '| DEC-003 | Bench |\n'; fs.writeFileSync(path.join(root, 'source.md'), updated);
  contract.sources[0].sha256 = receptionHash(updated); write(contract);
  assert.match(checkDecisionReception(root).errors.join(), /missing reception: BS:DEC-003/);
}));
test('scope exception requires replacement evidence', () => fixture(({ root, write, contract, rows }) => {
  write(contract, rows.map(r => r.replace('inherited', 'scoped-change')));
  assert.match(checkDecisionReception(root).errors.join(), /replacement evidence required/);
  write(contract, rows.map(r => r.replace('inherited', 'scoped-change').replace('| - | Preserve', '| [Change](current.md) | Preserve')));
  assert.equal(checkDecisionReception(root).errors.length, 0);
}));
test('deferred needs a resumption condition and invalid disposition fails', () => fixture(({ root, write, contract, rows }) => {
  write(contract, rows.map(r => r.replace('inherited', 'implemented').replace('Next multi-battle slice', '-')));
  const errors = checkDecisionReception(root).errors.join(); assert.match(errors, /invalid reception disposition/); assert.match(errors, /review condition required/);
}));
test('unresolved conflict is visible without blocking unrelated work', () => fixture(({ root, write, contract, rows }) => {
  write(contract, rows.map(r => r.replace('inherited', 'needs-review')));
  const result = checkDecisionReception(root); assert.equal(result.errors.length, 0); assert.match(result.warnings.join(), /before dependent work/);
}));
test('missing source and missing current owner fail', () => fixture(({ root, write, contract, rows }) => {
  write(contract, rows.map(r => r.replace('current.md', 'missing.md')));
  assert.ok(checkDecisionReception(root).errors.length);
  write(); fs.renameSync(path.join(root, 'source.md'), path.join(root, 'saved.md'));
  assert.ok(checkDecisionReception(root).errors.length);
}));
test('empty source ID extraction cannot silently pass', () => fixture(({ root, contract, write }) => {
  contract.sources[0].id_pattern = '^(NOT-A-DECISION)$'; write(contract);
  assert.match(checkDecisionReception(root).errors.join(), /empty\/invalid\/duplicate source/);
}));
test('received without sources and absent reception index fail', () => fixture(({ root, write }) => {
  write({ schema_version: 1, state: 'received', sources: [] }, []);
  assert.match(checkDecisionReception(root).errors.join(), /received requires sources/);
  fs.renameSync(path.join(root, 'docs/decisions/decision-reception.md'), path.join(root, 'saved-index.md'));
  assert.ok(checkDecisionReception(root).errors.length);
}));
