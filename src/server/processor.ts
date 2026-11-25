import { resolve } from 'node:path';
import { analyzeContract } from './analysis.js';
import { extractDocumentText } from './extraction.js';
import { getDocument, saveAnalysis, savePages, setDocumentState } from './repository.js';

const running = new Set<string>();

async function processDocument(id: string) {
  const document = getDocument(id);
  if (!document) return;
  try {
    setDocumentState(id, 'extracting_text', 15);
    const filePath = resolve(process.env.UPLOAD_DIR || './uploads', document.storedName);
    const pages = await extractDocumentText(filePath, document.mime);
    if (!pages.some((page) => page.text.trim())) throw new Error('没有提取到可分析的文字，请检查文件质量。');
    savePages(id, pages);
    setDocumentState(id, 'analyzing', 55);
    const clauses = await analyzeContract(pages);
    saveAnalysis(id, clauses);
  } catch (error) {
    const message = error instanceof Error ? error.message : '文档处理失败，请重试。';
    setDocumentState(id, 'failed', 0, message.slice(0, 600));
  }
}

export function startProcessing(id: string) {
  if (running.has(id)) return;
  running.add(id);
  // ponytail: in-process execution is enough for the demo; use a durable queue for multi-process production.
  void processDocument(id).finally(() => running.delete(id));
}
