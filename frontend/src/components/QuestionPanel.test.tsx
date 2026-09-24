import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionPanel } from './QuestionPanel'

vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return {
    ...actual,
    Toaster: () => null,
    toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), promise: vi.fn((p: Promise<unknown>) => ({ unwrap: () => p })) }),
  }
})

// MAS-130: the question input must stop typing at the same length the
// backend rejects (app/api/routes.py's MAX_QUESTION_LENGTH), so a too-long
// question never round-trips to a 422.
describe('QuestionPanel', () => {
  it('caps the question textarea at the backend length limit', () => {
    render(<QuestionPanel selected={null} draft="" onDraftChange={() => {}} onAnswered={() => {}} />)

    const textarea = screen.getByLabelText('Ask about the contract')
    expect(textarea).toHaveAttribute('maxLength', '2000')
  })
})
