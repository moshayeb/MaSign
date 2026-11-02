import { PageChrome } from '../components/PageChrome'

// MAS-210: ported from the approved redesign canvas
// (docs/redesign/canvas/WhatMaSignChecks.dc.html). Inline styles mirror the artboard so
// the page matches the design exactly; shared behaviour (hover, focus,
// phone layout) lives in the `pp-` classes in index.css.
export function WhatMaSignChecksPage() {
  return (
    <PageChrome>
      <main className="pp-main">
        <section style={{ backgroundColor: "#0caded", backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(135deg, #0caded 0%, #0ba6e6 55%, #0a9fd8 100%)", backgroundSize: "22px 22px, 100% 100%", color: "#FFFFFF" }}>
          <div className="pp-fade-1" style={{ maxWidth: "1200px", margin: "0 auto", padding: "72px 32px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ margin: "0", fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FFFFFF" }}>The rubric</p>
            <h1 style={{ margin: "0", fontWeight: 800, fontSize: "var(--fs-display)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "#FFFFFF", textWrap: "balance" }}>What MaSign checks</h1>
            <p style={{ margin: "0", maxWidth: "620px", fontSize: "var(--fs-lead)", color: "#FFFFFF", textWrap: "pretty" }}>Seven risk categories and the key financial terms, read from the customer’s side — each result linked to its source passage.</p>
          </div>
        </section>

        {/* What MaSign checks */}
        <section aria-label="What MaSign checks" style={{ background: "#FFFFFF" }}>
          <div className="pp-sec" style={{ maxWidth: "1200px", margin: "0 auto", padding: "96px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "48px" }}>
        
            <div style={{ width: "100%", display: "flex", flexWrap: "wrap", gap: "32px" }}>
              <div style={{ flex: "2 1 560px", minWidth: "0", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px 24px" }}>
                  <h3 style={{ margin: "0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Seven risk categories</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--fs-small)", color: "#555555" }}><span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, color: "#a12c22", background: "#fbeae8", padding: "2px 9px", borderRadius: "999px" }}>High</span>act on it</span><span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--fs-small)", color: "#555555" }}><span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, color: "#8f5509", background: "#f9edd8", padding: "2px 9px", borderRadius: "999px" }}>Medium</span>look closer</span><span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--fs-small)", color: "#555555" }}><span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, color: "#1a7f47", background: "#e1f2e8", padding: "2px 9px", borderRadius: "999px" }}>Low</span>customary</span><span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--fs-small)", color: "#555555" }}><span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, color: "#555555", background: "#f0f0f0", padding: "2px 9px", borderRadius: "999px" }}>Not checked</span>could not be graded — never “clean”</span></div>
                </div>
                <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
              <li className="pp-lift" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid #e8e8e8", borderRadius: "14px", background: "#f8f9fb" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, color: "#0caded", fontVariantNumeric: "tabular-nums" }}>01</span><h3 style={{ margin: "0", fontSize: "var(--fs-body)", fontWeight: 700, color: "#111111" }}>Liability cap</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "#555555" }}>Caps, carve-outs, uncapped exposure, one-sidedness.</p>
              </li>
              <li className="pp-lift" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid #e8e8e8", borderRadius: "14px", background: "#f8f9fb" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, color: "#0caded", fontVariantNumeric: "tabular-nums" }}>02</span><h3 style={{ margin: "0", fontSize: "var(--fs-body)", fontWeight: 700, color: "#111111" }}>Termination</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "#555555" }}>Termination rights, notice periods, lock-in and early-termination fees.</p>
              </li>
              <li className="pp-lift" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid #e8e8e8", borderRadius: "14px", background: "#f8f9fb" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, color: "#0caded", fontVariantNumeric: "tabular-nums" }}>03</span><h3 style={{ margin: "0", fontSize: "var(--fs-body)", fontWeight: 700, color: "#111111" }}>Indemnification</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "#555555" }}>Who indemnifies whom, for what, and whether it is capped.</p>
              </li>
              <li className="pp-lift" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid #e8e8e8", borderRadius: "14px", background: "#f8f9fb" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, color: "#0caded", fontVariantNumeric: "tabular-nums" }}>04</span><h3 style={{ margin: "0", fontSize: "var(--fs-body)", fontWeight: 700, color: "#111111" }}>Auto-renewal</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "#555555" }}>Automatic renewal, its length and the window to give notice.</p>
              </li>
              <li className="pp-lift" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid #e8e8e8", borderRadius: "14px", background: "#f8f9fb" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, color: "#0caded", fontVariantNumeric: "tabular-nums" }}>05</span><h3 style={{ margin: "0", fontSize: "var(--fs-body)", fontWeight: 700, color: "#111111" }}>Confidentiality</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "#555555" }}>Scope, duration, one-sidedness and standard exceptions.</p>
              </li>
              <li className="pp-lift" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid #e8e8e8", borderRadius: "14px", background: "#f8f9fb" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, color: "#0caded", fontVariantNumeric: "tabular-nums" }}>06</span><h3 style={{ margin: "0", fontSize: "var(--fs-body)", fontWeight: 700, color: "#111111" }}>Payment terms</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "#555555" }}>Invoicing, payment windows, late interest, price increases, refunds.</p>
              </li>
              <li className="pp-lift" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px", border: "1px solid #e8e8e8", borderRadius: "14px", background: "#f8f9fb" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, color: "#0caded", fontVariantNumeric: "tabular-nums" }}>07</span><h3 style={{ margin: "0", fontSize: "var(--fs-body)", fontWeight: 700, color: "#111111" }}>IP assignment</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "#555555" }}>Who owns deliverables, data and improvements; licence scope.</p>
              </li>
                  <li><a className="pp-lift" href="https://github.com/moshayeb/MaSign/blob/main/docs/risk-rubric.md" style={{ height: "100%", minHeight: "96px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "20px", borderRadius: "14px", border: "1.5px dashed #0caded", background: "#FFFFFF", color: "#0caded", textDecoration: "none", fontSize: "var(--fs-body-sm)", fontWeight: 700 }}>See the thresholds for each level <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a></li>
                </ul>
              </div>
              <div style={{ flex: "1 1 320px", minWidth: "0", alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: "16px", padding: "28px", borderRadius: "16px", background: "#f5f5f5", border: "1px solid #e8e8e8" }}>
                <h3 style={{ margin: "0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Key financial terms</h3>
                <p style={{ margin: "0", fontSize: "var(--fs-sm)", color: "#555555" }}>Extracted on every upload, each one quoted word for word — or marked not stated when the contract is silent.</p>
                <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Effective date</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Recurring fee</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>One-off fees</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Payment deadline</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Late-payment interest / penalty</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Termination cost</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Initial term</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Renewal</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Notice period</li>
    <li style={{ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", fontSize: "var(--fs-sm)", fontWeight: 500, color: "#333333" }}>Price changes</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Without / with */}
        <section aria-labelledby="cmp-title" style={{ background: "#f5f5f5" }}>
          <div className="pp-sec" style={{ maxWidth: "1200px", margin: "0 auto", padding: "96px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "48px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", textAlign: "center", maxWidth: "680px" }}>
              <h2 id="cmp-title" style={{ margin: "0", fontSize: "var(--fs-h2)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, color: "#111111", textWrap: "balance" }}>A first read, without the guesswork</h2>
              <p style={{ margin: "0", fontSize: "var(--fs-lead)", color: "#555555", textWrap: "balance" }}>The same contract, two ways of reading it.</p>
            </div>
            <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
              <div style={{ padding: "32px", borderRadius: "16px", border: "1px solid #e8e8e8", background: "#FFFFFF", display: "flex", flexDirection: "column", gap: "20px" }}>
                <h3 style={{ margin: "0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#555555" }}>Reading it alone</h3>
                <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "14px" }}><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#555555" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#ececec" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555555" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></span>Read every page to find the fees, dates and notice periods.</li><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#555555" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#ececec" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555555" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></span>A risky clause looks like every other clause.</li><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#555555" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#ececec" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555555" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></span>An AI answer you cannot trace back to the contract.</li><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#555555" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#ececec" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555555" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></span>No way to tell when the contract is simply silent.</li></ul>
              </div>
              <div style={{ padding: "32px", borderRadius: "16px", border: "1.5px solid #0caded", background: "#FFFFFF", boxShadow: "0 20px 40px -24px rgba(8,126,172,0.45)", display: "flex", flexDirection: "column", gap: "20px" }}>
                <h3 style={{ margin: "0", display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>With MaSign <span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, color: "#06648a", background: "#e6f6fd", padding: "2px 8px", borderRadius: "999px" }}>Cited</span></h3>
                <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "14px" }}><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#333333" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#e6f6fd" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06648a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg></span>Key terms gathered in one place, each with its quote.</li><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#333333" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#e6f6fd" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06648a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg></span>Findings rated High, Medium or Low against a fixed rubric.</li><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#333333" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#e6f6fd" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06648a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg></span>A grounded answer cites its passage; an ungrounded one is flagged.</li><li style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "var(--fs-body-sm)", color: "#333333" }}><span style={{ flex: "none", width: "24px", height: "24px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: "#e6f6fd" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06648a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg></span>Says “not stated” instead of guessing.</li></ul>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA: full width */}
        <section aria-labelledby="cta-title" style={{ backgroundColor: "#0caded", backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(135deg, #0caded 0%, #0ba6e6 55%, #0a9fd8 100%)", backgroundSize: "22px 22px, 100% 100%" }}>
          <div className="pp-sec" style={{ maxWidth: "1200px", margin: "0 auto", padding: "104px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "16px" }}>
            <p style={{ margin: "0", fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FFFFFF" }}>Start with the contract you have</p>
            <h2 id="cta-title" style={{ margin: "0", fontSize: "var(--fs-h2-xl)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.08, color: "#FFFFFF", textWrap: "balance" }}>Ready to review a contract?</h2>
            <p style={{ margin: "0", maxWidth: "560px", fontSize: "var(--fs-lead)", color: "#FFFFFF", textWrap: "balance" }}>Upload a contract to see important terms, possible risks, and their source passages together.</p>
            <a className="pp-btn-light" href="/workspace" style={{ marginTop: "12px", display: "inline-flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 10px 0 26px", borderRadius: "999px", background: "#FFFFFF", color: "#0a9fd8", textDecoration: "none", fontWeight: 700, fontSize: "var(--fs-body)" }}>Open workspace <span style={{ flex: "none", width: "28px", height: "28px", borderRadius: "999px", background: "#0caded", color: "#FFFFFF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
          </div>
        </section>
      </main>

  
    </PageChrome>
  )
}
