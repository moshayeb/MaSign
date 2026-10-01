import { useEffect, useRef } from 'react'
import type { Contract } from '../api'
import { PassageReader, type SourceRef } from './PassageReader'

interface Props {
  contract: Contract
  contracts: Contract[]
  source: SourceRef
  onClose: () => void
}

// MAS-177: on wide screens a citation opens the source passage here, beside
// whatever tab the reader was already on, instead of switching the whole
// workspace to the Sources tab (App.tsx keeps that switch for narrow
// screens, where this panel is never rendered at all). Not a modal: the
// underlying tab stays mounted, visible and scrollable the whole time, so
// there is no backdrop and no focus trap -- only Escape or the close button
// dismiss it, returning focus to whatever citation opened it.
export function SourcePanel({ contract, contracts, source, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="source-panel" role="complementary" aria-label={`Source passage in ${contract.filename}`}>
      <div className="source-panel-head">
        <span className="card-title">Source passage</span>
        <button type="button" className="source-panel-close" aria-label="Close source passage" ref={closeRef} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <PassageReader key={`panel-${contract.contract_id}`} contract={contract} contracts={contracts} target={source} open idPrefix="panel-" />
    </aside>
  )
}
