import { PageChrome } from './components/PageChrome'

const STEPS = [
  { title: 'Upload', text: 'Add a contract — TXT, PDF or DOCX. MaSign reads it and splits it into passages.' },
  { title: 'Review', text: 'Every upload gets a whole-contract risk review and the key financial terms extracted, source included.' },
  { title: 'Check sources', text: 'Ask a question or open a finding; every answer links back to the exact passage it came from.' },
]

const TRUST = [
  {
    title: 'Cited answers',
    text: 'Open the exact clause behind every answer.',
    icon: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />,
  },
  {
    title: 'Risk review',
    text: 'See important contract terms that may need attention.',
    icon: <path d="M12 3 2.5 20h19L12 3ZM12 9v4m0 3h.01" />,
  },
  {
    title: 'Key terms',
    text: 'Find fees, dates, renewals, notice periods, and termination terms.',
    icon: <path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2 8h3m-3 4h5" />,
  },
  {
    title: 'Honest unknowns',
    text: 'MaSign clearly says when the contract does not contain enough information.',
    icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm0-12v4m0 3h.01" />,
  },
]

// The public home page (MAS-133): a real landing page, not the workspace.
// One job — explain what MaSign does and send a visitor to /workspace.
export function HomePage() {
  return (
    <PageChrome>
      <main className="content homepage">
        <section className="hero home-hero">
          <h1>
            Understand your contract <span className="glow">before you sign.</span>
          </h1>
          <p>
            MaSign helps you find important terms, review possible risks, and open the exact contract text behind every result.
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

        <section className="home-proof" aria-labelledby="why-masign-title">
          <div className="home-proof-heading">
            <h2 id="why-masign-title">Why MaSign</h2>
            <p>A clear first read of your contract, with sources you can open.</p>
          </div>
          <div className="home-proof-grid">
            {TRUST.map((item) => (
              <article key={item.title} className="card home-proof-card">
                <span className="home-proof-icon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {item.icon}
                  </svg>
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
          <a className="home-proof-cta" href="/workspace">
            Open workspace
          </a>
        </section>
      </main>
    </PageChrome>
  )
}
