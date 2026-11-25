import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import type { AnalyzedClause } from './analysis.js';
import type { DocumentDetail, DocumentRecord, PageRecord, ReviewRule } from '../shared/types.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

export function mapDocument(row: Row): DocumentRecord {
  return {
    id: String(row.id), name: String(row.name), storedName: String(row.stored_name), mime: String(row.mime),
    size: Number(row.size), status: row.status as DocumentRecord['status'], progress: Number(row.progress),
    error: row.error ? String(row.error) : null, pageCount: Number(row.page_count),
    analyzer: row.analyzer ? String(row.analyzer) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function getDocument(id: string) {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Row | undefined;
  return row ? mapDocument(row) : null;
}

export function listDocuments() {
  return (db.prepare('SELECT * FROM documents ORDER BY created_at DESC LIMIT 50').all() as Row[]).map(mapDocument);
}

export function insertDocument(input: { name: string; storedName: string; mime: string; size: number }) {
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO documents
    (id, name, stored_name, mime, size, status, progress, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'uploaded', 0, ?, ?)`)
    .run(id, input.name, input.storedName, input.mime, input.size, timestamp, timestamp);
  return getDocument(id)!;
}

export function setDocumentState(id: string, status: DocumentRecord['status'], progress: number, error: string | null = null) {
  db.prepare('UPDATE documents SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(status, progress, error, now(), id);
}

export function savePages(id: string, pages: PageRecord[]) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM pages WHERE document_id = ?').run(id);
    const insert = db.prepare('INSERT INTO pages (document_id, page_number, text, source, confidence) VALUES (?, ?, ?, ?, ?)');
    for (const page of pages) insert.run(id, page.pageNumber, page.text, page.source, page.confidence);
    db.prepare('UPDATE documents SET page_count = ?, updated_at = ? WHERE id = ?').run(pages.length, now(), id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getPages(id: string): PageRecord[] {
  return (db.prepare('SELECT * FROM pages WHERE document_id = ? ORDER BY page_number').all(id) as Row[]).map((row) => ({
    pageNumber: Number(row.page_number), text: String(row.text), source: row.source as PageRecord['source'],
    confidence: row.confidence === null ? null : Number(row.confidence),
  }));
}

export function getRules(): ReviewRule[] {
  return (db.prepare('SELECT * FROM review_rules WHERE enabled = 1 ORDER BY type, id').all() as Row[]).map((row) => ({
    id: String(row.id), type: row.type as ReviewRule['type'], title: String(row.title), content: String(row.content),
    defaultRisk: row.default_risk as ReviewRule['defaultRisk'], source: String(row.source),
  }));
}

export function saveAnalysis(id: string, clauses: AnalyzedClause[]) {
  const timestamp = now();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM clauses WHERE document_id = ?').run(id);
    const insert = db.prepare(`INSERT INTO clauses
      (id, document_id, type, original_text, page_number, summary, risk_level, risk_rationale,
       suggestion, matched_rule_ids, match_status, review_status, is_edited, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`);
    for (const clause of clauses) {
      insert.run(randomUUID(), id, clause.type, clause.originalText, clause.pageNumber, clause.summary,
        clause.riskLevel, clause.riskRationale, clause.suggestion, JSON.stringify(clause.matchedRuleIds),
        clause.matchStatus, timestamp, timestamp);
    }
    db.prepare(`UPDATE documents SET status = 'completed', progress = 100, error = NULL,
      analyzer = ?, updated_at = ? WHERE id = ?`).run(process.env.ANALYSIS_PROVIDER || 'demo', timestamp, id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function mapClause(row: Row) {
  return {
    id: String(row.id), documentId: String(row.document_id), type: row.type,
    originalText: String(row.original_text), pageNumber: row.page_number === null ? null : Number(row.page_number),
    summary: String(row.summary), riskLevel: row.risk_level, riskRationale: String(row.risk_rationale),
    suggestion: String(row.suggestion), matchedRuleIds: JSON.parse(String(row.matched_rule_ids)),
    matchStatus: row.match_status, reviewStatus: row.review_status, isEdited: Boolean(row.is_edited),
  };
}

export function getClause(id: string) {
  const row = db.prepare('SELECT * FROM clauses WHERE id = ?').get(id) as Row | undefined;
  return row ? mapClause(row) as import('../shared/types.js').ClauseRecord : null;
}

export function updateClause(id: string, input: Record<string, unknown>) {
  const columns: Record<string, string> = {
    originalText: 'original_text', pageNumber: 'page_number', summary: 'summary', riskLevel: 'risk_level',
    riskRationale: 'risk_rationale', suggestion: 'suggestion', matchStatus: 'match_status', reviewStatus: 'review_status',
  };
  const entries = Object.entries(input).filter(([key]) => key in columns);
  if (!entries.length) return getClause(id);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
  db.prepare(`UPDATE clauses SET ${assignments}, is_edited = 1, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value as string | number | null), now(), id);
  return getClause(id);
}

export function getDocumentDetail(id: string): DocumentDetail | null {
  const document = getDocument(id);
  if (!document) return null;
  const clauses = (db.prepare('SELECT * FROM clauses WHERE document_id = ? ORDER BY created_at, type').all(id) as Row[])
    .map((row) => mapClause(row) as import('../shared/types.js').ClauseRecord);
  return { document, pages: getPages(id), clauses, rules: getRules() };
}

export function markInterruptedJobs() {
  db.prepare(`UPDATE documents SET status = 'failed', error = '服务重启中断了处理，请点击重试。', updated_at = ?
    WHERE status IN ('uploaded', 'extracting_text', 'analyzing')`).run(now());
}
