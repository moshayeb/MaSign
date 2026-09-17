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

export interface QueryResponse {
  answer: string
  grounded: boolean
  citations: CitedChunk[]
  answer_model: string | null
  retrieved_context: RetrievedChunk[]
  risks: string[]
  recommended_actions: string[]
}

export function askQuestion(question: string, contractId: string | null, limit = 5): Promise<QueryResponse> {
  return request<QueryResponse>('/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, contract_id: contractId, limit }),
  })
}
