import { StaticPage } from './StaticPage'

export function WhatMaSignChecksPage() {
  return (
    <StaticPage title="What MaSign checks">
      <p>
        Every upload gets a whole-contract review against a fixed rubric, graded from the Customer's side (the party paying for and
        receiving the goods or services) unless a passage makes clear otherwise. Each finding quotes the clause it came from — a finding
        whose quote can't be verified against the passage is dropped, not shown.
      </p>
      <h2>Risk categories</h2>
      <ul>
        <li>
          <strong>Liability cap</strong> — limits and exclusions of liability: caps, carve-outs, uncapped exposure.
        </li>
        <li>
          <strong>Termination</strong> — termination rights, notice periods, lock-in, early-termination fees.
        </li>
        <li>
          <strong>Indemnification</strong> — who indemnifies whom, for what, and whether it's capped.
        </li>
        <li>
          <strong>Auto-renewal</strong> — automatic renewal terms, length, and the window to give notice.
        </li>
        <li>
          <strong>Confidentiality</strong> — scope and duration, one-sidedness, standard exceptions.
        </li>
        <li>
          <strong>Payment terms</strong> — fees, invoicing, payment windows, late interest, price increases.
        </li>
        <li>
          <strong>IP assignment</strong> — ownership of deliverables and data; licence scope and restrictions.
        </li>
      </ul>
      <h2>Key terms extracted</h2>
      <p>
        Effective date, recurring fee, one-off fees, payment deadline, late-payment interest, termination cost, initial term, renewal,
        notice period and price-change terms — each shown with the exact passage it was read from, and marked "Not checked" rather than
        "Not stated" whenever a passage could not be graded.
      </p>
      <p className="muted small">Findings are graded over the passages actually read for a question or the whole-contract review — not the whole document beyond that.</p>
    </StaticPage>
  )
}
