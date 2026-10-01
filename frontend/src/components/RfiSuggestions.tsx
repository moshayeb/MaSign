import { useState } from 'react'
import { toast } from 'sonner'
import { requestRfi, type RfiSuggestion } from '../api'
import { CALLS_PER_RFI, formatCalls } from '../cost'

interface Props {
  contractId: string
  chunkId: string
  category: string
  categoryName: string
  // This finding's own already-stored suggestions (MAS-189), newest first.
  suggestions: RfiSuggestion[]
  onGenerated: (suggestion: RfiSuggestion) => void
}

// Drafts a clarifying question to send the contract's counterparty about a
// flagged finding -- the first MaSign output the model GENERATES rather
// than extracts, so it is deliberately never a `.card` and never shares a
// ReviewFinding's verified-content styling: a persistent, unmistakable
// "AI-drafted, unverified" label on every rendered question, cost shown
// before the one-call request (MAS-122), copy-to-clipboard only, no
// auto-apply. Never a replacement clause ("redline") -- that is its own,
// not-yet-scoped decision (MAS-189's ticket).
export function RfiSuggestions({ contractId, chunkId, category, categoryName, suggestions, onGenerated }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [generating, setGenerating] = useState(false)
  const cost = formatCalls(CALLS_PER_RFI)

  async function generate() {
    setConfirming(false)
    setGenerating(true)
    try {
      const suggestion = await toast
        .promise(requestRfi(contractId, chunkId, category), {
          loading: 'Drafting a clarifying question…',
          success: () => 'Drafted a clarifying question.',
          error: (error: Error) => error.message,
        })
        .unwrap()
      onGenerated(suggestion)
    } catch {
      // Already reported by the toast.
    } finally {
      setGenerating(false)
    }
  }

  async function copy(question: string) {
    try {
      await navigator.clipboard.writeText(question)
      toast.success('Question copied')
    } catch {
      toast.error('Could not copy: the browser refused clipboard access.')
    }
  }

  return (
    <div className="rfi-suggestions">
      {suggestions.map((suggestion) => (
        <div key={suggestion.id} className="rfi-suggestion" role="note">
          <p className="rfi-label">AI-drafted · Unverified · Not legal advice — read and edit before sending</p>
          <p className="rfi-question">{suggestion.question}</p>
          <button type="button" className="ghost" onClick={() => void copy(suggestion.question)}>
            Copy
          </button>
        </div>
      ))}

      {confirming ? (
        <p className="rfi-confirm" role="status">
          Draft a clarifying question to send the counterparty about this finding? Costs {cost}.
          <button type="button" className="ghost" onClick={() => void generate()} disabled={generating}>
            Yes, draft it
          </button>
          <button type="button" className="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <button
          type="button"
          className="link rfi-request"
          onClick={() => setConfirming(true)}
          disabled={generating}
          aria-label={`Ask MaSign to draft a clarifying question about this ${categoryName} finding`}
        >
          Ask MaSign to draft a clarifying question ({cost})
        </button>
      )}
    </div>
  )
}
