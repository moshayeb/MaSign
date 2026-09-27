import { useEffect, useState } from 'react'
import { ApiError, getContractRisks, type Contract, type KeyTermValue, type ReviewCategory, type ReviewFinding, type RiskReview } from '../api'
import type { SourceRef } from './PassageReader'

interface Props {
  contracts: [Contract, Contract]
  onShowSource: (contract: Contract, source: SourceRef) => void
  onClose: () => void
}

// The seven rubric categories, in the rubric's own order (docs/risk-rubric.md,
// app/risk_analysis/rubric.py) rather than whatever order each review happens
// to list them in, so the two contracts' rows always line up the same way.
const CATEGORY_ORDER = ['liability', 'termination', 'indemnification', 'auto_renewal', 'confidentiality', 'payment_terms', 'ip_assignment']

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; review: RiskReview }
  | { kind: 'never' } // no review has ever run
  | { kind: 'pending' } // running now
  | { kind: 'failed'; error: string | null }
  | { kind: 'error' } // could not even ask

function useReview(contractId: string): LoadState {
  // Keyed by the contract it was fetched for, so a fresh id reads as
  // "loading" (derived below) without a synchronous setState in the effect.
  const [result, setResult] = useState<{ contractId: string; state: LoadState } | null>(null)
  useEffect(() => {
    let cancelled = false
    getContractRisks(contractId)
      .then((review) => {
        if (cancelled) return
        const state: LoadState =
          review.status === 'pending' || review.status === 'running'
            ? { kind: 'pending' }
            : review.status === 'failed'
              ? { kind: 'failed', error: review.error }
              : { kind: 'ready', review }
        setResult({ contractId, state })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setResult({ contractId, state: error instanceof ApiError && error.status === 404 ? { kind: 'never' } : { kind: 'error' } })
      })
    return () => {
      cancelled = true
    }
  }, [contractId])
  return result && result.contractId === contractId ? result.state : { kind: 'loading' }
}

function stateNote(filename: string, state: LoadState): string | null {
  switch (state.kind) {
    case 'loading':
      return null
    case 'ready':
      return null
    case 'never':
      return `${filename} has not been reviewed yet.`
    case 'pending':
      return `${filename} is still being reviewed.`
    case 'failed':
      return `${filename}'s review failed${state.error ? `: ${state.error}` : ''}.`
    case 'error':
      return `${filename}'s review could not be read.`
  }
}

// Two analyzed contracts, side by side (MAS-113): key terms and risk
// categories as rows, each contract as its own column. A row states what
// each side actually has — "Not stated", "Not checked" — never a guess, and
// nothing here scores or ranks the two; the reader decides.
export function CompareView({ contracts, onShowSource, onClose }: Props) {
  const [a, b] = contracts
  const stateA = useReview(a.contract_id)
  const stateB = useReview(b.contract_id)

  const reviewA = stateA.kind === 'ready' ? stateA.review : null
  const reviewB = stateB.kind === 'ready' ? stateB.review : null
  const termsA = reviewA?.key_terms ?? []
  const termsB = reviewB?.key_terms ?? []
  // A's own order first (matches the single-contract Key terms card), then
  // any term B has that A does not.
  const termIds = [...termsA.map((t) => t.id), ...termsB.filter((t) => !termsA.some((x) => x.id === t.id)).map((t) => t.id)]

  const categoriesA = reviewA?.categories ?? []
  const categoriesB = reviewB?.categories ?? []
  const categoryIds = CATEGORY_ORDER.filter((id) => categoriesA.some((c) => c.id === id) || categoriesB.some((c) => c.id === id))

  const notes = [stateNote(a.filename, stateA), stateNote(b.filename, stateB)].filter((n): n is string => n !== null)

  return (
    <section className="card compare" aria-label="Contract comparison">
      <div className="answer-header">
        <h2>Comparing two contracts</h2>
        <button type="button" className="link" onClick={onClose}>
          Exit comparison
        </button>
      </div>

      <div className="compare-table compare-heads" role="row">
        <span />
        <span className="compare-head">{a.filename}</span>
        <span className="compare-head">{b.filename}</span>
      </div>

      {notes.length > 0 && (
        <p className="badge unverified" role="status">
          {notes.join(' ')} {notes.length === 2 ? 'Comparison is limited to what both have.' : 'Comparison is limited to the reviewed contract until the other is too.'}
        </p>
      )}

      {termIds.length > 0 && (
        <>
          <h3>Key terms</h3>
          <div className="compare-table" role="table" aria-label="Key terms comparison">
            {termIds.map((id) => {
              const termA = termsA.find((t) => t.id === id) ?? null
              const termB = termsB.find((t) => t.id === id) ?? null
              const name = termA?.name ?? termB?.name ?? id
              const differs = termA?.status === 'found' && termB?.status === 'found' && termA.value !== termB.value
              return (
                <div className={differs ? 'compare-row differs' : 'compare-row'} role="row" key={id}>
                  <span className="compare-label" role="rowheader">
                    {name}
                  </span>
                  <TermCell term={termA} contract={a} reviewed={reviewA !== null} onShowSource={onShowSource} />
                  <TermCell term={termB} contract={b} reviewed={reviewB !== null} onShowSource={onShowSource} />
                </div>
              )
            })}
          </div>
        </>
      )}

      {categoryIds.length > 0 && (
        <>
          <h3>Risk categories</h3>
          <div className="compare-table" role="table" aria-label="Risk category comparison">
            {categoryIds.map((id) => {
              const catA = categoriesA.find((c) => c.id === id) ?? null
              const catB = categoriesB.find((c) => c.id === id) ?? null
              return (
                <div className="compare-row" role="row" key={id}>
                  <span className="compare-label" role="rowheader">
                    {catA?.name ?? catB?.name ?? id}
                  </span>
                  <SeverityCell category={catA} reviewed={reviewA !== null} />
                  <SeverityCell category={catB} reviewed={reviewB !== null} />
                </div>
              )
            })}
          </div>
        </>
      )}

      {(reviewA || reviewB) && (reviewA?.findings.length || reviewB?.findings.length) ? (
        <>
          <h3>Findings</h3>
          <div className="compare-findings">
            <FindingsColumn filename={a.filename} findings={reviewA?.findings ?? []} contract={a} onShowSource={onShowSource} />
            <FindingsColumn filename={b.filename} findings={reviewB?.findings ?? []} contract={b} onShowSource={onShowSource} />
          </div>
        </>
      ) : null}

      <p className="muted disclaimer">
        Each value is quoted from its own passage; nothing here is inferred, scored or ranked. This does not say which contract is legally
        better — read both before deciding.
      </p>
    </section>
  )
}

function TermCell({
  term,
  contract,
  reviewed,
  onShowSource,
}: {
  term: KeyTermValue | null
  contract: Contract
  reviewed: boolean
  onShowSource: (contract: Contract, source: SourceRef) => void
}) {
  if (!reviewed) {
    return <span className="compare-value muted small">Not reviewed</span>
  }
  if (!term || term.status === 'unchecked') {
    return <span className="compare-value muted small">Not checked</span>
  }
  if (term.status === 'not_stated') {
    return <span className="compare-value muted small">Not stated</span>
  }
  const source = term.source!
  return (
    <span className="compare-value">
      <span className="term-value">{term.value}</span>
      {term.status === 'conflicting' && <span className="status warn tiny">Conflicting</span>}
      <button
        type="button"
        className="link term-source-link"
        onClick={() => onShowSource(contract, { contract_id: source.contract_id, chunk_index: source.chunk_index, quote: source.quote })}
        aria-label={`Show ${term.name} in ${contract.filename}`}
      >
        passage {source.chunk_index + 1}
      </button>
    </span>
  )
}

function SeverityCell({ category, reviewed }: { category: ReviewCategory | null; reviewed: boolean }) {
  if (!reviewed) return <span className="compare-value muted small">Not reviewed</span>
  if (!category) return <span className="compare-value muted small">Not reviewed</span>
  if (!category.worst_severity) return <span className="compare-value status ok">Reviewed · nothing found</span>
  return (
    <span className={`compare-value status ${category.worst_severity === 'Low' ? 'ok' : 'warn'}`}>
      {category.worst_severity} · {category.findings} finding{category.findings === 1 ? '' : 's'}
    </span>
  )
}

function FindingsColumn({
  filename,
  findings,
  contract,
  onShowSource,
}: {
  filename: string
  findings: ReviewFinding[]
  contract: Contract
  onShowSource: (contract: Contract, source: SourceRef) => void
}) {
  if (findings.length === 0) {
    return (
      <div className="compare-findings-column">
        <h4>{filename}</h4>
        <p className="muted small">No findings.</p>
      </div>
    )
  }
  return (
    <div className="compare-findings-column">
      <h4>{filename}</h4>
      <ul className="risks">
        {findings.map((finding) => (
          <li key={`${finding.category}-${finding.chunk_id}`} className={`risk severity-${finding.severity.toLowerCase()}`}>
            <div className="risk-head">
              <span className="severity">{finding.severity}</span>
              <strong>{finding.category_name}</strong>
              <button
                type="button"
                className="link"
                onClick={() => onShowSource(contract, { contract_id: finding.contract_id ?? contract.contract_id, chunk_index: finding.chunk_index, quote: finding.quote })}
                aria-label={`Show ${finding.category_name} finding in ${filename}`}
              >
                Show in contract
              </button>
            </div>
            <p className="risk-reason">{finding.reason}</p>
            <blockquote>“{finding.quote}”</blockquote>
          </li>
        ))}
      </ul>
    </div>
  )
}
