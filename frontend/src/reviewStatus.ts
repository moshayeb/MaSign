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
      return contract.risk_worst_severity
        ? { label: `Reviewed · ${contract.risk_worst_severity} risk`, tone: contract.risk_worst_severity === 'Low' ? 'ok' : 'warn' }
        : { label: 'Reviewed', tone: 'ok' }
    case 'failed':
      return { label: 'Review failed', tone: 'warn' }
    default:
      return { label: 'Not reviewed', tone: 'none' }
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
