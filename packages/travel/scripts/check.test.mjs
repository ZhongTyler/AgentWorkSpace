import assert from 'node:assert/strict';
import path from 'node:path';
import { checkMarkdown, headingAnchors } from './check.mjs';

const file = path.resolve('fixture/readme.md');
const child = path.resolve('fixture/child.md');
const io = {
  existsSync: p => [file, child].includes(p),
  readFileSync: () => '# 可读标题\n\n# 可读标题\n',
};
assert.equal(checkMarkdown(file, '[OK](child.md#可读标题)', io).errors.length, 0);
assert.equal(checkMarkdown(file, '[OK](<child.md#可读标题-1>)', io).errors.length, 0);
assert.match(checkMarkdown(file, '[bad](missing.md)', io).errors[0], /missing target/);
assert.match(checkMarkdown(file, '[bad](child.md#no-such-heading)', io).errors[0], /missing heading/);
assert.match(checkMarkdown(file, '[bad](%XY)', io).errors[0], /invalid URL encoding/);
assert.equal(checkMarkdown(file, '[net](https://example.com/a) [template]({{path}})', io).localLinks, 0);
assert.equal(checkMarkdown(file, '~~~md\n[example](missing.md)\n~~~\n', io).localLinks, 0);
assert.equal(checkMarkdown(file, '\x60[inline](missing.md)\x60', io).localLinks, 0);
assert.equal(checkMarkdown(file, '[self](#当前)\n\n# 当前\n', io).errors.length, 0);
assert.ok(headingAnchors('# One *two*\n# One two\n').has('one-two-1'));
console.log('PASS: 10 local-link and heading checks, including negative cases.');
