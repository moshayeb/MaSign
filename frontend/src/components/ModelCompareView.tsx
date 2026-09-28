import type { Contract } from '../api'
import type { Compared } from './QuestionPanel'
import { AnswerView } from './AnswerView'
import type { SourceRef } from './PassageReader'

interface Props {
  compared: Compared
  contracts: Contract[]
  onShowSource?: (source: SourceRef) => void
  onClose: () => void
}

const PROFILE_LABEL: Record<'portable' | 'quality', string> = {
  portable: 'Portable · ModernBERT',
  quality: 'Quality · Qwen3-Embedding-4B',
}

// The same question, answered from both embedding profiles' own retrieval
// (MAS-62) -- two independent /api/query calls, so two independent answers,
// citations and risk flags; AnswerView renders each exactly as it would
// alone, just side by side, so nothing about a single answer's behaviour
// (click-to-source, withheld passages, grounded/not-found) needs re-implementing.
export function ModelCompareView({ compared, contracts, onShowSource, onClose }: Props) {
  const { question, contract, portable, quality } = compared

  return (
    <section className="card model-compare" aria-label="Embedding model comparison">
      <div className="answer-header">
        <h2>Comparing embedding models</h2>
        <button type="button" className="link" onClick={onClose}>
          Exit comparison
        </button>
      </div>
      <p className="muted small model-compare-question">“{question}”</p>
      <div className="model-compare-columns">
        <div className="model-compare-column">
          <h3 className="model-compare-label">{PROFILE_LABEL.portable}</h3>
          <AnswerView asked={{ question, contract, response: portable }} contracts={contracts} onShowSource={onShowSource} />
        </div>
        <div className="model-compare-column">
          <h3 className="model-compare-label">{PROFILE_LABEL.quality}</h3>
          <AnswerView asked={{ question, contract, response: quality }} contracts={contracts} onShowSource={onShowSource} />
        </div>
      </div>
      <p className="muted disclaimer">
        Each side is retrieved and answered independently by its own model; nothing here is scored or ranked — read both before
        deciding which to trust for this question.
      </p>
    </section>
  )
}
