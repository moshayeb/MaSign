import { OpenWorkspaceCta, PublicPage, PublicPageIcon } from '../components/PublicPage'

const STEPS = [
  {
    title: 'Upload',
    text: 'Add a contract — TXT, PDF or DOCX. MaSign reads it and splits it into passages small enough to search and cite individually.',
    icon: <path d="M12 3v12m0-12 4 4m-4-4-4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />,
  },
  {
    title: 'Review',
    text: "Every upload gets a whole-contract risk review against a fixed rubric and the key financial terms extracted — the same review a question's own answer draws on.",
    icon: <path d="M12 3 2.5 20h19L12 3ZM12 9v4m0 3h.01" />,
  },
  {
    title: 'Check sources',
    text: 'Ask a question in plain language, or open any finding — every answer, risk flag and key term links back to the exact passage it came from.',
    icon: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />,
  },
]

// MAS-142: replaces the single-card ordered list with the shared public-page
// layout, condensed to the three steps the ticket names (upload / review /
// check sources) — "ask a question" now lives inside "check sources", since
// asking is how a reader gets to a source, not a separate stage.
export function HowItWorksPage() {
  return (
    <PublicPage
      eyebrow="How it works"
      title="From upload to a cited answer"
      subtitle="Three steps, and every one of them checkable against the contract's own text."
      cta={<OpenWorkspaceCta />}
    >
      <section className="pubpage-grid pubpage-grid-3" aria-label="The three steps">
        {STEPS.map((step) => (
          <article key={step.title} className="card pubpage-card">
            <PublicPageIcon>{step.icon}</PublicPageIcon>
            <h2>{step.title}</h2>
            <p>{step.text}</p>
          </article>
        ))}
      </section>

      <section className="pubpage-callout" aria-label="What MaSign won't do">
        <h2>Honest about what it doesn't know</h2>
        <p>
          If the contract doesn't say something, MaSign says "Not found in contract." — it does not guess, and it does not answer
          from outside the uploaded text. A review or answer it could not complete is shown as unavailable, never silently
          reported as "nothing found."
        </p>
      </section>
    </PublicPage>
  )
}
