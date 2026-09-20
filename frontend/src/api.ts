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
  // What ingestion could not read, as sentences (MAS-84).
  ingestion_notes?: string[]
}

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
}

export function askQuestion(question: string, contractId: string | null, limit = 5): Promise<QueryResponse> {
  return request<QueryResponse>('/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, contract_id: contractId, limit }),
  })
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
  kind: 'money' | 'recurring' | 'net_days' | 'rate' | 'duration' | 'text'
  // "unchecked": the key-terms pass did not complete, so absence proves nothing.
  status: KeyTermStatus
  value: string
  source: KeyTermSource | null
  others: KeyTermSource[]
  // The Customer's default position, compared by rule over the typed value (MAS-96).
  standard?: StandardVerdict
}

// --- coverage (MAS-84) ------------------------------------------------------

export interface ExternalReference {
  name: string
  chunk_indexes: number[]
}

export interface Coverage {
  chunks_total: number
  chunks_checked: number
  // Passage indexes (0-based) whose model reply was unreadable: not graded.
  unreadable_passages: number[]
  // Passage indexes the guardrail withheld: not graded.
  withheld_passages: number[]
  ingestion_notes: string[]
  // Documents the text depends on that were not uploaded.
  external_references: ExternalReference[]
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
  // What was and was not read (MAS-84); absent on older responses.
  coverage?: Coverage | null
}

// --- the contract's own text (MAS-83) ---------------------------------------

export interface Passage {
  chunk_id: string
  chunk_index: number
  text: string
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
