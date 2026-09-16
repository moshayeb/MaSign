import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, listContracts, uploadContract } from './api'

function respond(status: number, body: unknown, statusText = '') {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('api errors (docs/frontend.md rule 2)', () => {
  it('carries the API detail verbatim', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respond(415, { detail: 'Unsupported file type: .exe. Upload a TXT, PDF or DOCX file.' }),
    )

    await expect(uploadContract(new File(['x'], 'x.exe'))).rejects.toMatchObject({
      name: 'ApiError',
      status: 415,
      message: 'Unsupported file type: .exe. Upload a TXT, PDF or DOCX file.',
    })
  })

  it('falls back to the HTTP status text when there is no detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(502, undefined, 'Bad Gateway'))

    await expect(listContracts()).rejects.toThrow(new ApiError('Bad Gateway', 502))
  })

  it('falls back to the status code when the body is not JSON and there is no status text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>oops</html>', { status: 500 }))

    await expect(listContracts()).rejects.toThrow('HTTP 500')
  })

  it('explains a network failure instead of throwing a raw TypeError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(listContracts()).rejects.toThrow('Cannot reach the MaSign API')
  })
})

describe('requests', () => {
  it('posts the file as multipart form data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(200, { contract_id: '1', chunk_count: 3 }))

    const result = await uploadContract(new File(['clause'], 'msa.txt', { type: 'text/plain' }))

    expect(result.chunk_count).toBe(3)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/contracts/upload')
    expect(init?.method).toBe('POST')
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File)
  })
})
