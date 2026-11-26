import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildExport, safeCellText } from '../src/server/export.js';
import { analyzeContract } from '../src/server/analysis.js';
import { getDocumentDetail, insertDocument, saveAnalysis, savePages } from '../src/server/repository.js';

test('export text cannot become an accidental spreadsheet formula', () => {
  assert.equal(safeCellText('=HYPERLINK("bad")'), '\'=HYPERLINK("bad")');
  assert.equal(safeCellText('普通条款'), '普通条款');
});

test('workbook preserves clause and review states', async () => {
  const document = insertDocument({ name: '合成测试合同.pdf', storedName: 'test-only.pdf', mime: 'application/pdf', size: 100 });
  const pages = [{ pageNumber: 1, source: 'pdf' as const, confidence: null, text: '第四条 付款方式\n验收后 10 个工作日内支付。\n第五条 违约责任\n责任上限为合同总额。\n第六条 争议解决\n由上海市有管辖权的人民法院管辖。' }];
  savePages(document.id, pages);
  saveAnalysis(document.id, await analyzeContract(pages));
  const buffer = await buildExport(getDocumentDetail(document.id)!);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['条款复核', '说明']);
  assert.equal(workbook.getWorksheet('条款复核')!.rowCount, 4);
  assert.equal(workbook.getWorksheet('说明')!.getCell('B1').value, '析约 · 合同条款提取与风险复核工作台');
});
