import { useEffect, useState } from 'react'
import { getContractPassages, listContractLinks, type Contract, type Passage } from '../api'
import { markQuote, markSpans } from '../quote'

// Where a value came from: the passage and, when known, the exact words.
export interface SourceRef {
  contract_id?: string
  chunk_index: number
  quote?: string
}

interface Props {
  contract: Contract
  contracts?: Contract[]
  // The source to show; a new object scrolls to it and marks the quote.
  target: SourceRef | null
  // Always expanded (inside its own tab, MAS-95); default collapses until a target arrives.
  open?: boolean
}

// A literal `[]` default would allocate a new array every render, which
// breaks the effect below's dependency check and causes an infinite
// render loop (MAS-157: this is what actually OOM'd Reader.test.tsx, not
// the test's heap size).
const NO_CONTRACTS: Contract[] = []

// The contract's own text, passage by passage, so every finding, key term
// and citation is one click from the words it came from (MAS-83). Stored
// chunk text only — PDF page positions are a follow-up.
export function PassageReader({ contract, contracts = NO_CONTRACTS, target, open: alwaysOpen = false }: Props) {
  const [passages, setPassages] = useState<Passage[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [members, setMembers] = useState<Contract[]>([contract])
  const [activeId, setActiveId] = useState(contract.contract_id)
  // Open whenever a new target arrives; the user's own toggle wins until the next target.
  const [toggled, setToggled] = useState<{ target: SourceRef | null; open: boolean } | null>(null)
  const open = alwaysOpen || (toggled && toggled.target === target ? toggled.open : target !== null)

  useEffect(() => {
    setActiveId(target?.contract_id ?? contract.contract_id)
  }, [contract.contract_id, target?.contract_id])

  useEffect(() => {
    if (contracts.length < 2) {
      setMembers([contract])
      return undefined
    }
    let cancelled = false
    Promise.all(contracts.map((item) => listContractLinks(item.contract_id)))
      .then((groups) => {
        if (cancelled) return
        const ids = new Set([contract.contract_id])
        for (const link of groups.flat()) {
          if (link.primary_contract_id === contract.contract_id) ids.add(link.linked_contract_id)
          if (link.linked_contract_id === contract.contract_id) ids.add(link.primary_contract_id)
        }
        setMembers(contracts.filter((item) => ids.has(item.contract_id)))
      })
      .catch(() => !cancelled && setMembers([contract]))
    return () => { cancelled = true }
  }, [contract, contracts])

  const active = members.find((item) => item.contract_id === activeId) ?? contract
  useEffect(() => {
    let cancelled = false
    setPassages(null)
    setFailed(false)
    getContractPassages(active.contract_id)
      .then((list) => {
        if (!cancelled) setPassages(list)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [active.contract_id])

  // A target opens the reader and brings its passage into view once rendered.
  useEffect(() => {
    if (!target || (target.contract_id && target.contract_id !== active.contract_id)) return
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`passage-${target.chunk_index}`)
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el?.focus?.({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [active.contract_id, target, passages])

  return (
    <details className="card reader" open={open} onToggle={(event) => setToggled({ target, open: event.currentTarget.open })}>
      <summary>
        <span className="card-title">Contract text</span>
        <span className="muted small">
          {' '}
          {active.filename}
          {passages ? ` · ${passages.length} passage${passages.length === 1 ? '' : 's'}` : ''}
        </span>
      </summary>
      {members.length > 1 && (
        <div className="reader-documents" role="tablist" aria-label="Documents in this review">
          {members.map((item) => (
            <button key={item.contract_id} type="button" role="tab" aria-selected={item.contract_id === active.contract_id} onClick={() => setActiveId(item.contract_id)}>
              {item.filename}
            </button>
          ))}
        </div>
      )}
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
                <p>
                  {isTarget && target?.quote
                    ? markQuote(passage.text, target.quote, passage.withheld_spans)
                    : markSpans(passage.text, passage.withheld_spans ?? [])}
                </p>
                {(passage.withheld_spans?.length ?? 0) > 0 && (
                  <span className="muted small withheld-note">
                    {passage.withheld_spans!.length === 1 ? 'The underlined sentence was' : 'The underlined sentences were'} withheld from the model
                    (instructions addressed to the AI).
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </details>
  )
}
