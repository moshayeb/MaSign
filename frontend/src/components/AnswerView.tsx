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
  const filename = (contractId: string) => contracts.find((c) => c.contract_id === contractId)?.filename ?? 'contract'
  const cited = new Set(response.citations.map((c) => c.chunk_id))
  const others = response.retrieved_context.filter((chunk) => !cited.has(chunk.chunk_id))
  const notFound = response.answer === NOT_FOUND

  function jumpTo(label: number) {
    setHighlighted(label)
    document.getElementById(`citation-${label}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
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
    <section className="answer" aria-live="polite">
      <div className="answer-header">
        <h2>Answer</h2>
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
                  <span className="cite-label">[{citation.label}]</span>
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
        <details className="others">
          <summary>
            {response.citations.length ? 'Other passages considered' : 'Passages considered'} ({others.length})
          </summary>
          <ol>
            {others.map((chunk: RetrievedChunk) => (
              <li key={chunk.chunk_id} className="citation">
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
      <p className="muted small">Rule-based placeholder until MAS-15/16; not yet a legal assessment.</p>
      <ul className="risks">
        {response.risks.map((risk) => (
          <li key={risk}>{risk}</li>
        ))}
      </ul>
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
