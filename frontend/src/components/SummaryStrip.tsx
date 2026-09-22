import type { RiskReview } from '../api'

interface Props {
  review: RiskReview | null
  // 'never' = no review row yet; 'error' = the review could not be loaded.
  state: 'loading' | 'ready' | 'never' | 'error' | 'retrying'
  // The file may not be a contract (MAS-107): a clean Risks tile must not read as reassurance.
  offRubric?: boolean
}

// Four numbers at the top of the Overview (MAS-104): what the stored review
// established, and nothing it did not. A running review shows "…", a missing
// one "—" — never a zero that could read as "nothing wrong".
export function SummaryStrip({ review, state, offRubric = false }: Props) {
  const running = review !== null && (review.status === 'pending' || review.status === 'running')
  const done = review !== null && review.status === 'done'
  const stated = review ? review.key_terms.filter((t) => t.status === 'found' || t.status === 'conflicting').length : 0
  const deviations = review ? review.key_terms.filter((t) => t.standard?.status === 'deviates').length : 0
  const high = review ? review.findings.filter((f) => f.severity === 'High').length : 0
  const medium = review ? review.findings.filter((f) => f.severity === 'Medium').length : 0
  const low = review ? review.findings.filter((f) => f.severity === 'Low').length : 0

  const pending = state === 'loading' ? '…' : running ? '…' : '—'
  const absent = state === 'loading' ? 'Loading' : running ? 'Reviewing' : state === 'error' ? 'Unavailable' : review?.status === 'failed' ? 'Review failed' : 'Not reviewed'

  const tiles: { id: string; label: string; value: string; note: string; tone?: 'ok' | 'warn' | 'high' }[] = [
    {
      id: 'terms',
      label: 'Key terms',
      value: done ? `${stated} of ${review.key_terms.length}` : pending,
      note: done ? (review.key_terms_complete ? 'stated in the text' : 'stated · partly checked') : absent,
      tone: done && !review.key_terms_complete ? 'warn' : undefined,
    },
    {
      id: 'deviations',
      label: 'Deviations',
      value: done ? String(deviations) : pending,
      note: done ? 'from your standard' : absent,
      tone: done && deviations > 0 ? 'warn' : undefined,
    },
    {
      id: 'risks',
      label: 'Risks',
      value: done ? (review.findings.length === 0 ? (review.complete ? 'None' : '0') : parts({ High: high, Medium: medium, Low: low })) : pending,
      note: done
        ? review.findings.length === 0
          ? offRubric
            ? 'rubric may not apply'
            : review.complete
              ? `found in ${review.categories.length} categories`
              : 'in the passages graded'
          : 'graded from your side'
        : absent,
      tone: done ? (high > 0 ? 'high' : medium > 0 || !review.complete || offRubric ? 'warn' : 'ok') : undefined,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      value: review && (done || running) ? `${review.chunks_checked} of ${review.chunks_total}` : pending,
      note:
        review && (done || running)
          ? review.chunks_withheld > 0
            ? `passages read · ${review.chunks_withheld} withheld`
            : 'passages read'
          : absent,
      tone: done && !review.complete ? 'warn' : undefined,
    },
  ]

  return (
    <ul className="summary-strip" aria-label="Review summary">
      {tiles.map((tile) => (
        <li key={tile.id} className={`summary-tile${tile.tone ? ` ${tile.tone}` : ''}`}>
          <span className="summary-label">{tile.label}</span>
          <strong className="summary-value">{tile.value}</strong>
          <span className="summary-note">{tile.note}</span>
        </li>
      ))}
    </ul>
  )
}

function parts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${name}`)
    .join(' · ')
}
