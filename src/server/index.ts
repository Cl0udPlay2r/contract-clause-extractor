import './env.js';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { locateOriginalText } from './analysis.js';
import { buildExport } from './export.js';
import { markInterruptedJobs, getDocument, getDocumentDetail, getClause, getPages, insertDocument, listDocuments, setDocumentState, updateClause } from './repository.js';
import { startProcessing } from './processor.js';

const uploadDir = resolve(process.env.UPLOAD_DIR || './uploads');
mkdirSync(uploadDir, { recursive: true });
const maxBytes = Number(process.env.MAX_FILE_MB || 12) * 1024 * 1024;
const allowedExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } });

export function decodeUploadName(name: string) {
  // Busboy decodes multipart filenames as latin1, so UTF-8 names arrive mojibaked.
  // Re-decode only when the latin1 bytes form valid UTF-8; otherwise keep the original.
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const recovered = Buffer.from(name, 'latin1').toString('utf8');
  return recovered.includes('\ufffd') ? name : recovered;
}

export function safeOriginalName(name: string) {
  return basename(decodeUploadName(name)).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || '未命名合同';
}

export function hasValidSignature(buffer: Buffer, extension: string) {
  if (extension === '.pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === '.webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  return false;
}

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
markInterruptedJobs();

export const llmConfigured = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, analysisProvider: process.env.ANALYSIS_PROVIDER || 'demo', llmConfigured });
});
app.get('/api/documents', (_request, response) => response.json({ documents: listDocuments() }));
app.get('/api/documents/:id', (request, response) => {
  const detail = getDocumentDetail(request.params.id);
  if (!detail) return response.status(404).json({ error: '文档不存在。' });
  response.json(detail);
});

app.post('/api/documents', upload.single('file'), (request, response) => {
  const file = request.file;
  if (!file) return response.status(400).json({ error: '请选择一份 PDF 或图片。' });
  const extension = extname(basename(file.originalname)).toLowerCase();
  if (!allowedExtensions.has(extension) || !hasValidSignature(file.buffer, extension)) {
    return response.status(415).json({ error: '文件内容或格式不受支持。仅支持 PDF、PNG、JPG、JPEG、WebP。' });
  }
  const storedName = `${randomUUID()}${extension}`;
  const filePath = resolve(uploadDir, storedName);
  writeFileSync(filePath, file.buffer, { flag: 'wx' });
  try {
    const document = insertDocument({ name: safeOriginalName(file.originalname), storedName, mime: file.mimetype, size: file.size });
    startProcessing(document.id);
    response.status(202).json({ document });
  } catch (error) {
    unlinkSync(filePath);
    throw error;
  }
});

app.get('/api/documents/:id/export', async (request, response) => {
  const detail = getDocumentDetail(request.params.id);
  if (!detail) return response.status(404).json({ error: '文档不存在。' });
  if (detail.document.status !== 'completed') return response.status(409).json({ error: '分析完成后才能导出。' });
  const buffer = await buildExport(detail);
  const baseName = detail.document.name.replace(/\.[^.]+$/, '').slice(0, 80) || '合同复核结果';
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('Content-Disposition', `attachment; filename="contract-review.xlsx"; filename*=UTF-8''${encodeURIComponent(`${baseName}-复核结果.xlsx`)}`);
  response.send(buffer);
});
app.post('/api/documents/:id/retry', (request, response) => {
  const document = getDocument(request.params.id);
  if (!document) return response.status(404).json({ error: '文档不存在。' });
  if (document.status !== 'failed') return response.status(409).json({ error: '当前文档不需要重试。' });
  setDocumentState(document.id, 'uploaded', 0);
  startProcessing(document.id);
  response.status(202).json({ document: getDocument(document.id) });
});

const clausePatchSchema = z.object({
  originalText: z.string().max(10_000).optional(),
  pageNumber: z.number().int().positive().nullable().optional(),
  summary: z.string().max(1000).optional(),
  riskLevel: z.enum(['none', 'low', 'medium', 'high']).optional(),
  riskRationale: z.string().max(5000).optional(),
  suggestion: z.string().max(5000).optional(),
  reviewStatus: z.enum(['pending', 'confirmed', 'rejected']).optional(),
}).strict();

app.patch('/api/clauses/:id', (request, response) => {
  const clause = getClause(request.params.id);
  if (!clause) return response.status(404).json({ error: '条款不存在。' });
  const patch = clausePatchSchema.parse(request.body);
  if (patch.originalText !== undefined) {
    const location = locateOriginalText(getPages(clause.documentId), patch.originalText, patch.pageNumber ?? clause.pageNumber);
    patch.pageNumber = location.pageNumber;
    Object.assign(patch, { matchStatus: location.matchStatus });
  }
  response.json({ clause: updateClause(clause.id, patch) });
});

app.use('/api', (_request, response) => response.status(404).json({ error: '接口不存在。' }));
const clientDist = resolve('dist/client');
if (existsSync(resolve(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.use((request, response, next) => {
    if (request.method !== 'GET') return next();
    response.sendFile(resolve(clientDist, 'index.html'));
  });
}
app.use((_request, response) => response.status(404).send('Not found'));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '文件超过大小限制。' : '文件上传失败。' });
  if (error instanceof z.ZodError) return response.status(400).json({ error: '提交的数据格式不正确。' });
  console.error(error instanceof Error ? error.message : 'Unexpected server error');
  response.status(500).json({ error: '服务器处理失败，请重试。' });
});

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 4000);
  app.listen(port, '127.0.0.1', () => {
    const provider = process.env.ANALYSIS_PROVIDER || 'demo';
    console.log(`Contract review server: http://127.0.0.1:${port}`);
    console.log(`Analysis provider: ${provider === 'demo' ? 'demo (内置演示分析器)' : provider}`);
    if (provider === 'demo' && llmConfigured) {
      console.warn('Warning: 检测到 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL，但 ANALYSIS_PROVIDER=demo，仍会使用演示分析器。');
      console.warn('         如需调用真实模型，请在 .env 设置 ANALYSIS_PROVIDER=openai-compatible 后重启。');
    }
    if (provider !== 'demo' && !llmConfigured) {
      console.warn('Warning: 真实模型模式缺少 LLM_BASE_URL、LLM_API_KEY 或 LLM_MODEL，分析会直接失败。');
    }
  });

}
