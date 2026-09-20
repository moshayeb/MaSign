import type { Coverage } from '../api'
import type { SourceRef } from './PassageReader'

interface Props {
  coverage: Coverage
  // "risks" or "key terms": what the unread passages were not checked for.
  subject: string
  onShowSource?: (source: SourceRef) => void
}

// What was and was not read (MAS-84). Every line names the passages so the
// user can read them by hand — a count would only say "something is missing".
export function CoverageNote({ coverage, subject, onShowSource }: Props) {
  const lines: React.ReactNode[] = []
  for (const note of coverage.ingestion_notes) {
    lines.push(<li key={`note-${note}`}>Not reviewed: {note}</li>)
  }
  if (coverage.unreadable_passages.length > 0) {
    lines.push(
      <li key="unreadable">
        Not graded for {subject} — the model's reply was unreadable for {passageList(coverage.unreadable_passages, onShowSource)}. Read{' '}
        {coverage.unreadable_passages.length === 1 ? 'it' : 'them'} yourself, or run the review again.
      </li>,
    )
  }
  if (coverage.withheld_passages.length > 0) {
    lines.push(
      <li key="withheld">
        Withheld from the model — {passageList(coverage.withheld_passages, onShowSource)}{' '}
        {coverage.withheld_passages.length === 1 ? 'contains' : 'contain'} instructions addressed to the AI and{' '}
        {coverage.withheld_passages.length === 1 ? 'was' : 'were'} not graded.
      </li>,
    )
  }
  const redacted = coverage.redacted_passages ?? []
  if (redacted.length > 0) {
    lines.push(
      <li key="redacted">
        Read in part — {passageList(redacted, onShowSource)} {redacted.length === 1 ? 'contains' : 'contain'} sentences addressed to the AI;
        those sentences were withheld from the model and the rest was graded. They are marked in the contract text.
      </li>,
    )
  }
  for (const ref of coverage.external_references) {
    lines.push(
      <li key={`ref-${ref.name}`}>
        Depends on a document not uploaded: <strong>{ref.name}</strong> (referred to in {passageList(ref.chunk_indexes, onShowSource)}). What it
        says could not be determined.
      </li>,
    )
  }
  if (lines.length === 0) return null
  return (
    <ul className="coverage" aria-label="Coverage">
      {lines}
    </ul>
  )
}

function passageList(indexes: number[], onShowSource?: (source: SourceRef) => void) {
  const label = indexes.length === 1 ? 'passage' : 'passages'
  return (
    <>
      {label}{' '}
      {indexes.map((index, position) => (
        <span key={index}>
          {position > 0 ? ', ' : ''}
          {onShowSource ? (
            <button type="button" className="link" onClick={() => onShowSource({ chunk_index: index })} aria-label={`Show passage ${index + 1} in contract`}>
              {index + 1}
            </button>
          ) : (
            index + 1
          )}
        </span>
      ))}
    </>
  )
}
