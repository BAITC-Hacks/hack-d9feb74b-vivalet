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
  chapter?: string;
  parentContext?: string;
  parentChunkIds?: string[];
  sectionActor?: string;
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
  category?: "execution" | "oversight" | "approval" | "other";
  sourceRefs: SourceReference[];
  semantic?: SemanticFunction;
}
export const authorityTypes = ["duty", "right", "responsibility", "prohibition", "optional", "approval", "control", "coordination", "reporting", "execution", "unknown"] as const;
export interface SemanticFunction {
  actor: string;
  organizationalUnit: string | null;
  action: string;
  object: string;
  target: string | null;
  purpose: string | null;
  scope: string[];
  authorityType: typeof authorityTypes[number];
  conditions: string[];
  recipients: string[];
  domain: string | null;
  parentContext: string;
}
export const changeTypes = ["UNCHANGED", "REWORDING", "CLARIFIED", "EXPANDED", "NARROWED", "ADDED", "REMOVED", "TRANSFERRED", "SPLIT", "MERGED", "DUPLICATED", "RESPONSIBILITY_CHANGED", "AUTHORITY_CHANGED", "SCOPE_CHANGED", "CONDITION_CHANGED", "POTENTIAL_GAP", "POTENTIAL_OVERLAP", "POTENTIAL_CONFLICT", "SPECIALIZED"] as const;
export type ChangeType = typeof changeTypes[number];
export interface SemanticDecision {
  oldFunctionIds: string[];
  newFunctionIds: string[];
  changeTypes: ChangeType[];
  meaningPreserved: boolean;
  oldCoveredByNew: boolean;
  newCoveredByOld: boolean;
  actorChanged: boolean;
  authorityChanged: boolean;
  scopeChanged: boolean;
  conditionsChanged: boolean;
  purposeChanged: boolean;
  coverageScore: number;
  confidence: number;
  reasoning: string;
  requiresHumanReview: boolean;
}
export interface Verification {
  status: "SUPPORTED" | "REFUTED" | "UNCERTAIN";
  reason: string;
  evidence: SourceReference[];
}
export interface SemanticChange extends SemanticDecision {
  id: string;
  beforeRefs: SourceReference[];
  afterRefs: SourceReference[];
  searchedAfterIds: string[];
  globalSearchComplete: boolean;
  verification?: Verification;
  review?: { status: "confirmed" | "rejected"; note: string; reviewedAt: string };
}
export interface OrganizationGraph {
  nodes: { id: string; label: string; kind: "unit" | "role" | "function"; side: Side }[];
  edges: { from: string; to: string; relation: "belongs_to" | "reports_to" | "performs"; sourceRefs: SourceReference[] }[];
}
export interface OrganizationalUnit {
  id: string;
  documentId: string;
  side: Side;
  name: string;
  normalizedName: string;
  isRoot?: boolean;
  abbreviation?: string;
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
export type FunctionStatus = "preserved" | "modified" | "moved" | "possibly_lost" | "new" | "review";
export interface FunctionMatch {
  semanticChangeId?: string;
  changeTypes?: ChangeType[];
  coverageScore?: number;
  requiresHumanReview?: boolean;
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
  semanticChangeId?: string;
  requiresHumanReview?: boolean;
  verification?: Verification;
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
  semanticChanges?: SemanticChange[];
  organizationGraph?: OrganizationGraph;
  mode: "ai" | "rules";
  units: OrganizationalUnit[];
  unitMappings: UnitMapping[];
  functionMatches: FunctionMatch[];
  findings: Finding[];
  needsReview: Finding[];
  report: AnalysisReport;
}
