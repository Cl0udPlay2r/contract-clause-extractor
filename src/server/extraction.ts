import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { z } from 'zod';
import type { PageRecord } from '../shared/types.js';

const ocrResponseSchema = z.object({
  pages: z.array(z.object({
    pageNumber: z.number().int().positive(),
    text: z.string(),
    confidence: z.number().min(0).max(1).nullable(),
  })).min(1),
});

export async function extractPdfText(filePath: string): Promise<PageRecord[]> {
  const data = new Uint8Array(await readFile(filePath));
  const task = getDocument({ data, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const pages: PageRecord[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => {
        if (!('str' in item)) return '';
        return item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ');
      }).join('').trim();
      pages.push({ pageNumber, text, source: 'pdf', confidence: null });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

export function parseOcrResponse(input: unknown): PageRecord[] {
  return ocrResponseSchema.parse(input).pages.map((page) => ({ ...page, source: 'ocr' as const }));
}

async function requestOcr(filePath: string, mime: string): Promise<PageRecord[]> {
  const url = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:4100/ocr';
  const form = new FormData();
  const buffer = await readFile(filePath);
  form.append('file', new Blob([buffer], { type: mime }), `document${extname(filePath)}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(Number(process.env.OCR_TIMEOUT_MS || 120_000)),
    });
  } catch {
    throw new Error('OCR 服务不可用。扫描件和图片需要先启动本地 OCR 服务。');
  }
  if (!response.ok) throw new Error(`OCR 服务处理失败（HTTP ${response.status}）。`);
  return parseOcrResponse(await response.json());
}

export async function extractDocumentText(filePath: string, mime: string): Promise<PageRecord[]> {
  const isPdf = extname(filePath).toLowerCase() === '.pdf';
  if (isPdf) {
    const pages = await extractPdfText(filePath);
    const textLength = pages.reduce((sum, page) => sum + page.text.replace(/\s/g, '').length, 0);
    if (textLength >= 20) return pages;
  }
  return requestOcr(filePath, mime);
}
