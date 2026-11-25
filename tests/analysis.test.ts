import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeContract, locateOriginalText, normalizeForMatch } from '../src/server/analysis.js';
import type { PageRecord } from '../src/shared/types.js';

const pages: PageRecord[] = [{
  pageNumber: 1,
  source: 'pdf',
  confidence: null,
  text: '第四条 付款方式\n甲方应在验收后 10 个工作日内支付服务费。\n第五条 违约责任\n任何一方违约，应赔偿守约方损失，责任上限为合同总额。\n第六条 争议解决\n双方争议由上海市有管辖权的人民法院管辖。',
}];

test('whitespace-insensitive evidence matching locates the actual page', () => {
  assert.equal(normalizeForMatch(' 付款 方式 '), '付款方式');
  assert.deepEqual(locateOriginalText(pages, '甲方应在验收后 10 个工作日内支付服务费。', null), { pageNumber: 1, matchStatus: 'matched' });
  assert.equal(locateOriginalText(pages, '模型改写的条款', 1).matchStatus, 'review');
});

test('demo analysis produces three traceable clauses', async () => {
  const clauses = await analyzeContract(pages);
  assert.equal(clauses.length, 3);
  assert.ok(clauses.every((clause) => clause.matchStatus === 'matched'));
  assert.ok(clauses.find((clause) => clause.type === 'jurisdiction')?.matchedRuleIds.includes('jurisdiction-ambiguous'));
});

test('missing clauses stay explicit and do not invent source text', async () => {
  const clauses = await analyzeContract([{ ...pages[0], text: '第一条 服务内容\n仅提供演示服务。' }]);
  const payment = clauses.find((clause) => clause.type === 'payment');
  assert.equal(payment?.matchStatus, 'missing');
  assert.equal(payment?.originalText, '');
});
