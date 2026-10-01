import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listInvoiceChecks, uploadInvoice, type Contract, type InvoiceCheck, type InvoiceCheckItem, type InvoiceOutcome } from '../api'
import type { SourceRef } from './PassageReader'

interface Props {
  contract: Contract
  onShowSource?: (source: SourceRef) => void
}

const OUTCOME_LABEL: Record<InvoiceOutcome, string> = {
  match: 'Match',
  possible_mismatch: 'Possible mismatch',
  cannot_verify: 'Cannot verify',
}

const OUTCOME_STATUS: Record<InvoiceOutcome, string> = {
  match: 'ok',
  possible_mismatch: 'warn',
  cannot_verify: 'none',
}

type State = 'loading' | 'ready' | 'error'

// Invoice verification (MAS-92): upload a digital PDF invoice and see what
// matches, what possibly does not, and what cannot be verified against the
// contract's own verified key terms. Three outcomes shown distinctly, never
// collapsed into a pass/fail — an ambiguous or unsupported value is "cannot
// verify", not a silent "clean" result (honest-outcomes).
export function InvoiceCheckPanel({ contract, onShowSource }: Props) {
  const [state, setState] = useState<State>('loading')
  const [checks, setChecks] = useState<InvoiceCheck[]>([])
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      setChecks(await listInvoiceChecks(contract.contract_id))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [contract.contract_id])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(file: File) {
    setBusy(true)
    try {
      await toast
        .promise(uploadInvoice(contract.contract_id, file), {
          loading: `Checking ${file.name}…`,
          success: (check) =>
            `${check.matches} match${check.matches === 1 ? '' : 'es'}, ${check.possible_mismatches} possible mismatch${check.possible_mismatches === 1 ? '' : 'es'}, ${check.cannot_verify} not verifiable`,
          error: (e: Error) => e.message,
        })
        .unwrap()
      await load()
    } catch {
      // Already reported by the toast.
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <section className="card invoice-check" aria-live="polite">
      <div className="answer-header">
        <h2>Invoice verification</h2>
      </div>
      <p className="muted small">
        Upload a digital PDF invoice to compare its fee, due date and late-payment rate against this contract's verified key terms.
      </p>
      <label htmlFor="invoice-file" className="dropzone">
        <input
          id="invoice-file"
          ref={input}
          type="file"
          accept=".pdf"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void submit(file)
          }}
          aria-label="Invoice file (digital PDF, up to 10 MB)"
        />
        <span className="dropzone-text">
          <strong>{busy ? 'Checking…' : 'Choose a PDF invoice'}</strong>
        </span>
        <span className="muted small">Digital PDF only · up to 10 MB</span>
      </label>

      {state === 'loading' && checks.length === 0 && <p className="muted small">Loading past checks…</p>}
      {state === 'error' && (
        <p className="badge unverified" role="status">
          Could not load past invoice checks.{' '}
          <button type="button" className="link" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {checks.map((check) => (
        <InvoiceCheckResult key={check.id} check={check} contract={contract} onShowSource={onShowSource} />
      ))}

      {state === 'ready' && checks.length === 0 && <p className="muted small">No invoice has been checked against this contract yet.</p>}
    </section>
  )
}

function InvoiceCheckResult({ check, contract, onShowSource }: { check: InvoiceCheck; contract: Contract; onShowSource?: (source: SourceRef) => void }) {
  return (
    <div className="invoice-check-result">
      <div className="invoice-check-result-head">
        <strong>{check.invoice.filename}</strong>
        <span className="muted small">{new Date(check.created_at).toLocaleString()}</span>
      </div>
      {!check.checked && (
        <p className="badge unverified" role="status">
          The invoice's fields could not be read, so nothing on it could be verified. Re-check it, or read the invoice by hand.
        </p>
      )}
      <ul className="invoice-check-items">
        {check.items.map((item) => (
          <InvoiceCheckItemRow key={item.label} item={item} contract={contract} onShowSource={onShowSource} />
        ))}
      </ul>
    </div>
  )
}

function InvoiceCheckItemRow({ item, contract, onShowSource }: { item: InvoiceCheckItem; contract: Contract; onShowSource?: (source: SourceRef) => void }) {
  const isLinkedDocument = Boolean(item.source_contract_id && item.source_contract_id !== contract.contract_id)
  return (
    <li className={`invoice-check-item ${item.outcome}`}>
      <div className="invoice-check-item-head">
        <span className="invoice-check-item-label">{item.label}</span>
        <span className={`status ${OUTCOME_STATUS[item.outcome]}`}>{OUTCOME_LABEL[item.outcome]}</span>
      </div>
      <p className="muted small">{item.reason}</p>
      {item.invoice_quote && (
        <blockquote className="term-quote">
          “{item.invoice_quote}” <span className="muted small">— invoice{item.invoice_page ? `, page ${item.invoice_page}` : ''}</span>
        </blockquote>
      )}
      {item.contract_quote && (
        <blockquote className="term-quote">
          “{item.contract_quote}”{' '}
          <span className="muted small">
            — contract
            {onShowSource && item.contract_chunk_index !== null && (
              <>
                {', '}
                <button
                  type="button"
                  className="link term-source-link"
                  onClick={() =>
                    onShowSource({
                      contract_id: item.source_contract_id ?? contract.contract_id,
                      chunk_index: item.contract_chunk_index as number,
                      quote: item.contract_quote as string,
                    })
                  }
                >
                  {isLinkedDocument ? 'linked document, ' : ''}passage {(item.contract_chunk_index as number) + 1}
                </button>
              </>
            )}
          </span>
        </blockquote>
      )}
    </li>
  )
}
