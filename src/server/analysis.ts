import { z } from 'zod';
import { db } from './db.js';
import { CLAUSE_TYPES, clauseTypeLabels } from '../shared/types.js';
import type { ClauseType, MatchStatus, PageRecord, ReviewRule, RiskLevel } from '../shared/types.js';

export interface AnalyzedClause {
  type: ClauseType;
  originalText: string;
  pageNumber: number | null;
  summary: string;
  riskLevel: RiskLevel;
  riskRationale: string;
  suggestion: string;
  matchedRuleIds: string[];
  matchStatus: MatchStatus;
}

const modelOutputSchema = z.object({
  clauses: z.array(z.object({
    type: z.enum(CLAUSE_TYPES),
    originalText: z.string().min(2).max(10_000),
    pageNumber: z.number().int().positive().nullable(),
    summary: z.string().max(1000),
  })).max(30),
});

const patterns: Record<ClauseType, RegExp> = {
  payment: /(?:付款方式|付款条款|支付方式|合同价款|费用与支付|服务费)/,
  liability: /(?:违约责任|违约金|赔偿责任|责任承担)/,
  jurisdiction: /(?:争议解决|争议管辖|管辖条款|仲裁委员会|人民法院)/,
};

const suggestions: Record<ClauseType, string> = {
  payment: '请结合交易安排核对付款节点、金额、验收条件和发票要求，必要时补充明确期限。',
  liability: '请由业务人员核对双方责任、赔偿范围及责任上限；涉及免责或责任不对等时建议重点复核。',
  jurisdiction: '请核对争议解决方式、机构名称和地点是否清晰，并评估实际争议处理成本。',
};

export function normalizeForMatch(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '').replace(/[“”‘’]/g, '"');
}

export function locateOriginalText(pages: PageRecord[], originalText: string, hintedPage: number | null) {
  const needle = normalizeForMatch(originalText);
  if (needle.length < 2) return { pageNumber: null, matchStatus: 'review' as const };
  const ordered = hintedPage ? [...pages].sort((a, b) => Number(b.pageNumber === hintedPage) - Number(a.pageNumber === hintedPage)) : pages;
  const page = ordered.find((candidate) => normalizeForMatch(candidate.text).includes(needle));
  return page
    ? { pageNumber: page.pageNumber, matchStatus: 'matched' as const }
    : { pageNumber: null, matchStatus: 'review' as const };
}

function ruleRows(type: ClauseType): ReviewRule[] {
  return (db.prepare('SELECT * FROM review_rules WHERE type = ? AND enabled = 1').all(type) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), type, title: String(row.title), content: String(row.content),
    defaultRisk: row.default_risk as RiskLevel, source: String(row.source),
  }));
}

function matchesRule(id: string, text: string): boolean {
  switch (id) {
    case 'payment-due-date': return !/\d+\s*(?:个?工作日|日|天)|每月|一次性/.test(text) || /适时|另行协商/.test(text);
    case 'payment-trigger': return /验收|审批|第三方|付款条件/.test(text);
    case 'payment-prepay': return /预付|全额支付|100%/.test(text);
    case 'liability-balance': return /单方|全部损失|责任不对等|仅乙方|仅甲方/.test(text);
    case 'liability-cap': return !/责任上限|不超过|责任限额/.test(text);
    case 'liability-exemption': return /不承担任何|概不负责|免除.{0,12}责任|单方免责/.test(text);
    case 'jurisdiction-ambiguous': return /有管辖权的人民法院|相关法院|任意.{0,8}法院|或.{0,12}仲裁/.test(text);
    case 'jurisdiction-location': return /人民法院|仲裁委员会/.test(text);
    default: return false;
  }
}

export function assessClause(type: ClauseType, originalText: string, missing = false) {
  const rules = ruleRows(type).filter((rule) => {
    if (missing) return rule.id === `${type}-missing` || (type === 'payment' && rule.id === 'payment-due-date') || (type === 'liability' && rule.id === 'liability-cap');
    return matchesRule(rule.id, originalText);
  });
  const weight: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };
  const riskLevel = rules.reduce<RiskLevel>((highest, rule) => weight[rule.defaultRisk] > weight[highest] ? rule.defaultRisk : highest, 'none');
  return {
    matchedRuleIds: rules.map((rule) => rule.id),
    riskLevel,
    riskRationale: rules.length
      ? rules.map((rule) => `命中「${rule.title}」：${rule.content}`).join('\n')
      : '未命中项目内置的演示规则；这不代表条款不存在风险，请人工复核。',
    suggestion: suggestions[type],
  };
}

function demoExtract(pages: PageRecord[], type: ClauseType) {
  for (const page of pages) {
    const match = patterns[type].exec(page.text);
    if (!match || match.index === undefined) continue;
    const start = match.index;
    const remainder = page.text.slice(start);
    const nextSection = remainder.slice(match[0].length).search(/\n\s*(?:第[一二三四五六七八九十百]+条|\d+[、.])/);
    const end = nextSection >= 0 ? match[0].length + nextSection : Math.min(remainder.length, 800);
    const originalText = remainder.slice(0, end).trim();
    return { type, originalText, pageNumber: page.pageNumber, summary: `${clauseTypeLabels[type]}：${originalText.slice(0, 100)}${originalText.length > 100 ? '…' : ''}` };
  }
  return null;
}

function missingClause(type: ClauseType): AnalyzedClause {
  return {
    type, originalText: '', pageNumber: null,
    summary: `未识别到明确的${clauseTypeLabels[type]}，请人工检查原文。`,
    ...assessClause(type, '', true), matchStatus: 'missing',
  };
}

function withEvidence(candidate: { type: ClauseType; originalText: string; pageNumber: number | null; summary: string }, pages: PageRecord[]): AnalyzedClause {
  const location = locateOriginalText(pages, candidate.originalText, candidate.pageNumber);
  return { ...candidate, ...location, ...assessClause(candidate.type, candidate.originalText) };
}

function chunkPages(pages: PageRecord[], limit = 6000): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const page of pages) {
    const content = `\n[第 ${page.pageNumber} 页]\n${page.text}`;
    if (current && current.length + content.length > limit) {
      chunks.push(current);
      current = '';
    }
    current += content;
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseModelContent(content: string) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return modelOutputSchema.parse(JSON.parse(cleaned));
}

async function analyzeChunkWithLlm(chunk: string) {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, '');
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error('真实模型模式需要配置 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL。');
  const prompt = `从合同文本中提取付款、违约责任、争议管辖条款。仅返回 JSON：{"clauses":[{"type":"payment|liability|jurisdiction","originalText":"逐字原文","pageNumber":1,"summary":"简短摘要"}]}。originalText 不得改写；页码以文本中的页标记为准；没有发现的类型不要编造。`;

  async function call(useResponseFormat: boolean) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, temperature: 0,
        ...(useResponseFormat ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: prompt }, { role: 'user', content: chunk }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      // Surface the upstream message so a 400 can be diagnosed without reading server logs.
      const detail = (await response.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      const error = new Error(`模型接口返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型接口未返回文本内容');
    return parseModelContent(content).clauses;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // Many OpenAI-compatible proxies reject response_format; retry without it once.
      return await call(attempt === 0);
    } catch (error) {
      lastError = error;
      if ((error as { status?: number }).status !== 400) continue;
    }
  }
  throw new Error(`模型分析失败：${lastError instanceof Error ? lastError.message : '输出格式无效'}`);
}


export async function analyzeContract(pages: PageRecord[]): Promise<AnalyzedClause[]> {
  const provider = process.env.ANALYSIS_PROVIDER || 'demo';
  const candidates = provider === 'demo'
    ? CLAUSE_TYPES.map((type) => demoExtract(pages, type)).filter((item) => item !== null)
    : (await Promise.all(chunkPages(pages).map(analyzeChunkWithLlm))).flat();
  const analyzed = candidates.map((candidate) => withEvidence(candidate, pages));
  const result = CLAUSE_TYPES.flatMap((type) => {
    const matches = analyzed.filter((clause) => clause.type === type);
    return matches.length ? matches : [missingClause(type)];
  });
  const seen = new Set<string>();
  return result.filter((clause) => {
    const key = `${clause.type}:${normalizeForMatch(clause.originalText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
