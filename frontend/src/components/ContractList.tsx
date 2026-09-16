import type { Contract } from '../api'

interface Props {
  contracts: Contract[] | null // null while the first load is in flight
  selectedId: string | null
  onSelect: (contract: Contract) => void
  onReload: () => void
}

export function ContractList({ contracts, selectedId, onSelect, onReload }: Props) {
  return (
    <section className="contracts">
      <div className="contracts-header">
        <h2>Contracts</h2>
        <button type="button" onClick={onReload} disabled={contracts === null}>
          Refresh
        </button>
      </div>
      {contracts === null ? (
        <p className="muted">Loading…</p>
      ) : contracts.length === 0 ? (
        <p className="muted">No contracts yet — upload one above.</p>
      ) : (
        <ul>
          {contracts.map((contract) => (
            <li key={contract.contract_id}>
              <button
                type="button"
                className={contract.contract_id === selectedId ? 'contract selected' : 'contract'}
                aria-pressed={contract.contract_id === selectedId}
                onClick={() => onSelect(contract)}
              >
                <span className="contract-name">{contract.filename}</span>
                <span className="contract-meta">
                  {contract.chunk_count} chunk{contract.chunk_count === 1 ? '' : 's'} · {formatSize(contract.size_bytes)} ·{' '}
                  {new Date(contract.created_at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
