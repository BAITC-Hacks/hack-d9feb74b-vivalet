export type Side = "before" | "after";
export type DocumentType = "pdf" | "docx" | "xlsx";

export interface DocumentChunk {
  id: string;
  documentId: string;
  text: string;
  heading?: string;
  section?: string;
  page?: number;
  paragraph?: number;
  sheet?: string;
  rowStart?: number;
  rowEnd?: number;
}
export interface ParsedDocument {
  id: string;
  filename: string;
  side: Side;
  type: DocumentType;
  size: number;
  text: string;
  chunks: DocumentChunk[];
}
export interface SourceReference {
  documentId: string;
  chunkId: string;
  filename: string;
  quote: string;
  section?: string;
  heading?: string;
  page?: number;
  paragraph?: number;
  sheet?: string;
  row?: number;
}
export interface FunctionItem {
  id: string;
  unitId: string;
  originalText: string;
  normalizedText: string;
  action?: string;
  object?: string;
  sourceRefs: SourceReference[];
}
export interface OrganizationalUnit {
  id: string;
  documentId: string;
  side: Side;
  name: string;
  normalizedName: string;
  parentUnit?: string;
  leaderRole?: string;
  roles: string[];
  functions: FunctionItem[];
  sourceRefs: SourceReference[];
}
export type UnitTransformation = "unchanged" | "renamed" | "transformed" | "split" | "merged" | "removed" | "created";
export interface UnitMapping {
  beforeUnitIds: string[];
  afterUnitIds: string[];
  transformation: UnitTransformation;
  confidence: number;
  explanation: string;
  sourceRefs: SourceReference[];
}
export type FunctionStatus = "preserved" | "modified" | "moved" | "possibly_lost" | "new";
export interface FunctionMatch {
  beforeId?: string;
  afterId?: string;
  beforeUnit?: string;
  afterUnit?: string;
  beforeText?: string;
  afterText?: string;
  status: FunctionStatus;
  confidence: number;
  reasoning: string;
  beforeRefs: SourceReference[];
  afterRefs: SourceReference[];
}
export type FindingType = "lost_function" | "duplicated_function" | "moved_function" | "modified_function" | "new_function" | "conflict_of_interest" | "structural_change";
export interface Finding {
  id: string;
  type: FindingType;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  summary: string;
  reasoning: string;
  confidence: number;
  beforeRefs: SourceReference[];
  afterRefs: SourceReference[];
  beforeUnit?: string;
  afterUnit?: string;
  recommendation?: string;
}
export interface AnalysisReport {
  executiveSummary: string;
  structuralChangesSummary: string;
  keyRisks: string[];
  recommendations: string[];
  conclusion: string;
}
export interface AnalysisResult {
  mode: "ai" | "rules";
  units: OrganizationalUnit[];
  unitMappings: UnitMapping[];
  functionMatches: FunctionMatch[];
  findings: Finding[];
  needsReview: Finding[];
  report: AnalysisReport;
}
