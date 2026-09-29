import { PageChrome } from '../components/PageChrome'
import { PublicPageIcon } from '../components/PublicPage'

const STEPS = [
  {
    title: 'Upload',
    subtitle: 'Start with the contract you have.',
    text: 'Choose a PDF, DOCX or TXT file in your workspace. MaSign reads the text and starts a review. You can see the review status while it runs.',
    detail: 'If the agreement relies on a separate document, link the relevant upload when MaSign flags the reference.',
    icon: <path d="M12 3v12m0-12 4 4m-4-4-4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />,
  },
  {
    title: 'Review',
    subtitle: 'See what needs your attention.',
    text: 'Read the key terms, possible risks and review coverage in Overview. Findings are graded High, Medium or Low from the Customer’s perspective.',
    detail: 'Check incomplete-review warnings before drawing conclusions. No findings does not mean a contract is safe to sign.',
    icon: <path d="M12 3 2.5 20h19L12 3ZM12 9v4m0 3h.01" />,
  },
  {
    title: 'Check sources',
    subtitle: 'Go back to the wording that matters.',
    text: 'Ask a question in your own words, or open a source link beside a finding or key term. Read the cited passage in context before making a decision.',
    detail: 'For example, ask: “What is the notice period?” If an answer cannot be grounded in the source text, MaSign shows a warning.',
    icon: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />,
  },
]

export function HowItWorksPage() {
  return (
    <PageChrome>
      <main className="how-page">
        <section className="how-hero" aria-labelledby="how-title">
          <div className="how-inner how-hero-grid">
            <div>
              <p className="how-eyebrow">How it works</p>
              <h1 id="how-title">From upload to a cited answer</h1>
              <p className="how-intro">Understand the important terms, see what needs attention, and check the original wording — all in one workspace.</p>
              <a className="how-button" href="/workspace">Open workspace <span aria-hidden="true">→</span></a>
            </div>
            <div className="how-route" aria-hidden="true">
              <div className="how-route-title">Your review, step by step</div>
              {STEPS.map((step, index) => (
                <div className="how-route-item" key={step.title}>
                  <span className="how-route-number">0{index + 1}</span>
                  <span>{step.title}</span>
                  <span className="how-route-arrow">↗</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="how-inner how-walkthrough" aria-label="The three steps">
          <ol className="how-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="how-step">
                <div className="how-step-heading">
                  <span className="how-step-number" aria-hidden="true">0{index + 1}</span>
                  <div><h2>{step.title}</h2><p>{step.subtitle}</p></div>
                </div>
                <div className="how-step-body">
                  <PublicPageIcon>{step.icon}</PublicPageIcon>
                  <div><p>{step.text}</p><p className="how-step-detail">{step.detail}</p></div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="how-outcomes" aria-labelledby="how-outcomes-title">
          <div className="how-inner">
            <div className="how-section-heading">
              <p className="how-eyebrow">Understand the result</p>
              <h2 id="how-outcomes-title">Know what was checked.</h2>
              <p>Missing information and an incomplete review mean different things.</p>
            </div>
            <div className="how-outcome-grid">
              <article className="how-outcome">
                <span className="how-outcome-label">Not found / Not stated</span>
                <h3>The reviewed text did not provide it.</h3>
                <p>You may need more information or a supporting document. This is not proof that the term is absent from every related document.</p>
              </article>
              <article className="how-outcome">
                <span className="how-outcome-label">Not checked / Incomplete</span>
                <h3>The analysis could not fully verify it.</h3>
                <p>Read the coverage warning to see what is missing or unavailable. Verified findings can still be shown alongside an incomplete review.</p>
              </article>
            </div>
            <p className="how-outcome-note">AI can make mistakes. Check important findings against their sources and seek legal advice when needed.</p>
          </div>
        </section>

        <section className="how-inner how-next" aria-labelledby="how-next-title">
          <div><h2 id="how-next-title">Know what to look for.</h2><p>Explore the risk categories and key terms MaSign checks.</p></div>
          <a className="how-next-link" href="/what-masign-checks">What MaSign checks <span aria-hidden="true">→</span></a>
        </section>
      </main>
    </PageChrome>
  )
}
