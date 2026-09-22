import { useState } from 'react'
import type { RiskReview } from '../api'
import { buildBrief, buildChecklist } from '../brief'
import type { SourceRef } from './PassageReader'

interface Props {
  review: RiskReview
  onShowSource?: (source: SourceRef) => void
  // Opens the coverage details above the card (the "n passages not graded" item).
  onShowCoverage?: () => void
  // The file may not be a contract (MAS-107): "nothing needs attention" must not read as reassurance.
  offRubric?: boolean
}

// "Before you sign" (MAS-105/106/111): the contract in five facts, then the
// checklist of what needs attention — all derived by rule from the stored
// review (`brief.ts`), each line one click from the passage it came from.
export function BriefCard({ review, onShowSource, onShowCoverage, offRubric = false }: Props) {
  // Ticks are for the reader's own pass through the list: session-local, not stored.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const running = review.status === 'pending' || review.status === 'running'
  const done = review.status === 'done'
  const facts = done ? buildBrief(review) : []
  const items = done ? buildChecklist(review) : []
  const open = items.filter((i) => !ticked.has(i.id)).length

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="card brief" aria-live="polite">
      <div className="answer-header">
        <h2>
          Before you sign
          {running && <span className="status running">Waiting for the review</span>}
          {review.status === 'failed' && <span className="status warn">No summary</span>}
          {done && items.length === 0 && <span className={offRubric ? 'status warn' : 'status ok'}>{offRubric ? 'Rubric may not apply' : 'Nothing needs attention'}</span>}
          {done && items.length > 0 && (
            <span className={items.some((i) => i.severity === 'High') ? 'status warn' : 'status none'}>
              {open === 0 ? `${items.length} checked` : `${open} to check`}
            </span>
          )}
        </h2>
      </div>

      {running && <p className="muted">The summary appears when the review finishes.</p>}
      {review.status === 'failed' && <p className="muted">The review stopped{review.error ? `: ${review.error}` : ''}. Run it again to get a summary.</p>}

      {done && (
        <>
          <h3>In brief</h3>
          <dl className="brief-facts">
            {facts.map((fact) => (
              <div key={fact.id} className={`brief-fact${fact.tone ? ` ${fact.tone}` : ''}`}>
                <dt>{fact.label}</dt>
                <dd>
                  <span className="brief-text">{fact.text}</span>
                  {fact.source && onShowSource && (
                    <button type="button" className="link" onClick={() => onShowSource(fact.source!)} aria-label={`Show ${fact.label.toLowerCase()} in contract`}>
                      passage {fact.source.chunk_index + 1}
                    </button>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <h3>Needs attention</h3>
          {items.length === 0 ? (
            <p className="brief-clean">
              {offRubric
                ? 'No contract risks or deviations were flagged — but this file does not read as a commercial contract, so the rubric says little about it.'
                : 'Nothing needs attention: no risks flagged, no deviations from your standard, the important terms are stated, and nothing is missing from the upload.'}
            </p>
          ) : (
            <ul className="checklist" aria-label="Before you sign checklist">
              {items.map((item) => (
                <li key={item.id} className={`check ${item.kind}${ticked.has(item.id) ? ' done' : ''}`}>
                  <label className="check-label">
                    <input type="checkbox" checked={ticked.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Done: ${item.text}`} />
                    {item.severity && <span className={`severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span>}
                    <span className="check-text">
                      <strong>{item.text}</strong>
                      {item.detail && <span className="muted small"> — {item.detail}</span>}
                    </span>
                  </label>
                  {item.source && onShowSource && (
                    <button type="button" className="link" onClick={() => onShowSource(item.source!)} aria-label={`Show "${item.text}" in contract`}>
                      passage {item.source.chunk_index + 1}
                    </button>
                  )}
                  {item.kind === 'coverage' && onShowCoverage && (
                    <button type="button" className="link" onClick={onShowCoverage}>
                      which passages
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="muted disclaimer">
            A review checklist from MaSign's rubric and your standards, built by rule from the terms and findings above — review assistance, not legal
            advice.
          </p>
        </>
      )}
    </section>
  )
}
