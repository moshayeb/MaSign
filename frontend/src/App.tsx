import { useCallback, useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { listContracts, type Contract } from './api'
import { AnswerView } from './components/AnswerView'
import { ContractList } from './components/ContractList'
import { Logo } from './components/Logo'
import { QuestionPanel, type Asked } from './components/QuestionPanel'
import { UploadForm } from './components/UploadForm'

const EXAMPLES = ['What is the termination fee?', 'Is there a cap on liability?', 'When are invoices due, and what happens if we pay late?']

export default function App() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [selected, setSelected] = useState<Contract | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  const [draft, setDraft] = useState('')
  // Loads can overlap (Refresh while an upload's reload is in flight); only
  // the most recent request may set the list, whatever order they return in (MAS-66).
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const id = ++latestLoad.current
    const loaded = await listContracts()
    if (id === latestLoad.current) setContracts(loaded)
    return loaded
  }, [])

  // Automatic loads (on mount, after an upload): the outcome is on screen, so
  // only a failure is announced — with the API's detail.
  const reload = useCallback(async () => {
    try {
      await load()
    } catch (error) {
      toast.error((error as Error).message)
      setContracts((current) => current ?? [])
    }
  }, [load])

  // The Refresh button is a user action, so it reports its outcome (MAS-68).
  const refresh = useCallback(async () => {
    try {
      await toast
        .promise(load(), {
          loading: 'Refreshing contracts…',
          success: (list) => `Contract list up to date — ${list.length} contract${list.length === 1 ? '' : 's'}`,
          error: (e: Error) => e.message,
        })
        .unwrap()
    } catch {
      // Already reported by the toast.
      setContracts((current) => current ?? [])
    }
  }, [load])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <>
      <Toaster position="top-right" theme="dark" richColors closeButton />
      <header className="topbar">
        <a className="brand" href="/" aria-label="MaSign home">
          <span className="brand-mark">
            <Logo size={30} />
          </span>
          <span className="brand-text">
            <span className="wordmark">
              MA<span className="accent">SIGN</span>
            </span>
            <span className="brand-sub">Contract intelligence</span>
          </span>
        </a>
        <p className="tagline">Answers from the contract itself — with the clause to prove it.</p>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <UploadForm
            onUploaded={(contract) => {
              setSelected(contract)
              void reload()
            }}
          />
          <ContractList contracts={contracts} selectedId={selected?.contract_id ?? null} onSelect={setSelected} onReload={refresh} />
        </aside>

        <main className="content">
          <QuestionPanel selected={selected} draft={draft} onDraftChange={setDraft} onAnswered={setAsked} />
          {asked ? (
            <AnswerView asked={asked} contracts={contracts ?? []} />
          ) : (
            <section className="card empty-state">
              <Logo size={72} className="empty-logo" />
              <h2>{selected ? `Ask about ${selected.filename}` : 'Upload a contract, or pick one on the left'}</h2>
              <p className="muted">
                Answers quote the passages they come from, say “Not found in contract.” when the text does not cover the question, and flag
                risky clauses graded from your side of the deal.
              </p>
              <div className="examples">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" className="chip" onClick={() => setDraft(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  )
}
