import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, getContractRisks, reviewContract, type Contract, type RiskReview } from '../api'
import { BriefCard } from './BriefCard'
import { KeyTermsCard } from './KeyTermsCard'
import type { SourceRef } from './PassageReader'
import { CoverageNotice } from './CoverageNotice'
import { SummaryStrip, type SummaryTarget } from './SummaryStrip'
import { rubricMayNotApply } from '../reviewStatus'
import { reviewCostLabel } from '../cost'

interface Props {
  contract: Contract
  // How often to re-read the review while it is pending or running.
  pollMs?: number
  // Called when a review reaches done/failed, so the contract list can refresh its badge.
  onSettled?: () => void
  // Opens the contract text at a finding's or key term's passage (MAS-83).
  onShowSource?: (source: SourceRef) => void
  // Every review this panel reads, so the Ask tab can rank its suggestions (MAS-108).
  onReview?: (review: RiskReview | null) => void
}

const SEVERITY_ORDER = { High: 0, Medium: 1, Low: 2 } as const

// The Overview tab (MAS-104): the stored whole-contract review (MAS-81) as a
// summary strip, one coverage notice, the key terms and the risk findings.
// A clean category reads as "reviewed, nothing found" only when every
// passage was graded — never "not looked at".
export function RiskReviewPanel({ contract, pollMs = 2000, onSettled, onShowSource, onReview }: Props) {
  const [review, setReview] = useState<RiskReview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'never' | 'error' | 'retrying'>('loading')
  const [pollFailures, setPollFailures] = useState(0)
  const [starting, setStarting] = useState(false)
  // A second review re-spends what the first one cost, so it is asked for twice (MAS-122).
  const [confirming, setConfirming] = useState(false)
  // Whether this panel saw the review in flight: only then does settling
  // mean "something changed" for the contract list.
  const sawRunning = useRef(false)
  const reviewRef = useRef<RiskReview | null>(null)
  const coverageRef = useRef<HTMLDetailsElement>(null)
  // Where a summary tile jumps to (MAS-124).
  const keyTermsRef = useRef<HTMLElement>(null)
  const reviewCardRef = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    try {
      const next = await getContractRisks(contract.contract_id)
      reviewRef.current = next
      setReview(next)
      onReview?.(next)
      setPollFailures(0)
      setState('ready')
    } catch (error) {
      // 404 = uploaded before reviews existed (or the row was removed): offer to run one.
      if (error instanceof ApiError && error.status === 404) {
        reviewRef.current = null
        setReview(null)
        onReview?.(null)
        setState('never')
      } else if (reviewRef.current && ['pending', 'running'].includes(reviewRef.current.status)) {
        // Keep the last known progress and keep polling. A brief 503 or lost
        // connection must not make a still-running server job look stopped.
        // The parent keeps the review it already has (MAS-108 suggestions).
        setPollFailures((failures) => failures + 1)
        setState('retrying')
      } else {
        reviewRef.current = null
        setReview(null)
        onReview?.(null)
        setState('error')
      }
    }
  }, [contract.contract_id, onReview])

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
      const retryDelay = Math.min(pollMs * 2 ** pollFailures, 30_000)
      const timer = setTimeout(() => void load(), retryDelay)
      return () => clearTimeout(timer)
    }
    if (review && sawRunning.current) {
      sawRunning.current = false
      onSettled?.()
    }
    return undefined
  }, [running, review, load, pollMs, pollFailures, onSettled])

  async function start() {
    setConfirming(false)
    setStarting(true)
    try {
      const started = await toast
        .promise(reviewContract(contract.contract_id), {
          loading: `Starting the risk review of ${contract.filename}…`,
          success: `Risk review started — ${contract.chunk_count} passage${contract.chunk_count === 1 ? '' : 's'} to grade`,
          error: (e: Error) => e.message,
        })
        .unwrap()
      reviewRef.current = started
      setReview(started) // pending: the polling effect takes over
      setPollFailures(0)
      setState('ready')
    } catch {
      // Already reported by the toast.
    } finally {
      setStarting(false)
    }
  }

  // "Nothing found" is a claim about the whole contract; it is only true
  // when every passage was graded. Otherwise an empty category is
  // "unable to determine" (MAS-87).
  const settledClean = review !== null && review.status === 'done' && review.complete

  const findings = review ? [...review.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.chunk_index - b.chunk_index) : []
  const clean = review ? review.categories.filter((c) => !c.worst_severity) : []
  const flagged = review ? review.categories.length - clean.length : 0
  // An invoice graded with the contract rubric: say so, and never read a clean review as reassurance (MAS-107).
  const offRubric = rubricMayNotApply(contract)
  // What pressing the paid button would spend (MAS-122).
  const cost = reviewCostLabel(review?.chunks_total || contract.chunk_count)

  // A tile's number is the way into the section that produced it.
  function jumpTo(target: SummaryTarget) {
    const element = target === 'key-terms' ? keyTermsRef.current : target === 'coverage' ? coverageRef.current : reviewCardRef.current
    if (!element) return
    if (target === 'coverage') element.setAttribute('open', '')
    element.scrollIntoView({ block: 'start', behavior: 'smooth' })
    element.focus?.({ preventScroll: true })
  }

  return (
    <>
      <SummaryStrip review={review} state={state} offRubric={offRubric} onJump={jumpTo} />
      {offRubric && (
        <p className="badge unverified document-kind-note" role="status" title="Keyword-based and English only: a hint, not a verdict.">
          {contract.document_kind === 'not_contract'
            ? `This file does not look like a commercial contract${contract.document_looks_like ? ` — it reads like ${aOrAn(contract.document_looks_like)}` : ''}`
            : 'It is not clear whether this file is a commercial contract'}
          {contract.document_kind_reasons && contract.document_kind_reasons.length > 0 ? ` (${contract.document_kind_reasons.join('; ')})` : ''}. The key terms
          and risk review below are graded with the contract rubric and may not be meaningful here; you can still ask questions about the text.
        </p>
      )}
      {review?.coverage && <CoverageNotice coverage={review.coverage} onShowSource={onShowSource} ref={coverageRef} />}
      {/* The contract in five facts and the checklist (MAS-105/106/111), before the details. */}
      {review && (
        <BriefCard
          review={review}
          offRubric={offRubric}
          onShowSource={onShowSource}
          onShowCoverage={() => {
            coverageRef.current?.setAttribute('open', '')
            coverageRef.current?.scrollIntoView({ block: 'nearest' })
          }}
        />
      )}
      {/* The key terms come from the same review row, so the card shares this panel's load and polling (MAS-82). */}
      {review && <KeyTermsCard review={review} onShowSource={onShowSource} ref={keyTermsRef} />}
      <section className="card review" aria-live="polite" tabIndex={-1} ref={reviewCardRef}>
        <div className="answer-header">
          <h2>
            Risk review
            {state === 'loading' && <span className="status none">Loading…</span>}
            {state === 'never' && <span className="status none">Not reviewed</span>}
            {state === 'error' && <span className="status warn">Unavailable</span>}
            {state === 'retrying' && <span className="status warn">Connection interrupted · retrying</span>}
            {review && running && state !== 'retrying' && (
              <span className="status running">
                Reviewing… {review.chunks_checked}/{review.chunks_total || contract.chunk_count} passages
              </span>
            )}
            {review && review.status === 'done' && review.complete && <span className="status ok">Reviewed · {review.chunks_total} passages</span>}
            {review && review.status === 'done' && !review.complete && (
              <span className="status warn">
                Partly reviewed · {review.chunks_checked}/{review.chunks_total} passages
                {review.chunks_withheld > 0 ? ` · ${review.chunks_withheld} withheld` : ''}
              </span>
            )}
            {review && review.status === 'failed' && <span className="status warn">Review failed</span>}
          </h2>
          <div className="review-tools">
            {/* The recovery from a failed read is a re-read, never a paid job (MAS-122). */}
            {state === 'error' && (
              <button type="button" className="ghost" onClick={() => void load()}>
                Try again
              </button>
            )}
            {!running && state !== 'loading' && state !== 'error' && !confirming && (
              <>
                <span className="muted small cost-hint">{cost}</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => (review ? setConfirming(true) : void start())}
                  disabled={starting}
                  aria-label={review ? `Review again — ${cost}` : `Review risks — ${cost}`}
                >
                  {review ? 'Review again' : 'Review risks'}
                </button>
              </>
            )}
          </div>
        </div>

        {confirming && (
          <p className="badge unverified review-confirm" role="status">
            Run the review again? It grades all {review?.chunks_total || contract.chunk_count} passages from scratch and costs {cost}.
            <button type="button" className="ghost" onClick={() => void start()} disabled={starting}>
              Yes, run it
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </p>
        )}
        {state === 'never' && (
          <p className="muted">This contract was uploaded before whole-contract reviews existed. Run one to grade every passage with the rubric.</p>
        )}
        {state === 'error' && (
          <p className="muted">
            The review could not be read — the API may be down or restarting. <strong>Try again</strong> re-reads it; it does not start a new review, so
            it costs nothing. Whatever was already graded is still stored.
          </p>
        )}
        {state === 'retrying' && review && (
          <p className="badge unverified" role="status">
            Connection interrupted — retrying. Last seen at {review.chunks_checked}/{review.chunks_total || contract.chunk_count} passages.
          </p>
        )}
        {review?.status === 'failed' && (
          <p className="badge unverified" role="status">
            The review stopped: {review.error ?? 'unknown error'}. {review.chunks_checked > 0 ? `${review.chunks_checked} of ${review.chunks_total} passages were graded before it failed.` : ''} Run it again.
          </p>
        )}
        {review && review.status !== 'pending' && review.status !== 'running' && (
          <p className="muted small review-meta">
            {review.status === 'done' ? 'Reviewed' : 'Last attempt'} {formatWhen(review.updated_at)}
            {review.model ? ` by ${review.model}` : ''} · {review.chunks_checked} of {review.chunks_total} passages graded
            {review.chunks_withheld > 0 ? `, ${review.chunks_withheld} withheld` : ''}
          </p>
        )}
        {review?.status === 'done' && !review.complete && !review.coverage && (
          <p className="badge unverified" role="status">
            {review.chunks_withheld > 0 &&
              `${review.chunks_withheld} passage${review.chunks_withheld === 1 ? ' was' : 's were'} withheld from the model because ${review.chunks_withheld === 1 ? 'it contains' : 'they contain'} instructions addressed to the AI, so ${review.chunks_withheld === 1 ? 'it was' : 'they were'} not graded — read ${review.chunks_withheld === 1 ? 'it' : 'them'} yourself. `}
            {review.chunks_checked + review.chunks_withheld < review.chunks_total &&
              "Some passages could not be graded — the model's reply for them was unreadable; run the review again for the rest. "}
            {findings.length > 0
              ? 'The findings below are verified.'
              : review.chunks_checked > 0
                ? 'Nothing was found in the passages that were graded.'
                : 'Nothing was graded.'}
          </p>
        )}

        {findings.length > 0 && (
          <ul className="risks" aria-label="Findings">
            {findings.map((finding) => (
              <li key={`${finding.category}-${finding.chunk_id}`} className={`risk severity-${finding.severity.toLowerCase()}`}>
                <div className="risk-head">
                  <span className="severity">{finding.severity}</span>
                  <strong>{finding.category_name}</strong>
                  <span className="muted small">passage {finding.chunk_index + 1}</span>
                  {onShowSource && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => onShowSource({ chunk_index: finding.chunk_index, quote: finding.quote })}
                      aria-label={`Show ${finding.category_name} finding in contract`}
                    >
                      Show in contract
                    </button>
                  )}
                </div>
                <p className="risk-reason">{finding.reason}</p>
                <blockquote>“{finding.quote}”</blockquote>
              </li>
            ))}
          </ul>
        )}

        {/* The categories without a finding, as one line: clean only when the review is complete (MAS-104). */}
        {review && clean.length > 0 && (
          <p className="categories-clean muted small" data-testid="categories-clean">
            {running ? (
              <>
                {clean.length} {flagged > 0 ? 'other ' : ''}categor{clean.length === 1 ? 'y' : 'ies'} still being graded…
              </>
            ) : settledClean ? (
              <>
                <span className="categories-clean-lead">
                  {findings.length === 0 ? `Every passage was read against the rubric and nothing was flagged in any of the ${clean.length} categories` : `No issues found in the ${clean.length} other categor${clean.length === 1 ? 'y' : 'ies'}`}
                </span>
                : {clean.map((c) => c.name).join(', ')}.{offRubric ? ' The rubric is written for contracts, so this says little about this file.' : ''}
              </>
            ) : (
              <>
                <span className="categories-clean-lead">
                  {clean.length} {flagged > 0 ? 'other ' : ''}categor{clean.length === 1 ? 'y' : 'ies'}: unable to determine
                </span>{' '}
                — the review did not cover every passage ({clean.map((c) => c.name).join(', ')}).
              </>
            )}
          </p>
        )}
        {review && (
          <p className="muted disclaimer">Graded from the Customer's side with MaSign's rubric (docs/risk-rubric.md); a first read, not legal advice.</p>
        )}
      </section>
    </>
  )
}

function aOrAn(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
