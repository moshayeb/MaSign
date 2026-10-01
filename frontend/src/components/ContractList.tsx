import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { deleteContract, type Contract } from '../api'
import { reviewBadge, rubricMayNotApply } from '../reviewStatus'

interface Props {
  contracts: Contract[] | null // null while the first load is in flight
  selectedId: string | null
  onSelect: (contract: Contract) => void
  onReload: () => void
  // Compare mode (MAS-113): picking exactly two contracts instead of one.
  comparing?: boolean
  compareIds?: string[]
  onToggleCompare?: (contract: Contract) => void
  onStartCompare?: () => void
  onCancelCompare?: () => void
  // A row's own Delete succeeded (MAS-126): the caller drops any selection,
  // draft answer or comparison that pointed at it, then this list reloads.
  onDeleted?: (contractId: string) => void
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

// Fewer badges beside a name (MAS-126): at most one small warning tag, not
// up to two -- a document-kind mismatch is the more consequential thing to
// flag (the whole rubric may not apply), so it wins over "partly readable".
function warningBadge(contract: Contract): { label: string; title: string } | null {
  if (rubricMayNotApply(contract)) {
    return {
      label: contract.document_kind === 'not_contract' ? 'Not a contract?' : 'Type uncertain',
      title: contract.document_kind_reasons?.join(' · ') || 'The file does not read as a commercial contract',
    }
  }
  if ((contract.ingestion_notes?.length ?? 0) > 0) {
    return { label: 'Partly readable', title: contract.ingestion_notes!.join(' ') }
  }
  return null
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

// A row's export/delete menu (MAS-126), portalled to <body> instead of the
// usual <details> dropdown: the contract list scrolls (`.contract-rows`,
// max-height 52vh, overflow-y: auto) and a position: absolute child cannot
// escape that clipping, only position: fixed, positioned from the trigger's
// own on-screen rect, can -- found live in a ui-preview screenshot, not
// guessed at in advance.
function RowActionsMenu({ contract, onDelete }: { contract: Contract; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    const rect = triggerRef.current!.getBoundingClientRect()
    const MENU_WIDTH = 190
    setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - MENU_WIDTH) })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function outside(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    // Closing on scroll (rather than repositioning) matches a native
    // <details> dropdown, which a scroll would also leave stranded.
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('scroll', () => setOpen(false), { capture: true, once: true })
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="row-actions-trigger"
        aria-label={`Actions for ${contract.filename}`}
        title="Actions"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="5" r="1.25" />
          <circle cx="12" cy="12" r="1.25" />
          <circle cx="12" cy="19" r="1.25" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <nav
            ref={menuRef}
            className="actions-list row-actions-list"
            style={{ position: 'fixed', top: pos.top, left: pos.left, right: 'auto', marginTop: 0 }}
            aria-label={`Actions for ${contract.filename}`}
          >
            <a className="export-action" href={`/api/contracts/${contract.contract_id}/export.pdf`} download onClick={() => setOpen(false)}>
              <span>Export PDF</span>
            </a>
            <a className="export-action" href={`/api/contracts/${contract.contract_id}/export.docx`} download onClick={() => setOpen(false)}>
              <span>Export DOCX</span>
            </a>
            <a className="export-action" href={`/api/contracts/${contract.contract_id}/export.md`} download onClick={() => setOpen(false)}>
              <span>Export Markdown</span>
            </a>
            <a className="export-action" href={`/api/contracts/${contract.contract_id}/export.csv`} download onClick={() => setOpen(false)}>
              <span>Export CSV</span>
            </a>
            <a className="export-action" href={`/api/contracts/${contract.contract_id}/export.xlsx`} download onClick={() => setOpen(false)}>
              <span>Export XLSX</span>
            </a>
            <button
              type="button"
              className="export-action danger"
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
            >
              <span>Delete</span>
            </button>
          </nav>,
          document.body,
        )}
    </>
  )
}

// The sidebar list (MAS-104): a search box once there is more than one
// contract, and one line per contract — type, name, review state. Size,
// passage count and date moved to the contract header.
export function ContractList({
  contracts,
  selectedId,
  onSelect,
  onReload,
  comparing = false,
  compareIds = [],
  onToggleCompare,
  onStartCompare,
  onCancelCompare,
  onDeleted,
}: Props) {
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  // Delete is irreversible, so it always confirms first (MAS-126) -- the
  // contract awaiting confirmation, or null when no row's menu asked for it.
  const [deleting, setDeleting] = useState<Contract | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
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

  async function confirmedDelete() {
    if (!deleting) return
    const contract = deleting
    setDeleteBusy(true)
    try {
      await toast.promise(deleteContract(contract.contract_id), {
        loading: `Deleting ${contract.filename}…`,
        success: `${contract.filename} deleted.`,
        error: (e: Error) => e.message,
      }).unwrap()
      setDeleting(null)
      onDeleted?.(contract.contract_id)
      onReload()
    } catch {
      // Already reported by the toast; the dialog stays open so the user can retry or cancel.
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <section className="card contracts">
      <div className="card-header">
        <h2 className="card-title">
          Contracts{contracts ? <span className="count">{contracts.length}</span> : null}
        </h2>
        <span className="card-header-actions">
          {onStartCompare && contracts && contracts.length > 1 && !comparing && (
            <button type="button" className="ghost" onClick={onStartCompare}>
              Compare
            </button>
          )}
          <button type="button" className="ghost" onClick={onReload} disabled={contracts === null}>
            Refresh
          </button>
        </span>
      </div>
      {comparing && (
        <div className="compare-picker" role="status">
          <span>Select two contracts to compare · {compareIds.length} of 2</span>
          <button type="button" className="link" onClick={onCancelCompare}>
            Cancel
          </button>
        </div>
      )}
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
            const warning = warningBadge(contract)
            const checked = compareIds.includes(contract.contract_id)
            const disabled = comparing && !checked && compareIds.length >= 2
            return (
              <li key={contract.contract_id} className="contract-row">
                <button
                  type="button"
                  className={comparing ? `contract${checked ? ' compare-checked' : ''}` : contract.contract_id === selectedId ? 'contract selected' : 'contract'}
                  aria-pressed={comparing ? checked : contract.contract_id === selectedId}
                  disabled={disabled}
                  onClick={() => (comparing ? onToggleCompare?.(contract) : onSelect(contract))}
                >
                  {comparing && (
                    <span className="compare-checkbox" aria-hidden="true">
                      {checked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                  )}
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
                      {warning && (
                        <span className="status warn tiny" title={warning.title}>
                          {warning.label}
                        </span>
                      )}
                    </span>
                    {summaryLine(contract) && <span className="contract-summary">{summaryLine(contract)}</span>}
                  </span>
                </button>
                {/* A context menu per row (MAS-126): export or delete without
                    opening the contract first. Hidden while picking a compare
                    pair -- the row itself is the only control then. */}
                {!comparing && <RowActionsMenu contract={contract} onDelete={() => setDeleting(contract)} />}
              </li>
            )
          })}
        </ul>
      )}
      {deleting && (
        <div className="confirm-box" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <p>
            Delete <strong>{deleting.filename}</strong>? This removes its review, key terms and stored answers, and cannot be undone.
          </p>
          <button type="button" className="primary" onClick={() => void confirmedDelete()} disabled={deleteBusy}>
            Yes, delete it
          </button>
          <button type="button" className="link" onClick={() => setDeleting(null)} disabled={deleteBusy}>
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}
