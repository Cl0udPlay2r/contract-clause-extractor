import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOcrResponse } from '../src/server/extraction.js';

test('OCR response is normalized and retains confidence', () => {
  const pages = parseOcrResponse({ pages: [{ pageNumber: 1, text: '演示条款', confidence: 0.91 }] });
  assert.deepEqual(pages, [{ pageNumber: 1, text: '演示条款', source: 'ocr', confidence: 0.91 }]);
});

test('invalid OCR responses are rejected instead of entering analysis', () => {
  assert.throws(() => parseOcrResponse({ pages: [] }));
  assert.throws(() => parseOcrResponse({ pages: [{ pageNumber: 0, text: 'bad', confidence: 2 }] }));
});
