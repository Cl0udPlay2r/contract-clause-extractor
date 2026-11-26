import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeContract } from '../src/server/analysis.js';
import { extractPdfText } from '../src/server/extraction.js';

interface Expected { file: string; present: string[] }
const expected = JSON.parse(await readFile('demo/samples/expected.json', 'utf8')) as Expected[];
const results = [];
for (const sample of expected) {
  const pages = await extractPdfText(resolve('demo/samples', sample.file));
  const clauses = await analyzeContract(pages);
  const found = clauses.filter((clause) => clause.matchStatus !== 'missing');
  const expectedFound = sample.present.length;
  const correct = found.filter((clause) => sample.present.includes(clause.type)).length;
  const located = found.filter((clause) => clause.matchStatus === 'matched').length;
  results.push({
    file: sample.file, expectedTypes: expectedFound, foundTypes: found.length, correctTypes: correct,
    recall: expectedFound ? correct / expectedFound : null,
    precision: found.length ? correct / found.length : null,
    evidenceMatchRate: found.length ? located / found.length : null,
  });
}
await mkdir('demo/output', { recursive: true });
await writeFile('demo/output/evaluation.json', JSON.stringify({ mode: 'demo', results }, null, 2));
console.table(results);
