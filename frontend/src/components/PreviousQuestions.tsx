import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { forgetQuestion, listQuestions, type Contract, type StoredQuestion } from '../api'
import type { Asked } from './QuestionPanel'

interface Props {
  contract: Contract
  contracts: Contract[]
  // Bumped whenever a new question is answered, so a just-asked question
  // appears here without a page reload (MAS-102).
  version: number
  onSelect: (asked: Asked) => void
}

// Previously answered questions for this contract (MAS-102), so a reviewer
// coming back — or the next day's demo — does not repeat a call it already
// paid for. Clicking one shows the stored answer via the same AnswerView the
// live path uses; nothing here calls the model again.
export function PreviousQuestions({ contract, contracts, version, onSelect }: Props) {
  const [questions, setQuestions] = useState<StoredQuestion[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listQuestions(contract.contract_id)
      .then((rows) => {
        if (!cancelled) setQuestions(rows)
      })
      .catch(() => {
        if (!cancelled) setQuestions([])
      })
    return () => {
      cancelled = true
    }
  }, [contract.contract_id, version])

  if (!questions || questions.length === 0) return null

  async function forget(id: string) {
    try {
      await toast
        .promise(forgetQuestion(id), {
          loading: 'Forgetting…',
          success: 'Removed from previous questions.',
          error: (e: Error) => e.message,
        })
        .unwrap()
      setQuestions((current) => (current ? current.filter((q) => q.id !== id) : current))
    } catch {
      // Already reported by the toast.
    }
  }

  return (
    <div className="previous-questions">
      <h3>Previous questions</h3>
      <ul aria-label="Previous questions">
        {questions.map((q) => {
          const scopeContract = q.contract_id ? (contracts.find((c) => c.contract_id === q.contract_id) ?? contract) : null
          return (
            <li key={q.id} className="previous-question">
              <button
                type="button"
                className="previous-question-open"
                onClick={() => onSelect({ question: q.question, contract: scopeContract, response: q.response })}
              >
                <span className="previous-question-text">{q.question}</span>
                <span className="previous-question-meta">
                  <span className="muted small">{_when(q.created_at)}</span>
                  <StatusPill status={q.answer_status} grounded={q.grounded} />
                </span>
              </button>
              <button type="button" className="link small" onClick={() => void forget(q.id)} aria-label={`Forget "${q.question}"`}>
                Forget
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function StatusPill({ status, grounded }: { status: StoredQuestion['answer_status']; grounded: boolean }) {
  if (status === 'withheld') return <span className="status warn tiny">Withheld</span>
  if (status === 'not_found') return <span className="status tiny">Not found</span>
  return <span className={`status tiny ${grounded ? 'ok' : 'warn'}`}>{grounded ? 'Grounded' : 'Unverified'}</span>
}

function _when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
