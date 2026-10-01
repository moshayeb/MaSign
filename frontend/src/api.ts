// The one place the UI talks to the API (docs/frontend.md). Every failed
// request becomes an ApiError whose message is the API's own `detail`, so a
// toast can show it verbatim; when a response carries no `detail` the HTTP
// status text stands in.

export interface Contract {
  contract_id: string
  filename: string
  file_type: string
  size_bytes: number
  character_count: number
  chunk_count: number
  status: string
  created_at: string
  // The whole-contract risk review (MAS-81); null for contracts uploaded before it existed.
  risk_status?: 'pending' | 'running' | 'done' | 'failed' | null
  risk_worst_severity?: 'Low' | 'Medium' | 'High' | null
  risk_complete?: boolean | null
  risk_chunks_checked?: number | null
  risk_chunks_total?: number | null
  // What ingestion could not read, as sentences (MAS-84).
  ingestion_notes?: string[]
  // Is it a commercial contract at all (MAS-107)? By rule; null for a row not yet classified.
  document_kind?: DocumentKind | null
  document_looks_like?: string | null
  document_kind_reasons?: string[]
  // The list-row summary strip (MAS-101): from stored key terms, no model call.
  recurring_fee?: string | null
  initial_term?: string | null
  high_findings?: number
  deviations?: number
  key_terms_status?: 'complete' | 'partial' | 'none'
  // Compare mode (MAS-62): which embedding profiles this contract can
  // currently be asked under. Always includes "portable".
  indexed_profiles?: EmbeddingProfile[]
  // Named standard profile this contract compares against (MAS-185); null
  // means the workspace's default profile.
  standard_profile_id?: string | null
}

export type DocumentKind = 'contract' | 'uncertain' | 'not_contract'

export interface UploadResult extends Contract {
  content_type: string | null
  max_size_bytes: number
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError('Cannot reach the MaSign API. Is the server running?', 0)
  }
  if (!response.ok) {
    throw new ApiError(await errorDetail(response), response.status)
  }
  // A 204 (unlink, forget) has no body; calling .json() on it throws
  // "Unexpected end of JSON input" and would turn a successful delete into a
  // false error toast (found while adding MAS-102's Forget button, but it
  // already affected the existing Unlink button the same way).
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function errorDetail(response: Response): Promise<string> {
  const fallback = response.statusText || `HTTP ${response.status}`
  try {
    const body = (await response.json()) as { detail?: unknown }
    return typeof body.detail === 'string' && body.detail ? body.detail : fallback
  } catch {
    return fallback
  }
}

export function uploadContract(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  return request<UploadResult>('/api/contracts/upload', { method: 'POST', body: form })
}

export function listContracts(): Promise<Contract[]> {
  return request<Contract[]>('/api/contracts')
}

// Irreversible (MAS-126): its chunks, review, key terms, stored questions
// and links cascade in Postgres, and its vectors are removed from Qdrant.
// The UI confirms before calling this.
export function deleteContract(contractId: string): Promise<void> {
  return request<void>(`/api/contracts/${contractId}`, { method: 'DELETE' })
}

export interface RetrievedChunk {
  chunk_id: string
  contract_id: string
  chunk_index: number
  text: string
  score: number
}

export interface CitedChunk extends RetrievedChunk {
  label: number // the [n] used in the answer text
}

export type Severity = 'Low' | 'Medium' | 'High'

export interface RiskFlag {
  category: string
  category_name: string
  severity: Severity
  reason: string
  quote: string
  label: number // the [n] of the passage among retrieved_context
  chunk_id: string
  contract_id: string
  chunk_index: number
}

export type AnswerStatus = 'answered' | 'not_found' | 'withheld'

// Compare mode (MAS-62): which embedding index a question was searched
// against. "portable" (ModernBERT) is always available; "quality"
// (Qwen3-Embedding-4B) only once it is both configured on the server and
// actually indexed for the contract in question (see Contract.indexed_profiles).
export type EmbeddingProfile = 'portable' | 'quality'

export interface QueryResponse {
  answer: string
  // "withheld": every retrieved passage was withheld by the guardrail and the
  // model was never asked — not the same fact as "not found" (MAS-93).
  answer_status: AnswerStatus
  grounded: boolean
  citations: CitedChunk[]
  answer_model: string | null
  retrieved_context: RetrievedChunk[]
  risks: RiskFlag[]
  risks_checked: boolean
  risks_complete: boolean
  recommended_actions: string[]
  // Passage numbers (1-based, among retrieved_context) the prompt-injection
  // guardrail withheld from the model (MAS-90).
  blocked_passages: number[]
  // Passages the model read minus their injected sentences (MAS-99).
  redacted_passages?: number[]
  // Which index answered (MAS-62).
  profile: EmbeddingProfile
}

export function askQuestion(question: string, contractId: string | null, limit = 5, profile: EmbeddingProfile = 'portable'): Promise<QueryResponse> {
  return request<QueryResponse>('/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, contract_id: contractId, limit, profile }),
  })
}

// --- question history (MAS-102) --------------------------------------------

export interface StoredQuestion {
  id: string
  contract_id: string | null
  question: string
  answer: string
  answer_status: AnswerStatus
  grounded: boolean
  model: string | null
  response: QueryResponse
  created_at: string
}

export function listQuestions(contractId: string): Promise<StoredQuestion[]> {
  return request<StoredQuestion[]>(`/api/contracts/${contractId}/questions`)
}

export function forgetQuestion(questionId: string): Promise<void> {
  return request<void>(`/api/questions/${questionId}`, { method: 'DELETE' })
}

// --- whole-contract risk review (MAS-81) -----------------------------------

export type ReviewStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ReviewFinding {
  category: string
  category_name: string
  severity: Severity
  reason: string
  quote: string
  chunk_id: string
  chunk_index: number
  contract_id?: string
}

export interface ReviewCategory {
  id: string
  name: string
  worst_severity: Severity | null // null = reviewed, nothing found
  findings: number
}

// --- financial key terms (MAS-82) -----------------------------------------

export type KeyTermStatus = 'found' | 'not_stated' | 'conflicting' | 'unchecked'

export interface KeyTermSource {
  value: string
  quote: string
  chunk_id: string
  chunk_index: number
  contract_id?: string
  // Machine-readable value, only when every number in it was found in the quote.
  typed: Record<string, string | number> | null
}

export interface StandardVerdict {
  // meets | deviates | unknown (stated, no comparable typed value) | none (no standard for this term)
  status: 'meets' | 'deviates' | 'unknown' | 'none'
  standard: string | null
  detail: string | null
}

export interface KeyTermValue {
  id: string
  name: string
  kind: 'money' | 'recurring' | 'net_days' | 'rate' | 'duration' | 'date' | 'renewal' | 'text'
  // "unchecked": the key-terms pass did not complete, so absence proves nothing.
  status: KeyTermStatus
  value: string
  source: KeyTermSource | null
  others: KeyTermSource[]
  // The Customer's default position, compared by rule over the typed value (MAS-96).
  standard?: StandardVerdict
}

// --- the expected-clause checklist (MAS-188) --------------------------------

export type ClauseStatus = 'present' | 'absent' | 'cannot_tell'

export interface ClauseSource {
  quote: string
  chunk_id: string
  chunk_index: number
  contract_id: string
}

export interface ClauseResult {
  id: string
  name: string
  // "cannot_tell": the clause-check pass did not complete, so absence proves nothing.
  status: ClauseStatus
  source: ClauseSource | null
  others: ClauseSource[]
}

export interface ClauseConfig {
  id: string
  name: string
  enabled: boolean
}

export function listProfileClauses(profileId: string): Promise<ClauseConfig[]> {
  return request<ClauseConfig[]>(`/api/standard-profiles/${profileId}/clauses`)
}

export function setProfileClauseEnabled(profileId: string, clauseId: string, enabled: boolean): Promise<ClauseConfig> {
  return request<ClauseConfig>(`/api/standard-profiles/${profileId}/clauses/${clauseId}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

// --- coverage (MAS-84) ------------------------------------------------------

export interface ExternalReference {
  name: string
  // The physical passages that name this unresolved document. `chunk_index`
  // alone is ambiguous in a bundle (MAS-139).
  passages?: CoveragePassage[]
  // Kept optional so cached/older API responses remain readable during a
  // rolling update; new responses use `passages`.
  chunk_indexes?: number[]
}

export interface CoveragePassage {
  contract_id: string
  filename: string
  chunk_index: number
}

// Old reviews cached by a browser used a bare passage number. Keep the reader
// tolerant while a deployment rolls over; newly fetched API responses always
// use CoveragePassage (MAS-139).
export type CoverageLocation = CoveragePassage | number

export interface ResolvedReference {
  reference_name: string
  linked_contract_id: string
  linked_contract_filename: string
}

export interface Coverage {
  chunks_total: number
  chunks_checked: number
  // Passage indexes (0-based) whose model reply was unreadable: not graded.
  unreadable_passages: CoverageLocation[]
  // Passage indexes the guardrail withheld: not graded.
  withheld_passages: CoverageLocation[]
  // Passage indexes graded minus their injected sentences (MAS-99).
  redacted_passages?: CoverageLocation[]
  ingestion_notes: string[]
  // Documents the text depends on that were not uploaded.
  external_references: ExternalReference[]
  resolved_references?: ResolvedReference[]
  // Whether the file reads as a commercial contract at all (MAS-107).
  document_kind?: DocumentKind | null
  document_looks_like?: string | null
  document_kind_reasons?: string[]
}

// --- deadlines computed from the typed key terms (MAS-100) -------------------

export interface Deadline {
  id: 'term_end' | 'notice_deadline' | 'next_renewal_end' | string
  name: string
  date: string | null // ISO date, or null with a reason
  computed_from: string[]
  reason: string | null
  how: string | null
}

export interface RiskReview {
  contract_id: string
  status: ReviewStatus
  model: string | null
  chunks_total: number
  chunks_checked: number
  // Withheld by the guardrail, never graded; not part of chunks_checked (MAS-94).
  chunks_withheld: number
  complete: boolean
  error: string | null
  updated_at: string
  findings: ReviewFinding[]
  categories: ReviewCategory[]
  // The key-terms pass of the same job (MAS-82).
  key_terms_complete: boolean
  key_terms: KeyTermValue[]
  deadlines?: Deadline[]
  // The expected-clause checklist pass of the same job (MAS-188); absent on older responses.
  clauses_complete?: boolean
  clauses?: ClauseResult[]
  // What was and was not read (MAS-84); absent on older responses.
  coverage?: Coverage | null
}

// --- the contract's own text (MAS-83) ---------------------------------------

export interface Passage {
  chunk_id: string
  chunk_index: number
  text: string
  // [start, end] of each sentence the guardrail withholds from the model (MAS-99).
  withheld_spans?: number[][]
}

export interface ContractLink {
  id: string
  primary_contract_id: string
  linked_contract_id: string
  reference_name: string
  created_at: string
}

export function listContractLinks(contractId: string): Promise<ContractLink[]> {
  return request<ContractLink[]>(`/api/contracts/${contractId}/links`)
}

export function linkContract(contractId: string, linkedContractId: string, referenceName: string): Promise<ContractLink> {
  return request<ContractLink>(`/api/contracts/${contractId}/links`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ linked_contract_id: linkedContractId, reference_name: referenceName }),
  })
}

export function unlinkContract(contractId: string, linkId: string): Promise<void> {
  return request<void>(`/api/contracts/${contractId}/links/${linkId}`, { method: 'DELETE' })
}

export function getContractPassages(contractId: string): Promise<Passage[]> {
  return request<Passage[]>(`/api/contracts/${contractId}/passages`)
}

export function getContractRisks(contractId: string): Promise<RiskReview> {
  return request<RiskReview>(`/api/contracts/${contractId}/risks`)
}

export function reviewContract(contractId: string): Promise<RiskReview> {
  return request<RiskReview>(`/api/contracts/${contractId}/review`, { method: 'POST' })
}

// --- accounts (MAS-143) ------------------------------------------------------

export interface CurrentUser {
  id: string
  email: string
}

export function registerAccount(email: string, password: string): Promise<CurrentUser> {
  return request<CurrentUser>('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function login(email: string, password: string): Promise<CurrentUser> {
  return request<CurrentUser>('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' })
}

export function getCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>('/api/auth/me')
}

// --- editable company standards (MAS-120) -----------------------------------

export interface Standard {
  id: string
  name: string
  // The one line shown next to a verdict, computed server-side from `params`.
  text: string
  params: Record<string, unknown>
  // False once a value has been saved for this term.
  is_default: boolean
}

export function listStandards(): Promise<Standard[]> {
  return request<Standard[]>('/api/standards')
}

export function saveStandard(id: string, params: Record<string, unknown>): Promise<Standard> {
  return request<Standard>(`/api/standards/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params }),
  })
}

export function resetStandard(id: string): Promise<Standard> {
  return request<Standard>(`/api/standards/${id}`, { method: 'DELETE' })
}

// --- named standard profiles (MAS-185) --------------------------------------

export interface StandardProfile {
  id: string
  name: string
  is_default: boolean
}

export function listStandardProfiles(): Promise<StandardProfile[]> {
  return request<StandardProfile[]>('/api/standard-profiles')
}

export function createStandardProfile(name: string): Promise<StandardProfile> {
  return request<StandardProfile>('/api/standard-profiles', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function renameStandardProfile(id: string, name: string): Promise<StandardProfile> {
  return request<StandardProfile>(`/api/standard-profiles/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function setDefaultStandardProfile(id: string): Promise<StandardProfile> {
  return request<StandardProfile>(`/api/standard-profiles/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_default: true }),
  })
}

export function deleteStandardProfile(id: string): Promise<void> {
  return request<void>(`/api/standard-profiles/${id}`, { method: 'DELETE' })
}

export function listProfileStandards(profileId: string): Promise<Standard[]> {
  return request<Standard[]>(`/api/standard-profiles/${profileId}/standards`)
}

export function saveProfileStandard(profileId: string, id: string, params: Record<string, unknown>): Promise<Standard> {
  return request<Standard>(`/api/standard-profiles/${profileId}/standards/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params }),
  })
}

export function resetProfileStandard(profileId: string, id: string): Promise<Standard> {
  return request<Standard>(`/api/standard-profiles/${profileId}/standards/${id}`, { method: 'DELETE' })
}

export function setContractStandardProfile(contractId: string, profileId: string | null): Promise<Contract> {
  return request<Contract>(`/api/contracts/${contractId}/standard-profile`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile_id: profileId }),
  })
}

// --- invoice verification (MAS-92) ------------------------------------------

export type InvoiceOutcome = 'match' | 'possible_mismatch' | 'cannot_verify'

export interface InvoiceCheckItem {
  label: string
  outcome: InvoiceOutcome
  reason: string
  contract_term: string | null
  contract_value: string | null
  contract_quote: string | null
  contract_chunk_id: string | null
  contract_chunk_index: number | null
  // The document the contract passage belongs to (MAS-137/138): the primary
  // contract, or a linked Order Form/SOW one bundle level deep.
  source_contract_id: string | null
  invoice_field: string | null
  invoice_value: string | null
  invoice_quote: string | null
  invoice_chunk_id: string | null
  invoice_page: number | null
}

export interface InvoiceSummary {
  id: string
  contract_id: string
  filename: string
  size_bytes: number
  character_count: number
  page_count: number
  ingestion_notes: string[]
  created_at: string
}

export interface InvoiceCheck {
  id: string
  invoice: InvoiceSummary
  contract_id: string
  model: string | null
  // False when the invoice's fields could not be read at all -- every item
  // is then cannot_verify, never a false "clean" result.
  checked: boolean
  items: InvoiceCheckItem[]
  created_at: string
  matches: number
  possible_mismatches: number
  cannot_verify: number
}

export function uploadInvoice(contractId: string, file: File): Promise<InvoiceCheck> {
  const form = new FormData()
  form.append('file', file)
  return request<InvoiceCheck>(`/api/contracts/${contractId}/invoices`, { method: 'POST', body: form })
}

export function listInvoiceChecks(contractId: string): Promise<InvoiceCheck[]> {
  return request<InvoiceCheck[]>(`/api/contracts/${contractId}/invoice-checks`)
}

export interface InvoicePage {
  chunk_id: string
  page: number
  text: string
}

export function getInvoicePages(invoiceId: string): Promise<InvoicePage[]> {
  return request<InvoicePage[]>(`/api/invoices/${invoiceId}/pages`)
}
