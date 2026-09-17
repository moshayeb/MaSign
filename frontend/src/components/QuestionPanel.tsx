import { useState } from 'react'
import { toast } from 'sonner'
import { askQuestion, type Contract, type QueryResponse } from '../api'

export interface Asked {
  question: string
  contract: Contract | null // null = all contracts
  response: QueryResponse
}

interface Props {
  selected: Contract | null
  onAnswered: (asked: Asked) => void
}

export function QuestionPanel({ selected, onAnswered }: Props) {
  const [question, setQuestion] = useState('')
  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const [busy, setBusy] = useState(false)
  const contract = scope === 'selected' ? selected : null

  async function submit() {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      // The answer renders on screen, so only the loading state and a failure
      // (with the API's detail) are toasted; sonner dismisses the toast on
      // success when no success message is given (docs/frontend.md rule 3).
      const response = await toast
        .promise(askQuestion(text, contract?.contract_id ?? null), {
          loading: 'Reading the contract…',
          error: (e: Error) => e.message,
        })
        .unwrap()
      onAnswered({ question: text, contract, response })
    } catch {
      // Already reported by the toast.
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="question"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label htmlFor="question-text">Ask about the contract</label>
      <textarea
        id="question-text"
        rows={2}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder="e.g. What is the termination fee?"
        disabled={busy}
      />
      <div className="question-row">
        <fieldset className="scope">
          <legend className="visually-hidden">Search in</legend>
          <label>
            <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} disabled={!selected} />
            {selected ? selected.filename : 'Selected contract (pick one below)'}
          </label>
          <label>
            <input type="radio" name="scope" checked={scope === 'all' || !selected} onChange={() => setScope('all')} />
            All contracts
          </label>
        </fieldset>
        <button type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </div>
    </form>
  )
}
