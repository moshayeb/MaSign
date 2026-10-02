import type { Contract } from './api'

export interface ReviewBadge {
  label: string
  tone: 'ok' | 'warn' | 'none' | 'running'
}

// One wording for the review state of a contract, used by the sidebar row and
// the contract header (MAS-104). It reads the contract list, which the
// Overview refreshes when a review settles, so both stay in step.
export function reviewBadge(contract: Contract): ReviewBadge {
  switch (contract.risk_status) {
    case 'pending':
    case 'running':
      return { label: 'Reviewing…', tone: 'running' }
    case 'done':
      if (contract.risk_complete === false) {
        return {
          label: contract.risk_worst_severity ? `Partly reviewed · ${contract.risk_worst_severity} risk` : 'Partly reviewed',
          tone: 'warn',
        }
      }
      return contract.risk_worst_severity
        ? { label: `Reviewed · ${contract.risk_worst_severity} risk`, tone: contract.risk_worst_severity === 'Low' ? 'ok' : 'warn' }
        : { label: 'Reviewed', tone: 'ok' }
    case 'failed':
      return { label: 'Review failed', tone: 'warn' }
    default:
      return { label: 'Not reviewed', tone: 'none' }
  }
}

// The document-kind pill (MAS-107): quiet for a contract, amber otherwise; nothing for an unclassified row.
export function kindBadge(contract: Contract): ReviewBadge | null {
  switch (contract.document_kind) {
    case 'contract':
      return { label: 'Commercial contract', tone: 'none' }
    case 'uncertain':
      return { label: contract.document_looks_like ? `Document type uncertain — ${contract.document_looks_like}?` : 'Document type uncertain', tone: 'warn' }
    case 'not_contract':
      return { label: contract.document_looks_like ? `Likely not a contract — ${contract.document_looks_like}` : 'Likely not a contract', tone: 'warn' }
    default:
      return null
  }
}

export interface ProfileBadge {
  label: string
  tone: 'none' | 'accent'
}

// Which embedding profile(s) this contract was actually indexed with (MAS-62
// compare mode, MAS-169 made it reachable live). Quiet info, not a status --
// both profiles are a fine answer, quality is just the pricier opt-in one
// worth calling out. An empty/missing value means "don't know", never
// "portable": honest-outcomes, same as the review and kind badges (the
// backend always reports at least ["portable"] -- migration 014 -- but the
// UI should never assume that on its own).
export function profileBadge(contract: Pick<Contract, 'indexed_profiles'>): ProfileBadge | null {
  const profiles = contract.indexed_profiles
  if (!profiles || profiles.length === 0) return null
  if (profiles.includes('quality')) {
    return { label: profiles.includes('portable') ? 'Portable + Quality indexed' : 'Quality indexed', tone: 'accent' }
  }
  return { label: 'Portable indexed', tone: 'none' }
}

// True when the contract rubric's verdicts may not mean much for this file.
export function rubricMayNotApply(contract: Pick<Contract, 'document_kind'>): boolean {
  return contract.document_kind === 'uncertain' || contract.document_kind === 'not_contract'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
