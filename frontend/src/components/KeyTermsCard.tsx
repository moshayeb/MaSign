import type { KeyTermValue, RiskReview } from '../api'

interface Props {
  review: RiskReview
  filename: string
}

// The financial key terms of the selected contract (MAS-82): what is paid,
// when, what late payment and leaving cost, how long it binds — each value
// with the passage that states it. Absence is only called "not stated" when
// every passage was read; otherwise it is "not checked" (honest-outcomes).
export function KeyTermsCard({ review, filename }: Props) {
  const running = review.status === 'pending' || review.status === 'running'
  const found = review.key_terms.filter((t) => t.status === 'found' || t.status === 'conflicting')
  const conflicting = review.key_terms.filter((t) => t.status === 'conflicting')
  const coverage =
    review.chunks_withheld > 0
      ? `${review.chunks_checked} of ${review.chunks_total} passages read, ${review.chunks_withheld} withheld`
      : `${review.chunks_checked} of ${review.chunks_total} passages read`

  return (
    <section className="card key-terms" aria-live="polite">
      <div className="answer-header">
        <h2>
          Key terms
          {running && <span className="status running">Extracting…</span>}
          {!running && review.status === 'done' && review.key_terms_complete && (
            <span className="status ok">
              {found.length} of {review.key_terms.length} stated · {coverage}
            </span>
          )}
          {!running && review.status === 'done' && !review.key_terms_complete && <span className="status warn">Partly checked · {coverage}</span>}
          {review.status === 'failed' && <span className="status warn">Not extracted</span>}
        </h2>
        {review.model && <span className="muted answer-scope">{review.model}</span>}
      </div>
      <p className="answer-question muted">{filename}</p>

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

      <dl className="terms">
        {review.key_terms.map((term) => (
          <TermRow key={term.id} term={term} running={running} />
        ))}
      </dl>
      <p className="muted disclaimer">Each value is quoted from the passage named beside it; nothing is inferred or computed.</p>
    </section>
  )
}

function TermRow({ term, running }: { term: KeyTermValue; running: boolean }) {
  const stated = term.status === 'found' || term.status === 'conflicting'
  return (
    <div className={`term ${term.status}`}>
      <dt>{term.name}</dt>
      <dd>
        {running && !stated ? (
          <span className="muted small">…</span>
        ) : stated && term.source ? (
          <>
            <span className="term-value">{term.value}</span>
            <span className="muted small">
              {' '}
              · passage {term.source.chunk_index + 1}
              {term.status === 'conflicting' && <span className="status warn">Conflicting</span>}
            </span>
            <blockquote className="term-quote">“{term.source.quote}”</blockquote>
            {term.others.length > 0 && (
              <ul className="term-others">
                {term.others.map((other) => (
                  <li key={other.chunk_id} className="muted small">
                    Also stated in passage {other.chunk_index + 1}: “{other.value}”
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : term.status === 'unchecked' ? (
          <span className="muted small">Not checked</span>
        ) : (
          <span className="muted small">Not stated in the reviewed text</span>
        )}
      </dd>
    </div>
  )
}
