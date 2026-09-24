import { StaticPage } from './StaticPage'

export function AboutPage() {
  return (
    <StaticPage title="About MaSign">
      <p>
        MaSign is an AI-assisted contract analysis assistant: upload a contract, ask questions about it in plain language, and get answers
        grounded in the document's own text — every citation opens the exact passage it came from. It also runs a whole-contract risk
        review against a fixed rubric and extracts the financial terms that usually matter most (fees, deadlines, renewal, termination
        cost).
      </p>
      <p>MaSign does not replace a lawyer and does not make legal decisions. It is a first read, meant to help a reader find what to look at more carefully.</p>
      <p className="muted small">
        MaSign is an educational project, built as part of a course assignment. It is not a company and does not offer any paid product or
        support — see the <a href="/educational-disclaimer">educational disclaimer</a> for what that means in practice.
      </p>
    </StaticPage>
  )
}
