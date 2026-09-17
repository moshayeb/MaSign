import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, getContractRisks, reviewContract, type Contract, type RiskReview } from '../api'

interface Props {
  contract: Contract
  // How often to re-read the review while it is pending or running.
  pollMs?: number
  // Called when a review reaches done/failed, so the contract list can refresh its badge.
  onSettled?: () => void
}

const SEVERITY_ORDER = { High: 0, Medium: 1, Low: 2 } as const

// The whole-contract risk review (MAS-81): every passage of the selected
// contract graded with the rubric, shown per category so that a clean
// category reads as "reviewed, nothing found" — never "not looked at".
export function RiskReviewPanel({ contract, pollMs = 2000, onSettled }: Props) {
  const [review, setReview] = useState<RiskReview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'never' | 'error'>('loading')
  const [starting, setStarting] = useState(false)
  // Whether this panel saw the review in flight: only then does settling
  // mean "something changed" for the contract list.
  const sawRunning = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await getContractRisks(contract.contract_id)
      setReview(next)
      setState('ready')
    } catch (error) {
      // 404 = uploaded before reviews existed (or the row was removed): offer to run one.
      setState(error instanceof ApiError && error.status === 404 ? 'never' : 'error')
      setReview(null)
    }
  }, [contract.contract_id])

  // Read the review once per mount; App keys the panel by contract, so a
  // new contract is a fresh panel rather than stale state to reset.
  useEffect(() => {
    void load()
  }, [load])

  const running = review !== null && (review.status === 'pending' || review.status === 'running')

  // While the review runs, re-read it; when it settles after being seen
  // running, tell the parent so the list badge updates.
  useEffect(() => {
    if (running) {
      sawRunning.current = true
      const timer = setTimeout(() => void load(), pollMs)
      return () => clearTimeout(timer)
    }
    if (review && sawRunning.current) {
      sawRunning.current = false
      onSettled?.()
    }
    return undefined
  }, [running, review, load, pollMs, onSettled])

  async function start() {
    setStarting(true)
    try {
      const started = await toast
        .promise(reviewContract(contract.contract_id), {
          loading: `Starting the risk review of ${contract.filename}…`,
          success: `Risk review started — ${contract.chunk_count} passage${contract.chunk_count === 1 ? '' : 's'} to grade`,
          error: (e: Error) => e.message,
        })
        .unwrap()
      setReview(started) // pending: the polling effect takes over
      setState('ready')
    } catch {
      // Already reported by the toast.
    } finally {
      setStarting(false)
    }
  }

  // "Nothing found" is a claim about the whole contract; it is only true
  // when every passage was graded. Otherwise an empty category is
  // "Unable to determine" (MAS-87).
  const settledClean = review !== null && review.status === 'done' && review.complete

  const findings = review ? [...review.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.chunk_index - b.chunk_index) : []

  return (
    <section className="card review" aria-live="polite">
      <div className="answer-header">
        <h2>
          Risk review
          {state === 'loading' && <span className="status none">Loading…</span>}
          {state === 'never' && <span className="status none">Not reviewed</span>}
          {state === 'error' && <span className="status warn">Unavailable</span>}
          {review && running && (
            <span className="status running">
              Reviewing… {review.chunks_checked}/{review.chunks_total || contract.chunk_count} passages
            </span>
          )}
          {review && review.status === 'done' && review.complete && <span className="status ok">Reviewed · {review.chunks_total} passages</span>}
          {review && review.status === 'done' && !review.complete && (
            <span className="status warn">
              Partly reviewed · {review.chunks_checked}/{review.chunks_total} passages
            </span>
          )}
          {review && review.status === 'failed' && <span className="status warn">Review failed</span>}
        </h2>
        <div className="review-tools">
          {review?.model && <span className="muted answer-scope">{review.model}</span>}
          {!running && state !== 'loading' && (
            <button type="button" className="ghost" onClick={() => void start()} disabled={starting}>
              {review ? 'Review again' : 'Review risks'}
            </button>
          )}
        </div>
      </div>
      <p className="answer-question muted">{contract.filename}</p>

      {state === 'never' && (
        <p className="muted">This contract was uploaded before whole-contract reviews existed. Run one to grade every passage with the rubric.</p>
      )}
      {state === 'error' && <p className="muted">The review could not be loaded. Refresh, or check that the API is running.</p>}
      {review?.status === 'failed' && (
        <p className="badge unverified" role="status">
          The review stopped: {review.error ?? 'unknown error'}. {review.chunks_checked > 0 ? `${review.chunks_checked} of ${review.chunks_total} passages were graded before it failed.` : ''} Run it again.
        </p>
      )}
      {review?.status === 'done' && !review.complete && (
        <p className="badge unverified" role="status">
          Some passages could not be graded — the model's reply for them was unreadable. The findings below are verified; run the review again for the rest.
        </p>
      )}

      {review && (
        <ul className="review-grid" aria-label="Risk categories">
          {review.categories.map((category) => (
            <li
              key={category.id}
              className={
                category.worst_severity ? `review-cat severity-${category.worst_severity.toLowerCase()}` : settledClean ? 'review-cat clean' : 'review-cat'
              }
            >
              <span className="review-cat-name">{category.name}</span>
              {category.worst_severity ? (
                <span className="severity">{category.worst_severity}</span>
              ) : running ? (
                <span className="muted small">…</span>
              ) : settledClean ? (
                <span className="muted small">Nothing found</span>
              ) : (
                <span className="muted small">Unable to determine</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {findings.length > 0 && (
        <>
          <h3>Findings</h3>
          <ul className="risks">
            {findings.map((finding) => (
              <li key={`${finding.category}-${finding.chunk_id}`} className={`risk severity-${finding.severity.toLowerCase()}`}>
                <div className="risk-head">
                  <span className="severity">{finding.severity}</span>
                  <strong>{finding.category_name}</strong>
                  <span className="muted small">passage {finding.chunk_index + 1}</span>
                </div>
                <p className="risk-reason">{finding.reason}</p>
                <blockquote>“{finding.quote}”</blockquote>
              </li>
            ))}
          </ul>
        </>
      )}
      {review?.status === 'done' && findings.length === 0 && review.complete && (
        <p className="muted small">Every passage was read against the rubric and nothing was flagged.</p>
      )}
      {review && (
        <p className="muted disclaimer">Graded from the Customer's side with MaSign's rubric (docs/risk-rubric.md); a first read, not legal advice.</p>
      )}
    </section>
  )
}
