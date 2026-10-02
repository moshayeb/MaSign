import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ApiError, getCurrentUser, listContracts, logout as apiLogout, type Contract, type CurrentUser, type RiskReview } from './api'
import { AnswerView } from './components/AnswerView'
import { CompareView } from './components/CompareView'
import { ContractList } from './components/ContractList'
import { InvoiceCheckPanel } from './components/InvoiceCheckPanel'
import { ModelCompareView } from './components/ModelCompareView'
import { PageChrome } from './components/PageChrome'
import { PreviousQuestions } from './components/PreviousQuestions'
import { QuestionPanel, type Asked, type Compared } from './components/QuestionPanel'
import { RiskReviewPanel, type ReviewAction, type RiskReviewPanelHandle } from './components/RiskReviewPanel'
import { PassageReader, type SourceRef } from './components/PassageReader'
import { SourcePanel } from './components/SourcePanel'
import { Tabs, TabPanel } from './components/Tabs'
import { UploadForm } from './components/UploadForm'
import { formatSize, kindBadge, profileBadge, reviewBadge } from './reviewStatus'
import { suggestQuestions } from './suggestions'
import { useIsWide } from './useIsWide'

type Tab = 'overview' | 'ask' | 'invoices' | 'text'
const TABS: Tab[] = ['overview', 'ask', 'invoices', 'text']

// The selected contract and tab live in the URL hash (#<contract_id>/<tab>)
// so a refresh, or a pasted link, lands on the same view (MAS-95).
function parseHash(): { contractId: string | null; tab: Tab } {
  const [id, tab] = window.location.hash.replace('#', '').split('/')
  return { contractId: id || null, tab: (TABS as string[]).includes(tab) ? (tab as Tab) : 'overview' }
}

const EXAMPLES = ['What is the termination fee?', 'Is there a cap on liability?', 'When are invoices due, and what happens if we pay late?']

type ExportIconName = 'more' | 'document' | 'pdf' | 'markdown' | 'csv' | 'print' | 'review'

function ExportIcon({ name }: { name: ExportIconName }) {
  const paths: Record<ExportIconName, ReactNode> = {
    more: <><circle cx="5" cy="12" r="1.25" /><circle cx="12" cy="12" r="1.25" /><circle cx="19" cy="12" r="1.25" /></>,
    document: <><path d="M7 3h7l3 3v15H7z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    pdf: <><path d="M7 3h7l3 3v15H7z" /><path d="M14 3v4h4M9 15h6M9 18h4" /></>,
    markdown: <><path d="M4 5h16v14H4z" /><path d="M7 15V9l3 3 3-3v6M15 12h2" /></>,
    csv: <><path d="M7 3h7l3 3v15H7z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    print: <><path d="M7 8V3h10v5M6 18H4v-7h16v7h-2M7 15h10v6H7z" /><path d="M17 13h.01" /></>,
    review: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" /></>,
  }
  return <svg className="export-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function formatUploaded(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function App() {
  // The signed-in user, once known (MAS-143). The shell renders immediately
  // regardless -- same as before this ticket, when the contract list alone
  // started empty and filled in once its own request settled -- rather than
  // blocking the whole page on this one extra request. A confirmed 401
  // redirects to /login as a side effect; any other failure (API
  // unreachable, etc.) just leaves the header without an email/logout shown,
  // and the normal contract-list load below reports its own error as usual.
  const [user, setUser] = useState<CurrentUser | null>(null)
  useEffect(() => {
    let cancelled = false
    getCurrentUser()
      .then((current) => {
        if (!cancelled) setUser(current)
      })
      .catch((error) => {
        if (!cancelled && error instanceof ApiError && error.status === 401) {
          window.location.href = '/login'
        }
      })
    return () => {
      cancelled = true
    }
  }, [])
  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      window.location.href = '/login'
    }
  }, [])

  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [selected, setSelected] = useState<Contract | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  // A question answered by both embedding profiles at once (MAS-62); shown
  // instead of the normal single answer until closed. Independent of `asked`
  // so a live compare and a live single ask never fight over one slot.
  const [compared, setCompared] = useState<Compared | null>(null)
  // Bumped after a live answer is stored (MAS-102), so the previous-questions
  // list refetches and shows it without a page reload.
  const [questionsVersion, setQuestionsVersion] = useState(0)
  // Before any contract is selected, the composer stays hidden behind this
  // secondary trigger rather than being the default view (MAS-133): a new
  // visitor sees "pick or upload a contract" first, not a question box.
  const [askAllContracts, setAskAllContracts] = useState(false)
  // Up to two contracts picked for side-by-side comparison (MAS-113). Two
  // picks replace the main view with CompareView; picking a contract while
  // one is selected does not clear that selection until the comparison closes.
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparePicking, setComparePicking] = useState(false)
  // Mobile drawer (MAS-126): under 960px, once a contract is selected the
  // sidebar moves off-canvas behind this toggle instead of stacking above
  // the workspace and pushing it down -- the workspace is what a reader who
  // already picked a contract came for. Meaningless (and CSS-inert) at
  // desktop widths and before any contract is selected.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // The passage a finding or key term was clicked on; the reader scrolls to it (MAS-83).
  const [source, setSource] = useState<SourceRef | null>(null)
  // Where a source click came from, so Sources can offer a way back to it (MAS-109).
  // Cleared by any manual tab change so a stale "Back to" never lingers.
  const [returnTab, setReturnTab] = useState<Tab | null>(null)
  // MAS-177: on wide screens a citation opens this side panel instead of
  // switching to the Sources tab, so the reviewer never loses their place.
  // Independent of `source`/`returnTab`, which stay the narrow-screen path.
  const isWide = useIsWide(960)
  const [panelSource, setPanelSource] = useState<SourceRef | null>(null)
  // The element that opened the panel, so closing it returns focus there
  // instead of dropping it back to the document body.
  const panelTriggerRef = useRef<HTMLElement | null>(null)
  const closeSourcePanel = useCallback(() => {
    setPanelSource(null)
    panelTriggerRef.current?.focus()
    panelTriggerRef.current = null
  }, [])
  const [draft, setDraft] = useState('')
  // The selected contract's stored review, as the Overview last read it (MAS-108).
  const [review, setReview] = useState<RiskReview | null>(null)
  // What the Actions menu's "Review risks"/"Review again" item should show
  // right now, or null to hide it entirely (MAS-126); the panel computes
  // this itself (loading/unavailable/running all hide it) and this ref is
  // how the menu reaches the panel's own confirm-before-re-spend logic.
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null)
  const reviewPanelRef = useRef<RiskReviewPanelHandle>(null)
  // Closed as soon as an action is picked, same as a native <select> would.
  const actionsMenuRef = useRef<HTMLDetailsElement>(null)
  const [tab, setTabState] = useState<Tab>(() => parseHash().tab)
  const setTab = useCallback((next: Tab) => {
    setTabState(next)
  }, [])
  // Any tab change the user makes directly (a tab click, the header CTA, a
  // new selection) retires the "Back to" affordance a source click left
  // behind; showSource manages returnTab itself instead of going through this.
  const changeTab = useCallback((next: Tab) => {
    setReturnTab(null)
    setTab(next)
  }, [setTab])
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
    setCompared((current) => (current?.contract?.contract_id === contract.contract_id ? current : null))
    setSource(null)
    setReturnTab(null)
    setPanelSource(null)
    setReview(null)
    setAskAllContracts(false)
    setCompareIds([])
    setComparePicking(false)
    setDrawerOpen(false)
  }, [setTab])

  // A finding or key term was clicked: show the text at that passage
  // (MAS-83/95). Wide screens open the side panel in place (MAS-177) and
  // leave the current tab alone; narrower ones keep the older Sources-tab
  // switch, remembering where the click came from so Sources can offer a
  // way back (MAS-109).
  const showSource = useCallback(
    (ref: SourceRef) => {
      if (isWide) {
        panelTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setPanelSource(ref)
        return
      }
      setSource(ref)
      setReturnTab((current) => (tab === 'text' ? current : tab))
      setTab('text')
    },
    [isWide, setTab, tab],
  )
  // A source clicked from the comparison view (MAS-113) selects that
  // contract and opens it there, leaving the comparison.
  const showSourceInCompared = useCallback(
    (contract: Contract, ref: SourceRef) => {
      select(contract)
      showSource(ref)
    },
    [select, showSource],
  )
  const toggleCompare = useCallback(
    (contract: Contract) => {
      if (compareIds.includes(contract.contract_id)) {
        setCompareIds(compareIds.filter((id) => id !== contract.contract_id))
        return
      }
      if (compareIds.length >= 2) return // pick two first; a third click does nothing until one is dropped
      const next = [...compareIds, contract.contract_id]
      setCompareIds(next)
      // Two picks are enough: drop back out of pick mode so the sidebar
      // reads normally again while CompareView takes over the main column.
      if (next.length === 2) setComparePicking(false)
    },
    [compareIds],
  )
  const closeCompare = useCallback(() => {
    setCompareIds([])
    setComparePicking(false)
  }, [])
  // A row's own Delete succeeded (MAS-126): drop anything that pointed at
  // it -- the list itself is refreshed by ContractList before this fires.
  const deleted = useCallback((contractId: string) => {
    setSelected((current) => (current?.contract_id === contractId ? null : current))
    setAsked((current) => (current?.contract?.contract_id === contractId ? null : current))
    setCompareIds((current) => current.filter((id) => id !== contractId))
  }, [])
  // The header's CTA (MAS-104): open the Ask tab with the cursor in the composer.
  const askAbout = useCallback(() => {
    changeTab('ask')
    requestAnimationFrame(() => document.getElementById('question-text')?.focus())
  }, [changeTab])
  // After a selection the workspace must be where the reader is looking: the
  // heading takes focus (so the keyboard follows the eye). Before MAS-126 the
  // sidebar stacked above the workspace on a phone, so the heading was also
  // scrolled into view there; the drawer redesign moved the sidebar off-canvas,
  // leaving only the compact toggle button above the workspace, so scrolling
  // now just pushes that button off the top of the screen for nothing. On a
  // wide screen the workspace was already visible and the page stayed put; it
  // does the same on a phone now.
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
  }, [selected])

  // The list is what refreshes when a review settles; the selected object may be older.
  const current = selected ? (contracts?.find((c) => c.contract_id === selected.contract_id) ?? selected) : null
  const comparePair = compareIds.length === 2 ? (compareIds.map((id) => contracts?.find((c) => c.contract_id === id)) as [Contract | undefined, Contract | undefined]) : null
  const compareContracts: [Contract, Contract] | null = comparePair && comparePair[0] && comparePair[1] ? [comparePair[0], comparePair[1]] : null
  const answered = useCallback(
    (next: Asked | null) => {
      setAsked(next)
      if (next) {
        setTab('ask')
        // A live ask just stored a new question (MAS-102); refetch the list.
        setQuestionsVersion((v) => v + 1)
      }
    },
    [setTab],
  )
  // Compare mode (MAS-62): each side is a full, independent /api/query call,
  // so both are stored as ordinary questions (MAS-102) -- refetch the list
  // the same way a single live ask does.
  const compareAnswered = useCallback(
    (next: Compared) => {
      setCompared(next)
      setTab('ask')
      setQuestionsVersion((v) => v + 1)
    },
    [setTab],
  )
  const closeCompared = useCallback(() => setCompared(null), [])
  // Selecting a previous question (MAS-102) shows its stored answer the same
  // way a live one renders, but never re-asks the model and never refetches
  // the list -- nothing about the stored data changed.
  const selectStoredQuestion = useCallback(
    (next: Asked) => {
      setAsked(next)
      setTab('ask')
    },
    [setTab],
  )

  return (
    <PageChrome
      authControl={
        <span className="topnav-account">
          {user && <span className="topnav-account-email">{user.email}</span>}
          <button type="button" className="link" onClick={() => void logout()}>
            Log out
          </button>
        </span>
      }
    >
      <div className={`layout${selected ? ' has-selection' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
        {/* Mobile drawer (MAS-126): CSS-inert (display: none) except under
            960px with a contract selected, where it becomes the way back to
            the sidebar without leaving the workspace. */}
        {selected && (
          <button type="button" className="drawer-toggle" aria-label="Show contracts" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            Contracts
          </button>
        )}
        <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
        <aside className="sidebar">
          {selected && (
            <button type="button" className="drawer-close" aria-label="Close" onClick={() => setDrawerOpen(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
          <UploadForm
            onUploaded={(contract) => {
              select(contract)
              void reload()
            }}
          />
          <ContractList
            contracts={contracts}
            selectedId={selected?.contract_id ?? null}
            onSelect={select}
            onReload={refresh}
            comparing={comparePicking}
            compareIds={compareIds}
            onToggleCompare={toggleCompare}
            onStartCompare={() => setComparePicking(true)}
            onCancelCompare={closeCompare}
            onDeleted={deleted}
          />
          <a className="link sidebar-standards-link" href="/standards">
            Comparison rules
          </a>
        </aside>

        <main className="content">
          {compareContracts ? (
            <CompareView contracts={compareContracts} onShowSource={showSourceInCompared} onClose={closeCompare} />
          ) : !selected ? (
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
                  <span className="workspace-file-mark" aria-hidden="true"><ExportIcon name="document" /></span>
                  <div className="contract-head-main">
                    <span className="workspace-eyebrow">Contract workspace</span>
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
                      {profileBadge(current!) && <span className={`status ${profileBadge(current!)!.tone}`}>{profileBadge(current!)!.label}</span>}
                    </p>
                  </div>
                  <div className="contract-head-actions">
                    <button type="button" className="primary ask-cta" onClick={askAbout} aria-label="Ask a question about this contract" title="Ask MaSign about this contract">
                      Ask a question
                    </button>
                    {/* One primary button per screen. The trigger stays compact;
                        the open menu gives every action a clear icon and label. */}
                    <details className="actions-menu" ref={actionsMenuRef}>
                      <summary aria-label="Actions" title="Actions"><ExportIcon name="more" /></summary>
                      <nav className="actions-list" aria-label="Actions">
                        {/* Review again (MAS-126): the trigger lives here; the
                            confirm-before-re-spend step (MAS-122) still shows
                            inline in the Overview, where the review itself is. */}
                        {reviewAction && (
                          <button
                            type="button"
                            className="export-action"
                            disabled={reviewAction.disabled}
                            onClick={() => {
                              actionsMenuRef.current?.removeAttribute('open')
                              reviewPanelRef.current?.reviewAgain()
                            }}
                          >
                            <ExportIcon name="review" />
                            <span>
                              {reviewAction.label} <span className="muted small">({reviewAction.cost})</span>
                            </span>
                          </button>
                        )}
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.pdf`} download>
                          <ExportIcon name="pdf" />
                          <span>Export PDF</span>
                        </a>
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.docx`} download>
                          <ExportIcon name="document" />
                          <span>Export DOCX</span>
                        </a>
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.md`} download>
                          <ExportIcon name="markdown" />
                          <span>Export Markdown</span>
                        </a>
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.csv`} download>
                          <ExportIcon name="csv" />
                          <span>Export CSV</span>
                        </a>
                        <a className="export-action" href={`/api/contracts/${selected.contract_id}/export.xlsx`} download>
                          <ExportIcon name="csv" />
                          <span>Export XLSX</span>
                        </a>
                        <button type="button" className="export-action" onClick={() => window.print()}>
                          <ExportIcon name="print" />
                          <span>Print review</span>
                        </button>
                      </nav>
                    </details>
                  </div>
                </div>
                <Tabs
                  label="Contract workspace"
                  active={tab}
                  onChange={changeTab}
                  tabs={[
                    { id: 'overview', label: 'Overview' },
                    { id: 'ask', label: 'Ask MaSign', hint: asked || compared ? '· answered' : undefined },
                    { id: 'invoices', label: 'Invoices' },
                    { id: 'text', label: 'Sources' },
                  ]}
                />
              </div>
              <TabPanel id="overview" active={tab}>
                <RiskReviewPanel
                  key={selected.contract_id}
                  contract={selected}
                  contracts={contracts ?? []}
                  onSettled={reload}
                  onShowSource={showSource}
                  onReview={setReview}
                  onReviewAction={setReviewAction}
                  ref={reviewPanelRef}
                />
              </TabPanel>
              <TabPanel id="ask" active={tab}>
                <QuestionPanel selected={selected} draft={draft} onDraftChange={setDraft} onAnswered={answered} onCompared={compareAnswered} />
                <PreviousQuestions contract={selected} contracts={contracts ?? []} version={questionsVersion} onSelect={selectStoredQuestion} />
                {/* Suggested questions, ranked by the review (MAS-108); a click fills the composer, Ask sends it. */}
                {!asked && !compared && (
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
                {compared ? (
                  <ModelCompareView compared={compared} contracts={contracts ?? []} onShowSource={showSource} onClose={closeCompared} />
                ) : (
                  asked && <AnswerView asked={asked} contracts={contracts ?? []} onShowSource={showSource} />
                )}
              </TabPanel>
              <TabPanel id="invoices" active={tab}>
                <InvoiceCheckPanel key={selected.contract_id} contract={selected} onShowSource={showSource} />
              </TabPanel>
              <TabPanel id="text" active={tab}>
                {returnTab && (
                  <button type="button" className="back-to-context" onClick={() => changeTab(returnTab)}>
                    ← Back to {returnTab === 'ask' ? 'Ask MaSign' : returnTab === 'invoices' ? 'Invoices' : 'Overview'}
                  </button>
                )}
                <PassageReader key={`reader-${selected.contract_id}`} contract={selected} contracts={contracts ?? []} target={source} open />
              </TabPanel>
            </>
          )}
        </main>
        {isWide && panelSource && current && (
          <SourcePanel contract={current} contracts={contracts ?? []} source={panelSource} onClose={closeSourcePanel} />
        )}
      </div>
    </PageChrome>
  )
}
