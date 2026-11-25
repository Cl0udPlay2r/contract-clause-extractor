import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const databasePath = resolve(process.env.DATABASE_PATH || './data/app.db');
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    page_count INTEGER NOT NULL DEFAULT 0,
    analyzer TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('pdf', 'ocr')),
    confidence REAL,
    UNIQUE(document_id, page_number)
  );
  CREATE TABLE IF NOT EXISTS clauses (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    original_text TEXT NOT NULL DEFAULT '',
    page_number INTEGER,
    summary TEXT NOT NULL DEFAULT '',
    risk_level TEXT NOT NULL DEFAULT 'none',
    risk_rationale TEXT NOT NULL DEFAULT '',
    suggestion TEXT NOT NULL DEFAULT '',
    matched_rule_ids TEXT NOT NULL DEFAULT '[]',
    match_status TEXT NOT NULL DEFAULT 'review',
    review_status TEXT NOT NULL DEFAULT 'pending',
    is_edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS review_rules (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    default_risk TEXT NOT NULL,
    source TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_clauses_document ON clauses(document_id);
`);

const pageColumns = db.prepare('PRAGMA table_info(pages)').all() as Array<{ name: string }>;
if (!pageColumns.some((column) => column.name === 'confidence')) {
  db.exec('ALTER TABLE pages ADD COLUMN confidence REAL');
}

const rules = [
  ['payment-due-date', 'payment', '付款期限不明确', '检查是否明确付款日期或可计算的付款触发条件；仅写“适时付款”等表述时标记复核。', 'medium'],
  ['payment-trigger', 'payment', '付款触发条件含糊', '检查付款是否依赖未定义的验收、审批或第三方行为，以及条件是否可客观确认。', 'medium'],
  ['payment-prepay', 'payment', '预付款比例需关注', '出现全额预付或高比例预付时提示复核交易保障、交付节点与退款安排，不直接判断条款效力。', 'low'],
  ['liability-balance', 'liability', '责任承担明显不对等', '检查违约责任是否仅约束一方，或双方承担责任的范围、上限是否存在显著差异。', 'high'],
  ['liability-cap', 'liability', '责任范围缺少边界', '检查赔偿范围、责任上限、间接损失及例外情形是否有明确约定。', 'medium'],
  ['liability-exemption', 'liability', '免责范围需要复核', '出现单方广泛免责、排除主要责任等表述时提示人工复核，不自动作出法律效力判断。', 'high'],
  ['jurisdiction-missing', 'jurisdiction', '争议解决方式缺失', '未发现明确争议解决方式或管辖约定时，提示补充并由业务人员确认。', 'medium'],
  ['jurisdiction-ambiguous', 'jurisdiction', '管辖表述不明确', '检查法院、仲裁机构或地点表述是否清晰，出现多个备选机构或模糊地点时标记复核。', 'high'],
  ['jurisdiction-location', 'jurisdiction', '管辖地点需评估成本', '对异地管辖或履行地相关约定提示复核维权成本，不判断约定是否有效。', 'low'],
] as const;

const insertRule = db.prepare(`
  INSERT INTO review_rules (id, type, title, content, default_risk, source)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    type=excluded.type, title=excluded.title, content=excluded.content,
    default_risk=excluded.default_risk, source=excluded.source
`);
for (const [id, type, title, content, risk] of rules) {
  insertRule.run(id, type, title, content, risk, '项目自定义演示规则（非法律意见）');
}
