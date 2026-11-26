import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
const { hasValidSignature, safeOriginalName } = await import('../src/server/index.js');

test('upload signatures reject extensions alone', () => {
  assert.equal(hasValidSignature(Buffer.from('%PDF-1.7\n'), '.pdf'), true);
  assert.equal(hasValidSignature(Buffer.from('not a pdf'), '.pdf'), false);
  assert.equal(hasValidSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), '.png'), true);
});

test('display filenames cannot inject paths or control characters', () => {
  assert.equal(safeOriginalName('../../demo\u0000.pdf'), 'demo.pdf');
});

test('UTF-8 filenames arrive latin1-decoded and are recovered', () => {
  const mojibake = Buffer.from('测试合同·第一版.pdf', 'utf8').toString('latin1');
  assert.notEqual(mojibake, '测试合同·第一版.pdf');
  assert.equal(safeOriginalName(mojibake), '测试合同·第一版.pdf');
  assert.equal(safeOriginalName('cafe.pdf'), 'cafe.pdf');
  assert.equal(safeOriginalName('café.pdf'), 'café.pdf');
});
