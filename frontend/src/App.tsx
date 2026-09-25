import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { listContracts, type Contract, type RiskReview } from './api'
import { AnswerView } from './components/AnswerView'
import { ContractList } from './components/ContractList'
import { PageChrome } from './components/PageChrome'
import { QuestionPanel, type Asked } from './components/QuestionPanel'
import { RiskReviewPanel } from './components/RiskReviewPanel'
import { PassageReader, type SourceRef } from './components/PassageReader'
import { Tabs, TabPanel } from './components/Tabs'
import { UploadForm } from './components/UploadForm'
import { formatSize, kindBadge, reviewBadge } from './reviewStatus'
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

type ExportIconName = 'more' | 'pdf' | 'markdown' | 'csv' | 'print'

function ExportIcon({ name }: { name: ExportIconName }) {
  const paths: Record<ExportIconName, ReactNode> = {
    more: <><circle cx="5" cy="12" r="1.25" /><circle cx="12" cy="12" r="1.25" /><circle cx="19" cy="12" r="1.25" /></>,
    pdf: <><path d="M7 3h7l3 3v15H7z" /><path d="M14 3v4h4M9 15h6M9 18h4" /></>,
    markdown: <><path d="M4 5h16v14H4z" /><path d="M7 15V9l3 3 3-3v6M15 12h2" /></>,
    csv: <><path d="M7 3h7l3 3v15H7z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    print: <><path d="M7 8V3h10v5M6 18H4v-7h16v7h-2M7 15h10v6H7z" /><path d="M17 13h.01" /></>,
  }
  return <svg className="export-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function formatUploaded(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function App() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [selected, setSelected] = useState<Contract | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  // Before any contract is selected, the composer stays hidden behind this
  // secondary trigger rather than being the default view (MAS-133): a new
  // visitor sees "pick or upload a contract" first, not a question box.
  const [askAllContracts, setAskAllContracts] = useState(false)
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
    setAskAllContracts(false)
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
  // After a selection the workspace must be where the reader is looking: the
  // heading takes focus (so the keyboard follows the eye), and on a phone —
  // where the sidebar sits above the workspace — it is scrolled into view.
  // On a wide screen the workspace is already visible and the page stays put:
  // a page that jumps under the mouse is worse than one that does not move.
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Seeded with the contract the URL hash names, so a page opened on a link
  // does not start with a focus ring on its heading: focus follows a
  // selection the reader made, not the act of arriving.
  const focused = useRef<string | null>(parseHash().contractId)
  useEffect(() => {
    if (!selected || focused.current === selected.contract_id) return
    focused.current = selected.contract_id
    const heading = headingRef.current
    if (!heading) return
    heading.focus({ preventScroll: true })
    if (window.matchMedia?.('(max-width: 960px)')?.matches) {
      heading.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    }
  }, [selected])

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
    <PageChrome>
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
              {!askAllContracts && !asked && (
                // The composer is not the first thing a new visitor sees
                // (MAS-133): pick or upload a contract is the primary task
                // here, "ask across all contracts" is a smaller secondary
                // option below it, not the default view.
                <section className="card empty-state">
                  <h1>Select a contract to get started</h1>
                  <p className="muted">Choose one from the list on the left, or upload a new contract, to ask questions and see its risk review.</p>
                  <button type="button" className="link" onClick={() => setAskAllContracts(true)}>
                    Or ask a question across all contracts
                  </button>
                </section>
              )}
              {(askAllContracts || asked) && (
                <>
                  <QuestionPanel selected={selected} draft={draft} onDraftChange={setDraft} onAnswered={answered} />
                  {asked && <AnswerView asked={asked} contracts={contracts ?? []} />}
                  {!asked && (
                    <div className="examples">
                      <span className="muted">Try:</span>
                      {EXAMPLES.map((example) => (
                        <button key={example} type="button" className="chip" onClick={() => setDraft(example)}>
                          {example}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="workspace-head">
                {/* The contract header (MAS-104): what this file is and whether it was reviewed. */}
                <div className="contract-head">
                  <div className="contract-head-main">
                    {/* tabIndex -1: focusable from code after a selection, never in the tab order. */}
                    <h1 className="workspace-title" tabIndex={-1} ref={headingRef}>
                      {current!.filename}
                    </h1>
                    <p className="contract-meta-line">
                      <span className={`filetype ${current!.file_type.toLowerCase()}`}>{current!.file_type.toUpperCase()}</span>
                      <span className="muted small">
                        {formatSize(current!.size_bytes)} · {current!.chunk_count} passage{current!.chunk_count === 1 ? '' : 's'} · uploaded{' '}
                        {formatUploaded(current!.created_at)}
                      </span>
                      <span className={`status ${reviewBadge(current!).tone}`}>{reviewBadge(current!).label}</span>
                      {kindBadge(current!) && (
                        <span className={`status ${kindBadge(current!)!.tone}`} title={current!.document_kind_reasons?.join(' · ') || undefined}>
                          {kindBadge(current!)!.label}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="contract-head-actions">
                    <button type="button" className="primary ask-cta" onClick={askAbout}>
                      Ask MaSign about this contract
                    </button>
                    {/* One primary button per screen.  Exports stay compact, while
                        aria-label and title keep each icon understandable (MAS-154). */}
                    <details className="actions-menu">
                      <summary aria-label="Export and print options" title="Export and print options"><ExportIcon name="more" /></summary>
                      <nav className="actions-list" aria-label="Export and print options">
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.pdf`} download aria-label="Download PDF" title="Download PDF">
                          <ExportIcon name="pdf" />
                        </a>
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.md`} download aria-label="Download Markdown" title="Download Markdown">
                          <ExportIcon name="markdown" />
                        </a>
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.csv`} download aria-label="Download CSV" title="Download CSV">
                          <ExportIcon name="csv" />
                        </a>
                        <button type="button" className="export-action" onClick={() => window.print()} aria-label="Print" title="Print">
                          <ExportIcon name="print" />
                        </button>
                      </nav>
                    </details>
                  </div>
                </div>
                <Tabs
                  label="Contract workspace"
                  active={tab}
                  onChange={setTab}
                  tabs={[
                    { id: 'overview', label: 'Overview' },
                    { id: 'ask', label: 'Ask MaSign', hint: asked ? '· answered' : undefined },
                    { id: 'text', label: 'Sources' },
                  ]}
                />
              </div>
              <TabPanel id="overview" active={tab}>
                <RiskReviewPanel key={selected.contract_id} contract={selected} contracts={contracts ?? []} onSettled={reload} onShowSource={showSource} onReview={setReview} />
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
                <PassageReader key={`reader-${selected.contract_id}`} contract={selected} contracts={contracts ?? []} target={source} open />
              </TabPanel>
            </>
          )}
        </main>
      </div>
    </PageChrome>
  )
}
