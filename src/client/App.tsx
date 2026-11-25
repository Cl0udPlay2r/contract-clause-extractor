import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, ChevronRight, CircleAlert, Clock3, Download,
  FileScan, FileText, FileWarning, LoaderCircle, Pencil, RotateCcw, Scale, Upload, X,
} from 'lucide-react';
import { clauseTypeLabels, statusLabels } from '../shared/types.js';
import type { ClauseRecord, ClauseType, DocumentDetail, DocumentRecord, RiskLevel } from '../shared/types.js';

const riskLabels: Record<RiskLevel, string> = { none: '未命中规则', low: '关注', medium: '中风险', high: '高风险' };
const activeStatuses = new Set(['uploaded', 'extracting_text', 'analyzing']);

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败，请重试。');
  return data;
}

function EvidenceText({ text, clause }: { text: string; clause?: ClauseRecord }) {
  const markRef = useRef<HTMLElement>(null);
  const index = clause?.matchStatus === 'matched' && clause.originalText ? text.indexOf(clause.originalText) : -1;
  useEffect(() => { markRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [clause?.id]);
  if (index < 0 || !clause) return <>{text}</>;
  return <>{text.slice(0, index)}<mark ref={markRef}>{clause.originalText}</mark>{text.slice(index + clause.originalText.length)}</>;
}

function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ originalText: '', summary: '', riskLevel: 'none' as RiskLevel, riskRationale: '', suggestion: '' });
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedClause = detail?.clauses.find((clause) => clause.id === selectedClauseId) || null;

  const openDocument = useCallback(async (id: string) => {
    const next = await request<DocumentDetail>(`/api/documents/${id}`);
    setDetail(next);
    setSelectedId(id);
    setSelectedClauseId((current) => next.clauses.some((clause) => clause.id === current) ? current : next.clauses[0]?.id || null);
  }, []);

  const refreshDocuments = useCallback(async () => {
    const data = await request<{ documents: DocumentRecord[] }>('/api/documents');
    setDocuments(data.documents);
    return data.documents;
  }, []);

  useEffect(() => {
    void refreshDocuments().then((items) => items[0] ? openDocument(items[0].id) : undefined).catch((error) => setNotice(error.message));
  }, [refreshDocuments, openDocument]);

  useEffect(() => {
    if (!selectedId || !detail || !activeStatuses.has(detail.document.status)) return;
    const timer = window.setInterval(() => {
      void Promise.all([openDocument(selectedId), refreshDocuments()]).catch((error) => setNotice(error.message));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [selectedId, detail?.document.status, openDocument, refreshDocuments]);

  useEffect(() => {
    if (!selectedClause) return;
    setDraft({
      originalText: selectedClause.originalText, summary: selectedClause.summary, riskLevel: selectedClause.riskLevel,
      riskRationale: selectedClause.riskRationale, suggestion: selectedClause.suggestion,
    });
    setEditing(false);
  }, [selectedClause?.id]);

  async function uploadFile(file?: File) {
    if (!file) return;
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) return setNotice('请选择 PDF、PNG、JPG、JPEG 或 WebP 文件。');
    if (file.size > 12 * 1024 * 1024) return setNotice('文件不能超过 12 MB。');
    const form = new FormData();
    form.append('file', file);
    setUploading(true);
    setNotice(null);
    try {
      const data = await request<{ document: DocumentRecord }>('/api/documents', { method: 'POST', body: form });
      await refreshDocuments();
      await openDocument(data.document.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '上传失败。');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function patchClause(patch: Record<string, unknown>, message: string) {
    if (!selectedClause) return;
    setSaving(true);
    try {
      const data = await request<{ clause: ClauseRecord }>(`/api/clauses/${selectedClause.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      setDetail((current) => current ? { ...current, clauses: current.clauses.map((clause) => clause.id === data.clause.id ? data.clause : clause) } : current);
      setEditing(false);
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }

  async function retry() {
    if (!detail) return;
    await request(`/api/documents/${detail.document.id}/retry`, { method: 'POST' });
    await openDocument(detail.document.id);
  }

  const document = detail?.document;
  const completed = document?.status === 'completed';
  const pendingCount = detail?.clauses.filter((clause) => clause.reviewStatus === 'pending').length || 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><FileScan size={23} strokeWidth={1.7} /></div>
        <div className="brand-copy"><strong>析约</strong><span>合同条款复核工作台</span></div>
        <div className="topbar-divider" />
        <div className="document-heading">
          <span>{document?.name || '尚未选择合同'}</span>
          {document && <small>{document.pageCount || '—'} 页 · {document.analyzer === 'demo' ? '内置演示分析' : '模型分析'} · {pendingCount} 项待复核</small>}
        </div>
        <div className="header-actions">
          <span className="disclaimer"><Scale size={15} />辅助审查，不构成法律意见</span>
          <a className={`button primary ${!completed ? 'disabled' : ''}`} href={completed ? `/api/documents/${document.id}/export` : undefined} aria-disabled={!completed}>
            <Download size={16} />导出表格
          </a>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFile(event.dataTransfer.files[0]); }}
          >
            <input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => void uploadFile(event.target.files?.[0])} hidden />
            {uploading ? <LoaderCircle className="spin" size={24} /> : <Upload size={24} strokeWidth={1.6} />}
            <strong>{uploading ? '正在上传合同' : '上传一份合同'}</strong>
            <span>拖放到这里，或</span>
            <button className="text-button" disabled={uploading} onClick={() => fileInput.current?.click()}>选择本地文件</button>
            <small>PDF / 图片，最大 12 MB</small>
          </section>

          {documents.length > 0 && <section className="document-list">
            <h2>最近文档 <span>{documents.length}</span></h2>
            {documents.map((item) => (
              <button key={item.id} className={`document-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => void openDocument(item.id)}>
                <FileText size={16} />
                <span><strong>{item.name}</strong><small>{statusLabels[item.status]}</small></span>
                {activeStatuses.has(item.status) ? <LoaderCircle className="spin" size={14} /> : item.status === 'failed' ? <CircleAlert size={14} /> : <ChevronRight size={14} />}
              </button>
            ))}
          </section>}

          {detail && detail.clauses.length > 0 && <nav className="clause-nav" aria-label="条款导航">
            <h2>条款导航 <span>{detail.clauses.length}</span></h2>
            {(['payment', 'liability', 'jurisdiction'] as ClauseType[]).map((type) => {
              const clauses = detail.clauses.filter((clause) => clause.type === type);
              return <div className="clause-group" key={type}>
                <h3>{clauseTypeLabels[type]}<span>{clauses.length}</span></h3>
                {clauses.map((clause) => <button key={clause.id} className={selectedClauseId === clause.id ? 'selected' : ''} onClick={() => setSelectedClauseId(clause.id)}>
                  <i className={`risk-dot ${clause.riskLevel}`} />
                  <span>{clause.matchStatus === 'missing' ? '未识别到条款' : clause.summary.replace(/^.*?：/, '') || '待复核条款'}</span>
                  {clause.reviewStatus === 'confirmed' && <Check size={13} />}
                </button>)}
              </div>;
            })}
          </nav>}
        </aside>

        <section className="evidence-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">证据</span><h1>合同原文</h1></div>
            {document && <span className="page-count">{document.pageCount || 0} 页</span>}
          </div>
          {!document && <div className="empty-state"><FileScan size={44} strokeWidth={1.2} /><h2>从一份合同开始</h2><p>上传文本 PDF、扫描件或图片。分析后可在这里核对每一处条款依据。</p><button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={16} />选择合同</button></div>}
          {document && activeStatuses.has(document.status) && <div className="processing-state">
            <div className="processing-symbol"><LoaderCircle className="spin" size={30} /></div>
            <h2>{statusLabels[document.status]}</h2><p>{document.status === 'analyzing' ? '正在识别条款、匹配原文并应用演示审查规则。' : '正在判断文本路径，扫描件将转交本地 OCR。'}</p>
            <div className="progress-track"><span style={{ width: `${document.progress}%` }} /></div><small>{document.progress}%</small>
          </div>}
          {document?.status === 'failed' && <div className="empty-state error-state"><FileWarning size={42} /><h2>未能完成处理</h2><p>{document.error}</p><button className="button secondary" onClick={() => void retry()}><RotateCcw size={16} />重试处理</button></div>}
          {completed && detail && <div className="pages-scroll">
            {detail.pages.map((page) => <article className="paper-page" key={page.pageNumber}>
              <div className="page-meta"><span>第 {page.pageNumber} 页</span><span>{page.source === 'ocr' ? `OCR${page.confidence !== null ? ` · 置信度 ${Math.round(page.confidence * 100)}%` : ''}` : 'PDF 文本'}</span></div>
              {page.source === 'ocr' && page.confidence !== null && page.confidence < 0.75 && <div className="inline-warning"><AlertTriangle size={15} />本页 OCR 置信度较低，请重点核对识别文字。</div>}
              <div className="contract-text"><EvidenceText text={page.text} clause={selectedClause?.pageNumber === page.pageNumber ? selectedClause : undefined} /></div>
            </article>)}
          </div>}
        </section>

        <aside className="inspector">
          <div className="panel-heading"><div><span className="section-kicker">复核</span><h2>条款详情</h2></div>{selectedClause && <span className={`risk-badge ${selectedClause.riskLevel}`}>{riskLabels[selectedClause.riskLevel]}</span>}</div>
          {!selectedClause && <div className="inspector-empty"><FileText size={32} /><p>{completed ? '从左侧选择一项条款开始复核。' : '条款分析完成后，在这里核对风险依据并修正结果。'}</p></div>}
          {selectedClause && detail && <>
            <div className="inspector-scroll">
              <div className="clause-title"><span>{clauseTypeLabels[selectedClause.type]}</span><small>{selectedClause.isEdited ? '已人工编辑' : '系统提取'}</small></div>
              {selectedClause.matchStatus === 'missing' && <div className="match-alert missing"><CircleAlert size={17} /><div><strong>未识别到明确条款</strong><p>缺失不代表合同一定没有相关内容，请检查原文或手动补录。</p></div></div>}
              {selectedClause.matchStatus === 'review' && <div className="match-alert"><AlertTriangle size={17} /><div><strong>原文定位待复核</strong><p>返回摘录未能与合同原文可靠匹配，请勿直接采信。</p></div></div>}

              {editing ? <div className="edit-form">
                <label>条款原文<textarea rows={6} value={draft.originalText} onChange={(event) => setDraft({ ...draft, originalText: event.target.value })} /></label>
                <label>条款摘要<textarea rows={3} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
                <label>风险等级<select value={draft.riskLevel} onChange={(event) => setDraft({ ...draft, riskLevel: event.target.value as RiskLevel })}>{Object.entries(riskLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label>风险说明<textarea rows={6} value={draft.riskRationale} onChange={(event) => setDraft({ ...draft, riskRationale: event.target.value })} /></label>
                <label>复核建议<textarea rows={4} value={draft.suggestion} onChange={(event) => setDraft({ ...draft, suggestion: event.target.value })} /></label>
              </div> : <div className="review-content">
                <section><h3>条款摘要</h3><p>{selectedClause.summary}</p></section>
                <section><h3>原文依据 {selectedClause.pageNumber && <span>第 {selectedClause.pageNumber} 页</span>}</h3><blockquote>{selectedClause.originalText || '无可展示的原文。'}</blockquote></section>
                <section><h3>风险说明</h3><p className="pre-wrap">{selectedClause.riskRationale}</p></section>
                {selectedClause.matchedRuleIds.length > 0 && <section><h3>命中的演示规则</h3><div className="rule-list">{selectedClause.matchedRuleIds.map((id) => {
                  const rule = detail.rules.find((item) => item.id === id);
                  return rule && <div key={id}><strong>{rule.title}</strong><p>{rule.content}</p><small>{rule.source}</small></div>;
                })}</div></section>}
                <section><h3>复核建议</h3><p>{selectedClause.suggestion}</p></section>
              </div>}
            </div>
            <div className="review-actions">
              {editing ? <><button className="button ghost" onClick={() => setEditing(false)}><X size={15} />取消</button><button className="button primary" disabled={saving} onClick={() => void patchClause(draft, '修改已保存。')}><Check size={15} />保存修改</button></> : <>
                <button className="button ghost" onClick={() => setEditing(true)}><Pencil size={15} />编辑</button>
                <button className="button ghost reject" disabled={saving} onClick={() => void patchClause({ reviewStatus: 'rejected' }, '已标记为误判。')}>标记误判</button>
                <button className={`button primary ${selectedClause.reviewStatus === 'confirmed' ? 'confirmed' : ''}`} disabled={saving} onClick={() => void patchClause({ reviewStatus: 'confirmed' }, '条款已确认。')}><CheckCircle2 size={15} />{selectedClause.reviewStatus === 'confirmed' ? '已确认' : '确认条款'}</button>
              </>}
            </div>
          </>}
        </aside>
      </main>

      {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    </div>
  );
}

export default App;
