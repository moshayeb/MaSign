import type { Ref } from 'react'
import type { Coverage } from '../api'
import { CoverageNote } from './CoverageNote'
import type { SourceRef } from './PassageReader'

interface Props {
  coverage: Coverage
  onShowSource?: (source: SourceRef) => void
  // Lets the Overview open the details from elsewhere (the checklist's coverage item).
  ref?: Ref<HTMLDetailsElement>
}

// One line for everything the review could not read or had to withhold
// (MAS-104): "AI instructions detected · 1 passage withheld · View details".
// The details are the per-passage list (CoverageNote), rendered once for the
// whole Overview instead of once per card.
export function CoverageNotice({ coverage, onShowSource, ref }: Props) {
  const withheld = coverage.withheld_passages.length
  const redacted = coverage.redacted_passages?.length ?? 0
  const unreadable = coverage.unreadable_passages.length
  const notes = coverage.ingestion_notes.length
  const external = coverage.external_references.map((r) => r.name)

  const items: string[] = []
  if (withheld + redacted > 0) {
    items.push('AI instructions detected')
    if (withheld > 0) items.push(`${withheld} passage${withheld === 1 ? '' : 's'} withheld`)
    if (redacted > 0) items.push(`${redacted} passage${redacted === 1 ? '' : 's'} read in part`)
  }
  if (unreadable > 0) items.push(`${unreadable} passage${unreadable === 1 ? '' : 's'} not graded`)
  if (notes > 0) items.push(notes === 1 ? 'part of the file not readable' : `${notes} parts of the file not readable`)
  if (external.length > 0) items.push(`depends on ${external.join(', ')} (not uploaded)`)
  if (items.length === 0) return null

  const security = withheld + redacted > 0
  return (
    <details className={`coverage-notice${security ? ' security' : ''}`} ref={ref}>
      <summary>
        <span className="coverage-icon" aria-hidden="true">
          {security ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          )}
        </span>
        <span className="coverage-line">{items.join(' · ')}</span>
        <span className="coverage-toggle">View details</span>
      </summary>
      <CoverageNote coverage={coverage} onShowSource={onShowSource} />
    </details>
  )
}
