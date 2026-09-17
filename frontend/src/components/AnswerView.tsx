import { Fragment, useState } from 'react'
import { toast } from 'sonner'
import type { CitedChunk, Contract, RetrievedChunk } from '../api'
import type { Asked } from './QuestionPanel'

interface Props {
  asked: Asked
  contracts: Contract[] // to name each passage's source file
}

const NOT_FOUND = 'Not found in contract.'
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g

export function AnswerView({ asked, contracts }: Props) {
  const { question, contract, response } = asked
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const [othersOpen, setOthersOpen] = useState(false)
  const filename = (contractId: string) => contracts.find((c) => c.contract_id === contractId)?.filename ?? 'contract'
  const cited = new Set(response.citations.map((c) => c.chunk_id))
  const others = response.retrieved_context.filter((chunk) => !cited.has(chunk.chunk_id))
  const notFound = response.answer === NOT_FOUND

  function jumpTo(label: number) {
    setHighlighted(label)
    // A risk flag may point at a passage that was considered but not cited,
    // which lives in the collapsed list: open it first, scroll once it shows.
    const isCited = response.citations.some((c) => c.label === label)
    if (!isCited) setOthersOpen(true)
    requestAnimationFrame(() =>
      document.getElementById(`citation-${label}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
    )
  }

  async function copy(citation: CitedChunk) {
    const source = `${filename(citation.contract_id)}, passage ${citation.chunk_index + 1}`
    try {
      await navigator.clipboard.writeText(`"${citation.text}" — ${source}`)
      toast.success(`Citation [${citation.label}] copied`)
    } catch {
      toast.error('Could not copy: the browser refused clipboard access.')
    }
  }

  return (
    <section className="card answer" aria-live="polite">
      <div className="answer-header">
        <h2>
          Answer
          {notFound ? (
            <span className="status none">Not in the text</span>
          ) : response.grounded ? (
            <span className="status ok">
              Grounded · {response.citations.length} passage{response.citations.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="status warn">Unverified</span>
          )}
        </h2>
        <span className="muted answer-scope">
          {contract ? contract.filename : 'all contracts'}
          {response.answer_model ? ` · ${response.answer_model}` : ''}
        </span>
      </div>
      <p className="answer-question muted">“{question}”</p>

      {notFound ? (
        <p className="answer-text not-found">
          {NOT_FOUND} <span className="muted">The retrieved passages do not cover this question; they are listed below so you can check.</span>
        </p>
      ) : (
        <p className="answer-text">{renderWithMarkers(response.answer, jumpTo)}</p>
      )}

      {!notFound && !response.grounded && (
        <p className="badge unverified" role="status">
          Unverified — this answer is incomplete or not fully backed by the cited passages. Read the passages before relying on it.
        </p>
      )}

      {response.citations.length > 0 && (
        <>
          <h3>Cited passages</h3>
          <ol className="citations">
            {response.citations.map((citation) => (
              <li
                key={citation.chunk_id}
                id={`citation-${citation.label}`}
                className={highlighted === citation.label ? 'citation highlighted' : 'citation'}
              >
                <div className="citation-head">
                  <span className="cite-label">{citation.label}</span>
                  <span className="muted">
                    {filename(citation.contract_id)}, passage {citation.chunk_index + 1} · relevance {Math.round(citation.score * 100)}%
                  </span>
                  <button type="button" className="link" onClick={() => void copy(citation)}>
                    Copy
                  </button>
                </div>
                <blockquote>{citation.text}</blockquote>
              </li>
            ))}
          </ol>
        </>
      )}

      {others.length > 0 && (
        <details className="others" open={othersOpen} onToggle={(event) => setOthersOpen(event.currentTarget.open)}>
          <summary>
            {response.citations.length ? 'Other passages considered' : 'Passages considered'} ({others.length})
          </summary>
          <ol>
            {others.map((chunk: RetrievedChunk) => (
              <li
                key={chunk.chunk_id}
                id={`citation-${response.retrieved_context.indexOf(chunk) + 1}`}
                className={highlighted === response.retrieved_context.indexOf(chunk) + 1 ? 'citation highlighted' : 'citation'}
              >
                <div className="citation-head">
                  <span className="muted">
                    {filename(chunk.contract_id)}, passage {chunk.chunk_index + 1} · relevance {Math.round(chunk.score * 100)}%
                  </span>
                </div>
                <blockquote>{chunk.text}</blockquote>
              </li>
            ))}
          </ol>
        </details>
      )}

      <h3>Risk flags</h3>
      {!response.risks_checked ? (
        <p className="badge unverified" role="status">
          Risk analysis was unavailable for this answer. Ask again, or read the passages above.
        </p>
      ) : response.risks.length === 0 ? (
        <p className="muted small">No risk flagged in the retrieved passages. Other parts of the contract were not checked.</p>
      ) : (
        <>
          {!response.risks_complete && (
            <p className="badge unverified" role="status">
              Incomplete analysis — some of the model's findings could not be verified against the passages and were left out. The flags
              below are verified.
            </p>
          )}
        <ul className="risks">
          {response.risks.map((risk) => (
            <li key={`${risk.category}-${risk.chunk_id}`} className={`risk severity-${risk.severity.toLowerCase()}`}>
              <div className="risk-head">
                <span className="severity">{risk.severity}</span>
                <strong>{risk.category_name}</strong>
                <button type="button" className="cite-marker" onClick={() => jumpTo(risk.label)} aria-label={`Show passage ${risk.label}`}>
                  [{risk.label}]
                </button>
              </div>
              <p className="risk-reason">{risk.reason}</p>
              <blockquote>“{risk.quote}”</blockquote>
            </li>
          ))}
        </ul>
        </>
      )}
      <p className="muted disclaimer">Graded from the Customer's side with MaSign's rubric (docs/risk-rubric.md); a first read, not legal advice.</p>
      {response.recommended_actions.length > 0 && (
        <>
          <h3>Suggested next steps</h3>
          <ul className="actions">
            {response.recommended_actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// "The fee is EUR 18,500 [1][3]." -> text with each [n] as a button that
// jumps to the cited passage. Unknown labels stay as plain text.
function renderWithMarkers(text: string, jumpTo: (label: number) => void) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(MARKER)) {
    const start = match.index ?? 0
    parts.push(text.slice(last, start))
    const labels = match[1].split(',').map((n) => Number(n.trim()))
    parts.push(
      <Fragment key={start}>
        {labels.map((label, i) => (
          <button key={i} type="button" className="cite-marker" onClick={() => jumpTo(label)} aria-label={`Show cited passage ${label}`}>
            [{label}]
          </button>
        ))}
      </Fragment>,
    )
    last = start + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}
