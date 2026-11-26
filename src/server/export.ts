import ExcelJS from 'exceljs';
import { clauseTypeLabels } from '../shared/types.js';
import type { DocumentDetail, ReviewStatus, RiskLevel } from '../shared/types.js';

const riskLabels: Record<RiskLevel, string> = { none: '未命中规则', low: '关注', medium: '中风险', high: '高风险' };
const reviewLabels: Record<ReviewStatus, string> = { pending: '待复核', confirmed: '已确认', rejected: '已标记误判' };
const matchLabels = { matched: '已定位', review: '待核对原文', missing: '未识别到条款' } as const;

export function safeCellText(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function buildExport(detail: DocumentDetail): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '析约 · 合同条款复核工作台';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('条款复核', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '条款类型', key: 'type', width: 14 },
    { header: '原文页码', key: 'page', width: 10 },
    { header: '定位状态', key: 'match', width: 16 },
    { header: '条款原文', key: 'original', width: 60 },
    { header: '条款摘要', key: 'summary', width: 36 },
    { header: '风险等级', key: 'risk', width: 14 },
    { header: '风险说明', key: 'rationale', width: 58 },
    { header: '复核建议', key: 'suggestion', width: 48 },
    { header: '命中演示规则', key: 'rules', width: 32 },
    { header: '人工状态', key: 'review', width: 14 },
    { header: '是否编辑', key: 'edited', width: 10 },
  ];
  sheet.autoFilter = { from: 'A1', to: 'K1' };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Microsoft YaHei' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E6472' } };
    cell.alignment = { vertical: 'middle' };
  });
  for (const clause of detail.clauses) {
    const ruleTitles = clause.matchedRuleIds.map((id) => detail.rules.find((rule) => rule.id === id)?.title || id).join('；');
    const row = sheet.addRow({
      type: clauseTypeLabels[clause.type], page: clause.pageNumber ?? '—', match: matchLabels[clause.matchStatus],
      original: safeCellText(clause.originalText), summary: safeCellText(clause.summary), risk: riskLabels[clause.riskLevel],
      rationale: safeCellText(clause.riskRationale), suggestion: safeCellText(clause.suggestion), rules: safeCellText(ruleTitles),
      review: reviewLabels[clause.reviewStatus], edited: clause.isEdited ? '是' : '否',
    });
    row.height = 72;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF26363D' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E0E2' } } };
    });
    if (clause.riskLevel === 'high') row.getCell('risk').font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FF9B4038' } };
    if (clause.matchStatus !== 'matched') row.getCell('match').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4DE' } };
  }

  const notes = workbook.addWorksheet('说明');
  notes.columns = [{ width: 24 }, { width: 90 }];
  const rows = [
    ['项目', '析约 · 合同条款提取与风险复核工作台'],
    ['源文件', safeCellText(detail.document.name)],
    ['分析模式', detail.document.analyzer === 'demo' ? '内置演示分析（非真实模型评测）' : 'OpenAI 兼容模型接口'],
    ['导出时间', new Date().toISOString()],
    ['重要说明', '本表仅用于辅助审查，不构成法律意见。未命中规则不代表不存在风险。'],
    ['规则来源', '项目自定义演示规则，未作为权威法律依据使用。'],
  ];
  rows.forEach((values) => notes.addRow(values));
  notes.getColumn(1).font = { bold: true, name: 'Microsoft YaHei' };
  notes.eachRow((row) => { row.height = 30; row.getCell(2).alignment = { wrapText: true, vertical: 'middle' }; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
