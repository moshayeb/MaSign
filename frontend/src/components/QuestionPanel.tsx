import { useState } from 'react'
import { toast } from 'sonner'
import { askQuestion, type Contract, type EmbeddingProfile, type QueryResponse } from '../api'
import { CALLS_PER_QUESTION, COMPARE_CALLS_PER_QUESTION, formatCalls } from '../cost'

// Matches the backend's QueryRequest.question max_length (app/api/routes.py,
// MAX_QUESTION_LENGTH) so a too-long question is stopped by the browser
// before a submit round-trips to a 422 (MAS-130).
const MAX_QUESTION_LENGTH = 2000

export interface Asked {
  question: string
  contract: Contract | null // null = all contracts
  response: QueryResponse
}

// Compare mode (MAS-62): the same question asked of both embedding profiles.
export interface Compared {
  question: string
  contract: Contract | null
  portable: QueryResponse
  quality: QueryResponse
}

interface Props {
  selected: Contract | null
  draft: string
  onDraftChange: (text: string) => void
  onAnswered: (asked: Asked) => void
  // Present only when the compare toggle should show at all -- omit it to
  // hide the feature entirely rather than show a button that always 409s.
  onCompared?: (compared: Compared) => void
}

export function QuestionPanel({ selected, draft, onDraftChange, onAnswered, onCompared }: Props) {
  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const [busy, setBusy] = useState(false)
  const [comparing, setComparing] = useState(false)
  // MAS-196: which profile the plain "Ask" (not Compare) should use. Kept as
  // the user's last pick, but only ever honored through `effectiveProfile`
  // below -- derived from the *current* contract on every render, so it can
  // never fire "quality" against a contract that doesn't support it (no
  // reset effect needed: switching to an unindexed contract or to "all
  // contracts" falls back to portable automatically, and switching back to
  // the same quality-indexed contract remembers the choice).
  const [profile, setProfile] = useState<EmbeddingProfile>('portable')
  const contract = scope === 'selected' ? selected : null
  // Same gating Compare already used -- never offer a profile that will 409.
  const canChooseProfile = scope === 'selected' && Boolean(selected?.indexed_profiles?.includes('quality'))
  const effectiveProfile: EmbeddingProfile = canChooseProfile ? profile : 'portable'
  // Comparing is only offered for one specific, already quality-indexed
  // contract -- "all contracts" scope has no single indexed-profile set to check.
  const canCompare = Boolean(onCompared && canChooseProfile)

  async function submit() {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      // The answer renders on screen, so only the loading state and a failure
      // (with the API's detail) are toasted; sonner dismisses the toast on
      // success when no success message is given (docs/frontend.md rule 3).
      const response = await toast
        .promise(askQuestion(text, contract?.contract_id ?? null, 5, effectiveProfile), {
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

  async function submitCompare() {
    const text = draft.trim()
    if (!text || busy || !onCompared || !contract) return
    setComparing(true)
    try {
      // Two full /api/query round trips (one per profile), each its own
      // answer + risk call -- the cost hint on the button already said so.
      const [portable, quality] = await toast
        .promise(
          Promise.all([askQuestion(text, contract.contract_id, 5, 'portable'), askQuestion(text, contract.contract_id, 5, 'quality')]),
          { loading: 'Reading the contract with both models…', error: (e: Error) => e.message },
        )
        .unwrap()
      onCompared({ question: text, contract, portable, quality })
    } catch {
      // Already reported by the toast.
    } finally {
      setComparing(false)
    }
  }

  return (
    <form
      className="card question"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label htmlFor="question-text" className="visually-hidden">
        Ask about the contract
      </label>
      <textarea
        id="question-text"
        rows={2}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder="Ask about the contract — e.g. What is the termination fee?"
        maxLength={MAX_QUESTION_LENGTH}
        disabled={busy}
      />
      <div className="question-row">
        <fieldset className="scope">
          <legend className="visually-hidden">Search in</legend>
          <span className="scope-label" aria-hidden="true">
            Search in
          </span>
          <label className={scope === 'selected' && selected ? 'pill active' : 'pill'}>
            <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} disabled={!selected} />
            {selected ? selected.filename : 'Selected contract'}
          </label>
          <label className={scope === 'all' || !selected ? 'pill active' : 'pill'}>
            <input type="radio" name="scope" checked={scope === 'all' || !selected} onChange={() => setScope('all')} />
            All contracts
          </label>
        </fieldset>
        {canChooseProfile && (
          <fieldset className="scope">
            <legend className="visually-hidden">Answer with</legend>
            <span className="scope-label" aria-hidden="true">
              Answer with
            </span>
            <label className={effectiveProfile === 'portable' ? 'pill active' : 'pill'}>
              <input type="radio" name="profile" checked={effectiveProfile === 'portable'} onChange={() => setProfile('portable')} />
              Portable
            </label>
            <label className={effectiveProfile === 'quality' ? 'pill active' : 'pill'}>
              <input type="radio" name="profile" checked={effectiveProfile === 'quality'} onChange={() => setProfile('quality')} />
              Quality
            </label>
          </fieldset>
        )}
        <span className="muted small cost-hint ask-cost">Each question uses about {CALLS_PER_QUESTION} model calls</span>
        {canCompare && (
          <button
            type="button"
            className="ghost compare-models"
            disabled={busy || comparing || !draft.trim()}
            onClick={() => void submitCompare()}
            title={`Ask both embedding models and show them side by side (${formatCalls(COMPARE_CALLS_PER_QUESTION)})`}
          >
            {comparing ? 'Comparing…' : `Compare models (${formatCalls(COMPARE_CALLS_PER_QUESTION)})`}
          </button>
        )}
        <button type="submit" className="primary ask" disabled={busy || comparing || !draft.trim()}>
          {busy ? 'Asking…' : 'Ask'}
          {!busy && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </div>
    </form>
  )
}
