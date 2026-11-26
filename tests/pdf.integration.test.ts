import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPdfText } from '../src/server/extraction.js';
import { analyzeContract } from '../src/server/analysis.js';

test('two-page synthetic PDF follows the text extraction path', async () => {
  const pages = await extractPdfText('demo/samples/service-contract.pdf');
  assert.equal(pages.length, 2);
  assert.ok(pages.every((page) => page.source === 'pdf'));
  assert.ok(pages[1].text.includes('付款方式'));
});

test('absence of one clause type is preserved in PDF analysis', async () => {
  const pages = await extractPdfText('demo/samples/no-jurisdiction.pdf');
  const clauses = await analyzeContract(pages);
  assert.equal(clauses.find((clause) => clause.type === 'jurisdiction')?.matchStatus, 'missing');
  assert.equal(clauses.filter((clause) => clause.matchStatus === 'matched').length, 2);
});
