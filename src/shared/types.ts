export const CLAUSE_TYPES = ['payment', 'liability', 'jurisdiction'] as const;
export type ClauseType = (typeof CLAUSE_TYPES)[number];
export type DocumentStatus = 'uploaded' | 'extracting_text' | 'analyzing' | 'completed' | 'failed';
export type RiskLevel = 'none' | 'low' | 'medium' | 'high';
export type MatchStatus = 'matched' | 'review' | 'missing';
export type ReviewStatus = 'pending' | 'confirmed' | 'rejected';

export interface DocumentRecord {
  id: string;
  name: string;
  storedName: string;
  mime: string;
  size: number;
  status: DocumentStatus;
  progress: number;
  error: string | null;
  pageCount: number;
  analyzer: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageRecord {
  pageNumber: number;
  text: string;
  source: 'pdf' | 'ocr';
  confidence: number | null;
}

export interface ClauseRecord {
  id: string;
  documentId: string;
  type: ClauseType;
  originalText: string;
  pageNumber: number | null;
  summary: string;
  riskLevel: RiskLevel;
  riskRationale: string;
  suggestion: string;
  matchedRuleIds: string[];
  matchStatus: MatchStatus;
  reviewStatus: ReviewStatus;
  isEdited: boolean;
}

export interface ReviewRule {
  id: string;
  type: ClauseType;
  title: string;
  content: string;
  defaultRisk: RiskLevel;
  source: string;
}

export interface DocumentDetail {
  document: DocumentRecord;
  pages: PageRecord[];
  clauses: ClauseRecord[];
  rules: ReviewRule[];
}

export const clauseTypeLabels: Record<ClauseType, string> = {
  payment: '付款条款',
  liability: '违约责任',
  jurisdiction: '争议管辖',
};

export const statusLabels: Record<DocumentStatus, string> = {
  uploaded: '等待处理',
  extracting_text: '正在提取文字',
  analyzing: '正在分析条款',
  completed: '分析完成',
  failed: '处理失败',
};
