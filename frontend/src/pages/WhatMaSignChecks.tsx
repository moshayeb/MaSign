import { OpenWorkspaceCta, PublicPage, PublicPageIcon } from '../components/PublicPage'

const CATEGORIES = [
  {
    name: 'Liability cap',
    text: 'Limits and exclusions of liability: caps, carve-outs, uncapped exposure.',
    icon: <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" />,
  },
  {
    name: 'Termination',
    text: 'Termination rights, notice periods, lock-in, early-termination fees.',
    icon: <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9" />,
  },
  {
    name: 'Indemnification',
    text: 'Who indemnifies whom, for what, and whether it is capped.',
    icon: <path d="M12 3v18M5 7l-3 6a3 3 0 0 0 6 0L5 7Zm14 0-3 6a3 3 0 0 0 6 0l-3-6ZM5 7h14" />,
  },
  {
    name: 'Auto-renewal',
    text: 'Automatic renewal terms, length, and the window to give notice.',
    icon: <path d="M4 4v6h6M20 20v-6h-6M4.5 15a8 8 0 0 0 14.5 3.5M19.5 9A8 8 0 0 0 5 5.5" />,
  },
  {
    name: 'Confidentiality',
    text: 'Scope and duration, one-sidedness, standard exceptions.',
    icon: <path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z" />,
  },
  {
    name: 'Payment terms',
    text: 'Fees, invoicing, payment windows, late interest, price increases.',
    icon: <path d="M4 6h16v12H4zM4 10h16M8 16h4" />,
  },
  {
    name: 'IP assignment',
    text: 'Ownership of deliverables and data; licence scope and restrictions.',
    icon: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 14l2 2 4-4" />,
  },
]

const KEY_TERMS = [
  'Effective date',
  'Recurring fee',
  'One-off fees',
  'Payment deadline',
  'Late-payment interest',
  'Termination cost',
  'Initial term',
  'Renewal',
  'Notice period',
  'Price-change terms',
]

const OUTCOMES = [
  { label: 'High', className: 'severity-high', text: 'Meets the rubric’s High bar for that category — the clause is worth reading closely.' },
  { label: 'Medium', className: 'severity-medium', text: 'Somewhere between the High and Low description — worth a second look.' },
  { label: 'Low', className: 'severity-low', text: 'Matches the rubric’s customary, lower-risk terms for that category.' },
  { label: 'Not checked', className: 'severity-none', text: 'The pass could not grade this one — never shown as if nothing was found.' },
]

// MAS-142: replaces the single prose card with the shared public-page
// layout — a scannable category grid, a plain list of the extracted key
// terms, and an explicit legend for the four outcomes a reader will see in
// the app, so "Not checked" reads as "unable to verify," not "clean."
export function WhatMaSignChecksPage() {
  return (
    <PublicPage
      eyebrow="What MaSign checks"
      title="A fixed rubric, graded from your side of the deal"
      subtitle="Every upload gets a whole-contract review against seven risk categories, graded from the Customer's perspective unless a passage makes clear otherwise. Each finding quotes the clause it came from — a finding whose quote can't be verified against the passage is dropped, not shown."
      cta={<OpenWorkspaceCta />}
    >
      <section className="pubpage-section" aria-labelledby="risk-categories-title">
        <h2 id="risk-categories-title">Risk categories</h2>
        <div className="pubpage-grid pubpage-grid-3" aria-label="The seven risk categories">
          {CATEGORIES.map((category) => (
            <article key={category.name} className="card pubpage-card">
              <PublicPageIcon>{category.icon}</PublicPageIcon>
              <h3>{category.name}</h3>
              <p>{category.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pubpage-section" aria-labelledby="key-terms-title">
        <h2 id="key-terms-title">Key terms extracted</h2>
        <p>
          Nine financial terms are pulled from every contract, each shown with the exact passage it was read from and typed
          fields kept only when their numbers match the quote:
        </p>
        <ul className="pubpage-grid pubpage-grid-3 pubpage-terms-list">
          {KEY_TERMS.map((term) => (
            <li key={term} className="card pubpage-term-chip">
              {term}
            </li>
          ))}
        </ul>
      </section>

      <section className="pubpage-section" aria-labelledby="outcomes-title">
        <h2 id="outcomes-title">What each outcome means</h2>
        <p>Findings are graded over the passages actually read for a question or the whole-contract review — never the document beyond that.</p>
        <div className="pubpage-legend">
          {OUTCOMES.map((outcome) => (
            <div key={outcome.label} className={`card pubpage-legend-item ${outcome.className}`}>
              <span className="severity">{outcome.label}</span>
              <p>{outcome.text}</p>
            </div>
          ))}
        </div>
      </section>
    </PublicPage>
  )
}
