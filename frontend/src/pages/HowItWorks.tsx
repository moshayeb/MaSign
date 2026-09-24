import { StaticPage } from './StaticPage'

export function HowItWorksPage() {
  return (
    <StaticPage title="How it works">
      <ol>
        <li>
          <strong>Upload a contract.</strong> MaSign reads the document and splits it into passages small enough to search and cite
          individually.
        </li>
        <li>
          <strong>Ask a question in plain language.</strong> MaSign finds the passages most relevant to the question and answers only from
          that text — every <code>[n]</code> in the answer opens the exact passage it came from.
        </li>
        <li>
          <strong>Review the risk flags.</strong> Every upload also gets a whole-contract pass against a fixed rubric (liability,
          termination, auto-renewal and more), graded from the Customer's side, with the clause quoted for every finding.
        </li>
        <li>
          <strong>Check the source, not just the answer.</strong> Every citation, risk finding and key term links back to its passage in
          the Sources tab, so nothing has to be taken on trust.
        </li>
      </ol>
      <p className="muted small">
        If the contract doesn't say something, MaSign says "Not found in contract." — it does not guess, and it does not answer from
        outside the uploaded text.
      </p>
    </StaticPage>
  )
}
