import { useState } from 'react'
import type { Contract } from '../api'
import { reviewBadge } from '../reviewStatus'

interface Props {
  contracts: Contract[] | null // null while the first load is in flight
  selectedId: string | null
  onSelect: (contract: Contract) => void
  onReload: () => void
}

// The sidebar list (MAS-104): a search box once there is more than one
// contract, and one line per contract — type, name, review state. Size,
// passage count and date moved to the contract header.
export function ContractList({ contracts, selectedId, onSelect, onReload }: Props) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = contracts?.filter((c) => !needle || c.filename.toLowerCase().includes(needle)) ?? null

  return (
    <section className="card contracts">
      <div className="card-header">
        <h2 className="card-title">
          Contracts{contracts ? <span className="count">{contracts.length}</span> : null}
        </h2>
        <button type="button" className="ghost" onClick={onReload} disabled={contracts === null}>
          Refresh
        </button>
      </div>
      {contracts && contracts.length > 1 && (
        <input
          type="search"
          className="contract-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contracts"
          aria-label="Search contracts"
        />
      )}
      {contracts === null ? (
        <p className="muted">Loading…</p>
      ) : contracts.length === 0 ? (
        <p className="muted">No contracts yet — upload one above.</p>
      ) : shown!.length === 0 ? (
        <p className="muted small">No contract matches “{query.trim()}”.</p>
      ) : (
        <ul className="contract-rows">
          {shown!.map((contract) => {
            const badge = reviewBadge(contract)
            return (
              <li key={contract.contract_id}>
                <button
                  type="button"
                  className={contract.contract_id === selectedId ? 'contract selected' : 'contract'}
                  aria-pressed={contract.contract_id === selectedId}
                  onClick={() => onSelect(contract)}
                >
                  <span className={`filetype ${contract.file_type.toLowerCase()}`}>{contract.file_type.toUpperCase()}</span>
                  <span className="contract-text">
                    <span className="contract-name">{contract.filename}</span>
                    <span className="contract-meta">
                      {badge.tone === 'running' ? (
                        <span className="risk-dot running" />
                      ) : contract.risk_worst_severity && contract.risk_status === 'done' ? (
                        <span className={`risk-dot severity-${contract.risk_worst_severity.toLowerCase()}`} />
                      ) : contract.risk_status === 'done' ? (
                        <span className="risk-dot clean" />
                      ) : null}
                      <span className={`contract-status ${badge.tone}`}>{badge.label}</span>
                      {(contract.ingestion_notes?.length ?? 0) > 0 && (
                        <span className="status warn tiny" title={contract.ingestion_notes!.join(' ')}>
                          Partly readable
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
