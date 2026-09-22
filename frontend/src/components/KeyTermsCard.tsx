import type { Ref } from 'react'
import type { Deadline, KeyTermValue, RiskReview } from '../api'
import type { SourceRef } from './PassageReader'

interface Props {
  review: RiskReview
  onShowSource?: (source: SourceRef) => void
  // Lets a summary tile scroll to this card (MAS-124).
  ref?: Ref<HTMLElement>
}

// The financial key terms of the selected contract (MAS-82): what is paid,
// when, what late payment and leaving cost, how long it binds — each value
// with the passage that states it. Since MAS-104 only stated terms get a
// tile; the terms that are not stated share one line, so an absence costs a
// few words, not a card. Absence is only called "not stated" when every
// passage was read; otherwise it is "not checked" (honest-outcomes).
export function KeyTermsCard({ review, onShowSource, ref }: Props) {
  const running = review.status === 'pending' || review.status === 'running'
  const stated = review.key_terms.filter((t) => t.status === 'found' || t.status === 'conflicting')
  const notStated = review.key_terms.filter((t) => t.status === 'not_stated')
  const unchecked = review.key_terms.filter((t) => t.status === 'unchecked')
  const conflicting = review.key_terms.filter((t) => t.status === 'conflicting')
  const deviations = review.key_terms.filter((t) => t.standard?.status === 'deviates').length
  // Documents the text points to but that were not uploaded: a "not stated"
  // term may live there, so say so next to the group (MAS-84).
  const external = (review.coverage?.external_references ?? []).map((r) => r.name)

  return (
    <section className="card key-terms" aria-live="polite" tabIndex={-1} ref={ref}>
      <div className="answer-header">
        <h2>
          Key terms
          {running && <span className="status running">Extracting…</span>}
          {!running && review.status === 'done' && review.key_terms_complete && (
            <span className={deviations > 0 ? 'status warn' : 'status ok'}>
              {stated.length} of {review.key_terms.length} stated
              {deviations > 0 ? ` · ${deviations} deviate${deviations === 1 ? 's' : ''}` : ''}
            </span>
          )}
          {!running && review.status === 'done' && !review.key_terms_complete && (
            <span className="status warn">
              {stated.length} of {review.key_terms.length} stated · partly checked
            </span>
          )}
          {review.status === 'failed' && <span className="status warn">Not extracted</span>}
        </h2>
      </div>

      {review.status === 'done' && !review.key_terms_complete && (
        <p className="badge unverified" role="status">
          Some passages could not be checked for key terms{review.chunks_withheld > 0 ? ' (withheld from the model or unreadable reply)' : " (the model's reply was unreadable)"}
          . A term shown as “Not checked” may still be in the contract. Values shown are verified against their passage.
        </p>
      )}
      {review.status === 'failed' && (
        <p className="badge unverified" role="status">
          The review stopped before the key terms were extracted{review.error ? `: ${review.error}` : ''}. Run it again.
        </p>
      )}
      {conflicting.length > 0 && (
        <p className="badge unverified" role="status">
          {conflicting.length === 1 ? 'One term is' : `${conflicting.length} terms are`} stated differently in several passages — read both
          before relying on either.
        </p>
      )}

      {running && stated.length === 0 && <p className="muted small">Reading the passages for fees, deadlines and terms…</p>}

      {stated.length > 0 && (
        <dl className="terms">
          {stated.map((term) => (
            <TermTile key={term.id} term={term} onShowSource={onShowSource} />
          ))}
        </dl>
      )}

      {!running && (notStated.length > 0 || unchecked.length > 0) && (
        <ul className="terms-missing">
          {notStated.length > 0 && (
            <li className="not_stated">
              <span className="terms-missing-label">Not stated in the reviewed text</span>
              <span className="terms-missing-names">{notStated.map((t) => t.name).join(', ')}</span>
              {external.length > 0 && <span className="muted small"> — may be in {external.join(' or ')} (not uploaded)</span>}
            </li>
          )}
          {unchecked.length > 0 && (
            <li className="unchecked">
              <span className="terms-missing-label">Not checked</span>
              <span className="terms-missing-names">{unchecked.map((t) => t.name).join(', ')}</span>
            </li>
          )}
        </ul>
      )}

      {review.deadlines && review.deadlines.length > 0 && review.status === 'done' && <Deadlines deadlines={review.deadlines} />}

      <p className="muted disclaimer">
        Each value is quoted from the passage named beside it; nothing is inferred. Deadlines are date arithmetic over those values, standards are
        the Customer-side defaults from the rubric (docs/risk-rubric.md), compared by rule — a first read, not legal advice.
      </p>
    </section>
  )
}

function TermTile({ term, onShowSource }: { term: KeyTermValue; onShowSource?: (source: SourceRef) => void }) {
  const source = term.source!
  const verdict = term.standard && term.standard.status !== 'none' ? term.standard : null
  return (
    <div className={`term ${term.status}${verdict?.status === 'deviates' ? ' deviates' : ''}`}>
      <dt>
        {term.name}
        {term.status === 'conflicting' && <span className="status warn tiny">Conflicting</span>}
      </dt>
      <dd>
        <span className="term-value">{term.value}</span>
        <span className="term-meta muted small">
          {onShowSource ? (
            <button
              type="button"
              className="link"
              onClick={() => onShowSource({ chunk_index: source.chunk_index, quote: source.quote })}
              aria-label={`Show ${term.name} in contract`}
            >
              passage {source.chunk_index + 1}
            </button>
          ) : (
            <>passage {source.chunk_index + 1}</>
          )}
          {verdict && (
            <span
              className={`status ${verdict.status === 'meets' ? 'ok' : verdict.status === 'deviates' ? 'warn' : 'none'}`}
              title={`Your standard: ${verdict.standard ?? ''}`}
            >
              {verdict.status === 'meets' ? 'Meets standard' : verdict.status === 'deviates' ? 'Deviates' : "Can't compare"}
            </span>
          )}
        </span>
        <blockquote className="term-quote">“{source.quote}”</blockquote>
        {verdict && verdict.status !== 'meets' && (
          <p className={`term-standard ${verdict.status} muted small`}>
            {verdict.status === 'deviates' && verdict.detail
              ? `${verdict.detail} — your standard: ${verdict.standard}`
              : `stated, but not as a number the text confirms — your standard: ${verdict.standard}`}
          </p>
        )}
        {term.others.length > 0 && (
          <ul className="term-others">
            {term.others.map((other) => (
              <li key={other.chunk_id} className="muted small">
                Also stated in passage {other.chunk_index + 1}: “{other.value}”
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  )
}

const NOTICE_SOON_DAYS = 90

// The dates that follow from the typed terms (MAS-100): arithmetic, shown with
// the formula and the terms it came from; "cannot compute" says which input
// is missing rather than leaving a blank.
function Deadlines({ deadlines }: { deadlines: Deadline[] }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // compare dates, not times
  return (
    <ul className="deadlines" aria-label="Deadlines">
      {deadlines.map((d) => {
        if (!d.date) {
          return (
            <li key={d.id} className="deadline none">
              <span className="deadline-name">{d.name}</span>
              <span className="muted small">cannot compute: {d.reason}</span>
            </li>
          )
        }
        const when = new Date(`${d.date}T00:00:00`)
        const days = Math.round((when.getTime() - today.getTime()) / 86_400_000)
        const past = days < 0
        const soon = d.id === 'notice_deadline' && !past && days <= NOTICE_SOON_DAYS
        return (
          <li key={d.id} className={`deadline ${past ? 'past' : soon ? 'soon' : ''}`} title={`${d.how ?? ''} — from ${d.computed_from.join(', ')}`}>
            <span className="deadline-name">{past ? `${d.name.replace('Give notice by', 'Notice was due')}` : d.name}</span>
            <strong className="deadline-date">{formatDate(when)}</strong>
            {soon && <span className="status warn">in {days} day{days === 1 ? '' : 's'}</span>}
            {past && d.id !== 'term_end' && <span className="status none">passed</span>}
            <span className="muted small deadline-how">{d.how}</span>
          </li>
        )
      })}
    </ul>
  )
}

function formatDate(when: Date): string {
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
