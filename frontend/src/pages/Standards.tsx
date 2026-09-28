import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listStandards, saveStandard, resetStandard, type Standard } from '../api'
import { PageChrome } from '../components/PageChrome'

const CURRENCIES = ['USD', 'EUR', 'SEK'] as const

// The Customer-side positions MaSign compares contract terms against
// (MAS-96/120). Rule-based only: saving or applying a standard never calls
// the model, and a term MaSign could not verify as a number stays "unknown"
// rather than guessing a verdict (honest-outcomes).
export function StandardsPage() {
  const [standards, setStandards] = useState<Standard[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    listStandards()
      .then(setStandards)
      .catch((error: Error) => toast.error(error.message))
  }, [])

  function replace(updated: Standard) {
    setStandards((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev))
  }

  async function save(id: string, params: Record<string, unknown>) {
    setBusyId(id)
    try {
      const updated = await toast
        .promise(saveStandard(id, params), { loading: 'Saving…', success: () => 'Standard saved.', error: (error: Error) => error.message })
        .unwrap()
      replace(updated)
    } catch {
      // Already reported by the toast.
    } finally {
      setBusyId(null)
    }
  }

  async function reset(id: string) {
    setBusyId(id)
    try {
      const updated = await toast
        .promise(resetStandard(id), { loading: 'Restoring default…', success: () => "Restored MaSign's default.", error: (error: Error) => error.message })
        .unwrap()
      replace(updated)
    } catch {
      // Already reported by the toast.
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageChrome>
      <main className="content standards-page">
        <div className="standards-intro">
          <h1>Company standards</h1>
          <p className="muted">
            What MaSign compares a contract's key terms against to flag a deviation on the Overview tab and in the "Before you
            sign" checklist. Every comparison is a fixed rule over a verified number — saving or applying a standard never
            calls the model.
          </p>
        </div>
        {!standards && <p className="muted">Loading…</p>}
        {standards?.map((standard) => (
          <StandardCard key={standard.id} standard={standard} busy={busyId === standard.id} onSave={(params) => save(standard.id, params)} onReset={() => reset(standard.id)} />
        ))}
      </main>
    </PageChrome>
  )
}

interface CardProps {
  standard: Standard
  busy: boolean
  onSave: (params: Record<string, unknown>) => void
  onReset: () => void
}

function StandardCard({ standard, busy, onSave, onReset }: CardProps) {
  return (
    <section className="card standard-card">
      <div className="card-header">
        <h2 className="card-title">{standard.name}</h2>
        <span className={standard.is_default ? 'status none' : 'status ok'}>{standard.is_default ? 'MaSign default' : 'Customised'}</span>
      </div>
      <p className="standard-current">{standard.text}</p>
      <StandardForm standard={standard} busy={busy} onSave={onSave} />
      <button type="button" className="link standard-reset" onClick={onReset} disabled={busy || standard.is_default}>
        Restore MaSign's default
      </button>
    </section>
  )
}

function StandardForm({ standard, busy, onSave }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void }) {
  if (standard.id === 'payment_deadline') return <DaysField standard={standard} busy={busy} onSave={onSave} paramKey="net_days_min" label="Minimum payment deadline (days)" />
  if (standard.id === 'notice_period') return <DaysField standard={standard} busy={busy} onSave={onSave} paramKey="notice_days_max" label="Maximum notice period (days)" />
  if (standard.id === 'late_payment') return <PercentField standard={standard} busy={busy} onSave={onSave} />
  if (standard.id === 'termination_cost') return <TerminationCostFields standard={standard} busy={busy} onSave={onSave} />
  return null
}

function DaysField({ standard, busy, onSave, paramKey, label }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void; paramKey: string; label: string }) {
  const initial = standard.params[paramKey]
  const [value, setValue] = useState(typeof initial === 'number' ? String(initial) : '')
  const inputId = `standard-${standard.id}-days`
  return (
    <form
      className="standard-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ [paramKey]: Number(value) })
      }}
    >
      <label className="standard-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="standard-form-row">
        <input id={inputId} className="standard-input" type="number" min={0} max={3650} step={1} value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} required />
        <button type="submit" className="primary" disabled={busy || value === ''}>
          Save
        </button>
      </div>
    </form>
  )
}

function PercentField({ standard, busy, onSave }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void }) {
  const initial = standard.params.rate_max_per_month_percent
  const [value, setValue] = useState(typeof initial === 'number' ? String(initial) : '')
  const inputId = `standard-${standard.id}-percent`
  return (
    <form
      className="standard-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ rate_max_per_month_percent: Number(value) })
      }}
    >
      <label className="standard-label" htmlFor={inputId}>
        Maximum late-payment interest (% per month)
      </label>
      <div className="standard-form-row">
        <input id={inputId} className="standard-input" type="number" min={0} max={100} step={0.1} value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} required />
        <button type="submit" className="primary" disabled={busy || value === ''}>
          Save
        </button>
      </div>
    </form>
  )
}

function TerminationCostFields({ standard, busy, onSave }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void }) {
  const params = standard.params
  const [mode, setMode] = useState(typeof params.mode === 'string' ? params.mode : 'no_fee')
  const [maxPercent, setMaxPercent] = useState(typeof params.max_percent === 'number' ? String(params.max_percent) : '')
  const [maxAmount, setMaxAmount] = useState(typeof params.max_amount === 'number' ? String(params.max_amount) : '')
  const [currency, setCurrency] = useState(typeof params.currency === 'string' ? params.currency : CURRENCIES[0])
  const prefix = `standard-${standard.id}`

  function submit() {
    if (mode === 'no_fee') return onSave({ mode })
    if (mode === 'percent_cap') return onSave({ mode, max_percent: Number(maxPercent) })
    return onSave({ mode, max_amount: Number(maxAmount), currency })
  }

  return (
    <form
      className="standard-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label className="standard-label" htmlFor={`${prefix}-mode`}>
        Termination-cost preference
      </label>
      <select id={`${prefix}-mode`} className="standard-input" value={mode} onChange={(event) => setMode(event.target.value)} disabled={busy}>
        <option value="no_fee">No early-termination fee allowed</option>
        <option value="percent_cap">Cap at a percent of remaining fees</option>
        <option value="amount_cap">Cap at a fixed amount</option>
      </select>

      {mode === 'percent_cap' && (
        <div className="standard-form-row">
          <input
            aria-label="Maximum termination fee, percent of remaining fees"
            className="standard-input"
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={maxPercent}
            onChange={(event) => setMaxPercent(event.target.value)}
            disabled={busy}
            required
          />
          <span className="muted small">% of remaining fees</span>
        </div>
      )}

      {mode === 'amount_cap' && (
        <div className="standard-form-row">
          <select aria-label="Currency" className="standard-input standard-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <input
            aria-label="Maximum termination fee amount"
            className="standard-input"
            type="number"
            min={0}
            step={1}
            value={maxAmount}
            onChange={(event) => setMaxAmount(event.target.value)}
            disabled={busy}
            required
          />
        </div>
      )}

      <button type="submit" className="primary" disabled={busy || (mode === 'percent_cap' && maxPercent === '') || (mode === 'amount_cap' && maxAmount === '')}>
        Save
      </button>
    </form>
  )
}
