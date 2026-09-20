import { useCallback, useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { listContracts, type Contract } from './api'
import { AnswerView } from './components/AnswerView'
import { ContractList } from './components/ContractList'
import { QuestionPanel, type Asked } from './components/QuestionPanel'
import { RiskReviewPanel } from './components/RiskReviewPanel'
import { PassageReader, type SourceRef } from './components/PassageReader'
import { UploadForm } from './components/UploadForm'
import { Wordmark } from './components/Wordmark'

const EXAMPLES = ['What is the termination fee?', 'Is there a cap on liability?', 'When are invoices due, and what happens if we pay late?']

const FEATURES = [
  {
    title: 'Every answer cites its clause',
    text: 'Each [n] in the answer opens the exact passage it came from, with the file and passage number.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6M8 13h8M8 17h5" />
      </svg>
    ),
  },
  {
    title: 'Honest when the text is silent',
    text: 'If the contract does not cover the question you get “Not found in contract.” — never a guess.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Risky clauses, graded',
    text: 'Liability, termination, auto-renewal and four more categories flagged High / Medium / Low from your side.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    ),
  },
]

export default function App() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [selected, setSelected] = useState<Contract | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  // The passage a finding or key term was clicked on; the reader scrolls to it (MAS-83).
  const [source, setSource] = useState<SourceRef | null>(null)
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

  // An answer belongs to the contract it was asked about: a different
  // selection clears it so contract A's answer never sits under contract B's
  // review (MAS-86). The draft question stays.
  const select = useCallback((contract: Contract) => {
    setSelected(contract)
    setAsked((current) => (current?.contract?.contract_id === contract.contract_id ? current : null))
    setSource(null)
  }, [])

  return (
    <>
      <Toaster position="top-right" theme="dark" richColors closeButton />
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="MaSign home">
            <Wordmark height={22} />
          </a>
          <nav className="topnav">
            <span className="tagline">Answers from the contract itself — with the clause to prove it.</span>
            <a href="/docs">API docs</a>
          </nav>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <UploadForm
            onUploaded={(contract) => {
              select(contract)
              void reload()
            }}
          />
          <ContractList contracts={contracts} selectedId={selected?.contract_id ?? null} onSelect={select} onReload={refresh} />
        </aside>

        <main className="content">
          {!asked && (
            <section className="hero">
              <h1>
                Ask the contract. <span className="glow">Get the clause that proves it.</span>
              </h1>
              <p>
                {selected
                  ? `${selected.filename} is selected — ask anything about it below.`
                  : 'Upload a contract or pick one on the left, then ask in plain language. MaSign answers only from the text, quotes the passages it used, and grades the risky clauses from your side of the deal.'}
              </p>
            </section>
          )}

          <QuestionPanel selected={selected} draft={draft} onDraftChange={setDraft} onAnswered={setAsked} />

          {!asked && selected && (
            <div className="examples">
              <span className="muted">Try:</span>
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="chip" onClick={() => setDraft(example)}>
                  {example}
                </button>
              ))}
            </div>
          )}

          {asked && <AnswerView asked={asked} contracts={contracts ?? []} />}

          {selected && (
            <RiskReviewPanel key={selected.contract_id} contract={selected} onSettled={reload} onShowSource={setSource} />
          )}
          {selected && <PassageReader key={`reader-${selected.contract_id}`} contract={selected} target={source} />}

          {!asked && !selected && (
            <>
              <div className="examples">
                <span className="muted">Try:</span>
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" className="chip" onClick={() => setDraft(example)}>
                    {example}
                  </button>
                ))}
              </div>
              <div className="features">
                {FEATURES.map((feature) => (
                  <section key={feature.title} className="card feature">
                    <div className="feature-icon" aria-hidden="true">
                      {feature.icon}
                    </div>
                    <h2>{feature.title}</h2>
                    <p>{feature.text}</p>
                  </section>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}
