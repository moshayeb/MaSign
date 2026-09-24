import { PageChrome } from './components/PageChrome'

const STEPS = [
  { title: 'Upload', text: 'Add a contract — TXT, PDF or DOCX. MaSign reads it and splits it into passages.' },
  { title: 'Review', text: 'Every upload gets a whole-contract risk review and the key financial terms extracted, source included.' },
  { title: 'Check sources', text: 'Ask a question or open a finding; every answer links back to the exact passage it came from.' },
]

const TRUST = [
  { title: 'Cited answers', text: 'Every [n] in an answer opens the exact passage it came from — nothing asserted without a source.' },
  { title: 'Honest unknowns', text: 'If the contract does not say, MaSign says "Not found in contract." — never a guess.' },
  { title: 'Risk grading', text: 'Liability, termination, auto-renewal and four more categories flagged High / Medium / Low from your side.' },
]

// The public home page (MAS-133): a real landing page, not the workspace.
// One job — explain what MaSign does and send a visitor to /workspace.
export function HomePage() {
  return (
    <PageChrome>
      <main className="content homepage">
        <section className="hero home-hero">
          <h1>
            Ask the contract. <span className="glow">Get the clause that proves it.</span>
          </h1>
          <p>
            Upload a contract, ask questions about it in plain language, and get answers grounded in the document's own text — every
            citation opens the exact passage it came from.
          </p>
          <a className="primary home-cta" href="/workspace">
            Open workspace
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </section>

        <section className="home-steps" aria-label="How it works">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card home-step">
              <span className="home-step-number" aria-hidden="true">
                {i + 1}
              </span>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
            </div>
          ))}
        </section>

        <section className="features" aria-label="Why trust it">
          {TRUST.map((item) => (
            <section key={item.title} className="card feature">
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </section>
          ))}
        </section>
      </main>
    </PageChrome>
  )
}
