import type { KeyTermValue, RiskReview } from '../api'
import { buildBrief, buildChecklist } from '../brief'
import { useChecklistTicks } from '../checklistTicks'
import type { SourceRef } from './PassageReader'

interface Props {
  review: RiskReview
  onShowSource?: (source: SourceRef) => void
  // Opens the coverage details above the card (the "n passages not graded" item).
  onShowCoverage?: () => void
  // Opens the complete analysis fold below (MAS-218 "Complete analysis →").
  onShowAnalysis?: () => void
  // The file may not be a contract (MAS-107): "nothing needs attention" must not read as reassurance.
  offRubric?: boolean
}

// Terms already shown in the fact tiles (term, cost, renewal, leaving), so
// "Other key terms" lists only what is not on screen yet (MAS-218).
const IN_TILES = new Set(['effective_date', 'initial_term', 'recurring_fee', 'renewal', 'notice_period', 'termination_cost'])

function otherTerms(review: RiskReview): KeyTermValue[] {
  return (review.key_terms ?? []).filter((t) => !IN_TILES.has(t.id))
}

function termValue(review: RiskReview, t: KeyTermValue): string {
  if (t.status === 'found') return t.value
  if (t.status === 'conflicting') return `${t.value} (stated differently elsewhere)`
  if (t.status === 'not_stated' && review.key_terms_complete) return 'Not stated'
  return 'Not checked'
}

// "Before you sign" (MAS-105/106/111, layout MAS-218): the contract in four
// fact tiles, then the checklist of what needs attention beside the other key
// terms — all derived by rule from the stored review (`brief.ts`), each line
// one click from the passage it came from.
export function BriefCard({ review, onShowSource, onShowCoverage, onShowAnalysis, offRubric = false }: Props) {
  const { ticked, toggle } = useChecklistTicks(review.contract_id)
  const running = review.status === 'pending' || review.status === 'running'
  const done = review.status === 'done'
  const facts = done ? buildBrief(review).filter((f) => f.id !== 'risks') : []
  const items = done ? buildChecklist(review) : []
  const others = done ? otherTerms(review) : []
  const open = items.filter((i) => !ticked.has(i.id)).length

  const tiles = [
    ...facts.map((fact) => ({
      id: fact.id,
      label: fact.label,
      text: fact.text,
      note: fact.note,
      missing: fact.missing ?? false,
      tone: fact.tone,
      source: fact.source,
    })),
    ...others.map((t) => ({
      id: t.id,
      label: t.name,
      text: termValue(review, t),
      note: t.standard?.status === 'deviates' ? `Your rule: ${t.standard.standard}` : undefined,
      missing: t.status !== 'found' && t.status !== 'conflicting',
      tone: t.standard?.status === 'deviates' ? ('warn' as const) : undefined,
      source: t.source ? { chunk_index: t.source.chunk_index, quote: t.source.quote } : undefined,
    })),
  ]

  // One sheet (MAS-218 calm pass): what to do first, then the terms, divided
  // by hairlines instead of separate boxes. Passage links stay visible -- they
  // are the proof behind every line.
  return (
    <section className="card brief" aria-live="polite">
      <div className="brief-section brief-attention">
        <div className="panel-head">
          <h2>
            Before you sign
            {running && <span className="status running">Waiting for the review</span>}
            {review.status === 'failed' && <span className="status warn">No summary</span>}
            {done && items.length === 0 && <span className={offRubric ? 'status warn' : 'status ok'}>{offRubric ? 'Rubric may not apply' : 'Nothing needs attention'}</span>}
          </h2>
          {items.length > 0 && (
            <span className="check-progress">
              {items.length - open} of {items.length} checked
            </span>
          )}
        </div>

        {running && <p className="muted panel-note">The summary appears when the review finishes.</p>}
        {review.status === 'failed' && <p className="muted panel-note">The review stopped{review.error ? `: ${review.error}` : ''}. Run it again to get a summary.</p>}

        {done &&
          (items.length === 0 ? (
            <p className="brief-clean panel-note">
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
                      {item.detail && <span className="muted small check-detail"> — {item.detail}</span>}
                    </span>
                  </label>
                  {item.source && onShowSource && (
                    <button type="button" className="link check-source" onClick={() => onShowSource(item.source!)} aria-label={`Show "${item.text}" in contract`}>
                      passage {item.source.chunk_index + 1}
                    </button>
                  )}
                  {item.kind === 'coverage' && onShowCoverage && (
                    <button type="button" className="link check-source" onClick={onShowCoverage}>
                      which passages
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </div>

      {done && tiles.length > 0 && (
        <div className="brief-section brief-terms">
          <div className="panel-head">
            <h2>Main terms</h2>
            {onShowAnalysis && (
              <button type="button" className="link panel-more" onClick={onShowAnalysis}>
                Complete analysis →
              </button>
            )}
          </div>
          <dl className="fact-tiles" aria-label="In brief">
            {tiles.map((tile) => (
              <div key={tile.id} className={`fact-tile${tile.tone ? ` ${tile.tone}` : ''}${tile.missing ? ' missing' : ''}`}>
                <dt>{tile.label}</dt>
                <dd>
                  <span className="fact-text">{tile.text}</span>
                  {tile.note && <span className="fact-note">{tile.note}</span>}
                  {tile.source && onShowSource && (
                    <button type="button" className="link fact-source" onClick={() => onShowSource(tile.source!)} aria-label={`Show ${tile.label.toLowerCase()} in contract`}>
                      Passage {tile.source.chunk_index + 1}
                    </button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {done && (
        <p className="muted disclaimer brief-disclaimer">
          A review checklist from MaSign's rubric and your standards, built by rule from the terms and findings above — review assistance, not legal
          advice.
        </p>
      )}
    </section>
  )
}
