import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { analyzeContract } from '../src/server/analysis.js';
import type { PageRecord } from '../src/shared/types.js';

const pages: PageRecord[] = [{
  pageNumber: 1,
  source: 'pdf',
  confidence: null,
  text: '第四条 付款方式\n验收后 10 个工作日内支付。\n第五条 违约责任\n责任上限为合同总额。\n第六条 争议解决\n由上海仲裁委员会仲裁。',
}];

const clausesJson = JSON.stringify({
  clauses: [
    { type: 'payment', originalText: '验收后 10 个工作日内支付。', pageNumber: 1, summary: '付款' },
    { type: 'liability', originalText: '责任上限为合同总额。', pageNumber: 1, summary: '责任' },
    { type: 'jurisdiction', originalText: '由上海仲裁委员会仲裁。', pageNumber: 1, summary: '管辖' },
  ],
});

async function withStub(handler: (body: any, response: import('node:http').ServerResponse) => void, run: (baseUrl: string) => Promise<void>) {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => handler(raw ? JSON.parse(raw) : {}, response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const previous = { ...process.env };
  process.env.ANALYSIS_PROVIDER = 'openai-compatible';
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';
  try {
    await run(process.env.LLM_BASE_URL);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = previous;
  }
}

test('proxies that reject response_format still work through the fallback retry', async () => {
  await withStub((body, response) => {
    if (body.response_format) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'response_format is not supported' } }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: clausesJson } }] }));
  }, async () => {
    const clauses = await analyzeContract(pages);
    assert.equal(clauses.length, 3);
    assert.ok(clauses.every((clause) => clause.matchStatus === 'matched'));
  });
});

test('upstream errors surface the provider message instead of a bare status code', async () => {
  await withStub((_body, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'invalid api key' } }));
  }, async () => {
    await assert.rejects(analyzeContract(pages), (error: Error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /invalid api key/);
      return true;
    });
  });
});
