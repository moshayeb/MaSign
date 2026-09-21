import { useCallback, useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { listContracts, type Contract, type RiskReview } from './api'
import { AnswerView } from './components/AnswerView'
import { ContractList } from './components/ContractList'
import { QuestionPanel, type Asked } from './components/QuestionPanel'
import { RiskReviewPanel } from './components/RiskReviewPanel'
import { PassageReader, type SourceRef } from './components/PassageReader'
import { Tabs, TabPanel } from './components/Tabs'
import { UploadForm } from './components/UploadForm'
import { Wordmark } from './components/Wordmark'
import { formatSize, reviewBadge } from './reviewStatus'
import { suggestQuestions } from './suggestions'

type Tab = 'overview' | 'ask' | 'text'
const TABS: Tab[] = ['overview', 'ask', 'text']

// The selected contract and tab live in the URL hash (#<contract_id>/<tab>)
// so a refresh, or a pasted link, lands on the same view (MAS-95).
function parseHash(): { contractId: string | null; tab: Tab } {
  const [id, tab] = window.location.hash.replace('#', '').split('/')
  return { contractId: id || null, tab: (TABS as string[]).includes(tab) ? (tab as Tab) : 'overview' }
}

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

function formatUploaded(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function App() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [selected, setSelected] = useState<Contract | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  // The passage a finding or key term was clicked on; the reader scrolls to it (MAS-83).
  const [source, setSource] = useState<SourceRef | null>(null)
  const [draft, setDraft] = useState('')
  // The selected contract's stored review, as the Overview last read it (MAS-108).
  const [review, setReview] = useState<RiskReview | null>(null)
  const [tab, setTabState] = useState<Tab>(() => parseHash().tab)
  const setTab = useCallback((next: Tab) => {
    setTabState(next)
  }, [])
  // Keep the hash in step with the view; clear it when nothing is selected.
  useEffect(() => {
    const next = selected ? `#${selected.contract_id}/${tab}` : ''
    if (window.location.hash !== next) window.history.replaceState(null, '', next || window.location.pathname)
  }, [selected, tab])
  // A pasted link or a refresh: the hash read once at mount, applied when the
  // first contract list arrives (in `load`, not an effect).
  const initialHash = useRef<ReturnType<typeof parseHash> | null>(parseHash())
  // Loads can overlap (Refresh while an upload's reload is in flight); only
  // the most recent request may set the list, whatever order they return in (MAS-66).
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const id = ++latestLoad.current
    const loaded = await listContracts()
    if (id === latestLoad.current) {
      setContracts(loaded)
      const wanted = initialHash.current
      if (wanted) {
        initialHash.current = null
        const match = wanted.contractId ? loaded.find((c) => c.contract_id === wanted.contractId) : undefined
        if (match) {
          setSelected(match)
          setTabState(wanted.tab)
        }
      }
    }
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
    setSelected((current) => {
      if (current?.contract_id !== contract.contract_id) setTab('overview')
      return contract
    })
    setAsked((current) => (current?.contract?.contract_id === contract.contract_id ? current : null))
    setSource(null)
    setReview(null)
  }, [setTab])

  // A finding or key term was clicked: show the text at that passage (MAS-83/95).
  const showSource = useCallback(
    (ref: SourceRef) => {
      setSource(ref)
      setTab('text')
    },
    [setTab],
  )
  // The header's CTA (MAS-104): open the Ask tab with the cursor in the composer.
  const askAbout = useCallback(() => {
    setTab('ask')
    requestAnimationFrame(() => document.getElementById('question-text')?.focus())
  }, [setTab])
  // The list is what refreshes when a review settles; the selected object may be older.
  const current = selected ? (contracts?.find((c) => c.contract_id === selected.contract_id) ?? selected) : null
  const answered = useCallback(
    (next: Asked | null) => {
      setAsked(next)
      if (next) setTab('ask')
    },
    [setTab],
  )

  return (
    <>
      <Toaster position="top-right" theme="light" richColors closeButton />
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="MaSign home">
            <Wordmark height={22} />
          </a>
          <nav className="topnav">
            <span className="tagline">Answers from the contract itself — with the clause to prove it.</span>
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
          {!selected ? (
            <>
              <section className="hero">
                <h1>
                  Ask the contract. <span className="glow">Get the clause that proves it.</span>
                </h1>
                <p>
                  Upload a contract or pick one on the left, then ask in plain language. MaSign answers only from the text, quotes the
                  passages it used, and grades the risky clauses from your side of the deal.
                </p>
              </section>
              <QuestionPanel selected={selected} draft={draft} onDraftChange={setDraft} onAnswered={answered} />
              {asked && <AnswerView asked={asked} contracts={contracts ?? []} />}
              {!asked && (
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
            </>
          ) : (
            <>
              <div className="workspace-head">
                {/* The contract header (MAS-104): what this file is and whether it was reviewed. */}
                <div className="contract-head">
                  <div className="contract-head-main">
                    <h1 className="workspace-title">{current!.filename}</h1>
                    <p className="contract-meta-line">
                      <span className={`filetype ${current!.file_type.toLowerCase()}`}>{current!.file_type.toUpperCase()}</span>
                      <span className="muted small">
                        {formatSize(current!.size_bytes)} · {current!.chunk_count} passage{current!.chunk_count === 1 ? '' : 's'} · uploaded{' '}
                        {formatUploaded(current!.created_at)}
                      </span>
                      <span className={`status ${reviewBadge(current!).tone}`}>{reviewBadge(current!).label}</span>
                    </p>
                  </div>
                  <div className="contract-head-actions">
                    <button type="button" className="primary ask-cta" onClick={askAbout}>
                      Ask MaSign about this contract
                    </button>
                    {/* Plain links: the browser shows the download itself (MAS-97). */}
                    <nav className="downloads" aria-label="Download the review">
                      <span className="muted small">Download</span>
                      <a className="link" href={`/api/contracts/${selected.contract_id}/export.md`} download>
                        Markdown
                      </a>
                      <a className="link" href={`/api/contracts/${selected.contract_id}/export.csv`} download>
                        CSV
                      </a>
                      <button type="button" className="link" onClick={() => window.print()}>
                        Print
                      </button>
                    </nav>
                  </div>
                </div>
                <Tabs
                  label="Contract workspace"
                  active={tab}
                  onChange={setTab}
                  tabs={[
                    { id: 'overview', label: 'Overview' },
                    { id: 'ask', label: 'Ask MaSign', hint: asked ? '· answered' : undefined },
                    { id: 'text', label: 'Contract text' },
                  ]}
                />
              </div>
              <TabPanel id="overview" active={tab}>
                <RiskReviewPanel key={selected.contract_id} contract={selected} onSettled={reload} onShowSource={showSource} onReview={setReview} />
              </TabPanel>
              <TabPanel id="ask" active={tab}>
                <QuestionPanel selected={selected} draft={draft} onDraftChange={setDraft} onAnswered={answered} />
                {/* Suggested questions, ranked by the review (MAS-108); a click fills the composer, Ask sends it. */}
                {!asked && (
                  <div className="examples" aria-label="Suggested questions">
                    <span className="muted">Try:</span>
                    {suggestQuestions(review).map((suggestion) => (
                      <button
                        key={suggestion.text}
                        type="button"
                        className={suggestion.reason ? 'chip ranked' : 'chip'}
                        title={suggestion.reason ?? undefined}
                        onClick={() => {
                          setDraft(suggestion.text)
                          document.getElementById('question-text')?.focus()
                        }}
                      >
                        {suggestion.text}
                      </button>
                    ))}
                  </div>
                )}
                {asked && <AnswerView asked={asked} contracts={contracts ?? []} />}
              </TabPanel>
              <TabPanel id="text" active={tab}>
                <PassageReader key={`reader-${selected.contract_id}`} contract={selected} target={source} open />
              </TabPanel>
            </>
          )}
        </main>
      </div>
    </>
  )
}
