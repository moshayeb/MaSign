import { useMemo, useState } from 'react'
import type { Contract } from '../api'
import { reviewBadge, rubricMayNotApply } from '../reviewStatus'

interface Props {
  contracts: Contract[] | null // null while the first load is in flight
  selectedId: string | null
  onSelect: (contract: Contract) => void
  onReload: () => void
}

type SortOption = 'newest' | 'risk' | 'deviations'
const SEVERITY_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 }

// The second line under a contract's name (MAS-101): what it costs and how
// risky it is, from stored key terms — no click needed. Null (no second
// line) when there is nothing beyond what the status badge already says —
// no review yet, or a review with no fee/term extracted, no High findings
// and no deviations.
function summaryLine(contract: Contract): string | null {
  if (!contract.risk_status) return null
  const parts: string[] = []
  if (contract.recurring_fee) parts.push(contract.recurring_fee)
  if (contract.initial_term) parts.push(contract.initial_term)
  if (contract.high_findings) parts.push(`${contract.high_findings} High`)
  if (contract.deviations) parts.push(`${contract.deviations} deviation${contract.deviations === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function sortContracts(list: Contract[], sortBy: SortOption): Contract[] {
  if (sortBy === 'newest') return list
  const sorted = [...list]
  if (sortBy === 'risk') {
    sorted.sort(
      (a, b) =>
        (SEVERITY_RANK[b.risk_worst_severity ?? ''] ?? 0) - (SEVERITY_RANK[a.risk_worst_severity ?? ''] ?? 0) ||
        (b.high_findings ?? 0) - (a.high_findings ?? 0),
    )
  } else {
    sorted.sort((a, b) => (b.deviations ?? 0) - (a.deviations ?? 0))
  }
  return sorted
}

function formatShortDate(iso: string): string {
  const date = new Date(iso)
  // Keep the compact duplicate label stable and unambiguous whichever browser
  // locale the visitor uses. The upload timestamp is UTC, so format it as UTC
  // too: a late-night upload must not look like a different day elsewhere.
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// The sidebar list (MAS-104): a search box once there is more than one
// contract, and one line per contract — type, name, review state. Size,
// passage count and date moved to the contract header.
export function ContractList({ contracts, selectedId, onSelect, onReload }: Props) {
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const needle = query.trim().toLowerCase()
  const filtered = contracts?.filter((c) => !needle || c.filename.toLowerCase().includes(needle)) ?? null
  const shown = filtered && sortContracts(filtered, sortBy)
  // Several uploads can share a filename (real data does — MAS-133); a
  // duplicate is distinguishable in the list by its upload date without
  // opening it, counted across every contract, not just the filtered view.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of contracts ?? []) counts.set(c.filename, (counts.get(c.filename) ?? 0) + 1)
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
  }, [contracts])

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
        <div className="contract-list-controls">
          <input
            type="search"
            className="contract-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search contracts"
            aria-label="Search contracts"
          />
          <label className="contract-sort">
            <span className="visually-hidden">Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}>
              <option value="newest">Newest</option>
              <option value="risk">Highest risk</option>
              <option value="deviations">Most deviations</option>
            </select>
          </label>
        </div>
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
                      ) : contract.risk_status === 'done' && contract.risk_complete === false ? (
                        <span className="risk-dot severity-medium" />
                      ) : contract.risk_status === 'done' ? (
                        <span className="risk-dot clean" />
                      ) : null}
                      <span className={`contract-status ${badge.tone}`}>
                        {badge.label}
                        {duplicateNames.has(contract.filename) ? ` · ${formatShortDate(contract.created_at)}` : ''}
                      </span>
                      {rubricMayNotApply(contract) && (
                        <span className="status warn tiny" title={contract.document_kind_reasons?.join(' · ') || 'The file does not read as a commercial contract'}>
                          {contract.document_kind === 'not_contract' ? 'Not a contract?' : 'Type uncertain'}
                        </span>
                      )}
                      {(contract.ingestion_notes?.length ?? 0) > 0 && (
                        <span className="status warn tiny" title={contract.ingestion_notes!.join(' ')}>
                          Partly readable
                        </span>
                      )}
                    </span>
                    {summaryLine(contract) && <span className="contract-summary">{summaryLine(contract)}</span>}
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
