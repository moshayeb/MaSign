import { useEffect, useState } from 'react'
import { getContractPassages, type Contract, type Passage } from '../api'
import { markQuote } from '../quote'

// Where a value came from: the passage and, when known, the exact words.
export interface SourceRef {
  chunk_index: number
  quote?: string
}

interface Props {
  contract: Contract
  // The source to show; a new object scrolls to it and marks the quote.
  target: SourceRef | null
  // Always expanded (inside its own tab, MAS-95); default collapses until a target arrives.
  open?: boolean
}

// The contract's own text, passage by passage, so every finding, key term
// and citation is one click from the words it came from (MAS-83). Stored
// chunk text only — PDF page positions are a follow-up.
export function PassageReader({ contract, target, open: alwaysOpen = false }: Props) {
  const [passages, setPassages] = useState<Passage[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Open whenever a new target arrives; the user's own toggle wins until the next target.
  const [toggled, setToggled] = useState<{ target: SourceRef | null; open: boolean } | null>(null)
  const open = alwaysOpen || (toggled && toggled.target === target ? toggled.open : target !== null)

  useEffect(() => {
    let cancelled = false
    getContractPassages(contract.contract_id)
      .then((list) => {
        if (!cancelled) setPassages(list)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [contract.contract_id])

  // A target opens the reader and brings its passage into view once rendered.
  useEffect(() => {
    if (!target) return
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`passage-${target.chunk_index}`)
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el?.focus?.({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [target, passages])

  return (
    <details className="card reader" open={open} onToggle={(event) => setToggled({ target, open: event.currentTarget.open })}>
      <summary>
        <span className="card-title">Contract text</span>
        <span className="muted small">
          {' '}
          {contract.filename}
          {passages ? ` · ${passages.length} passage${passages.length === 1 ? '' : 's'}` : ''}
        </span>
      </summary>
      {failed && <p className="muted">The passages could not be loaded. Refresh, or check that the API is running.</p>}
      {passages && passages.length === 0 && <p className="muted">This contract has no stored passages.</p>}
      {passages && passages.length > 0 && (
        <ol className="passages">
          {passages.map((passage) => {
            const isTarget = target?.chunk_index === passage.chunk_index
            return (
              <li
                key={passage.chunk_id}
                id={`passage-${passage.chunk_index}`}
                tabIndex={-1}
                className={isTarget ? 'passage highlighted' : 'passage'}
                aria-current={isTarget ? 'true' : undefined}
              >
                <span className="passage-label muted small">Passage {passage.chunk_index + 1}</span>
                <p>{isTarget && target?.quote ? markQuote(passage.text, target.quote) : passage.text}</p>
              </li>
            )
          })}
        </ol>
      )}
    </details>
  )
}
