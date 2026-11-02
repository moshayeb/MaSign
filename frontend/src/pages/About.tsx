import { PageChrome } from '../components/PageChrome'

// MAS-210: ported from the approved redesign canvas
// (docs/redesign/canvas/About.dc.html). Inline styles mirror the artboard so
// the page matches the design exactly; shared behaviour (hover, focus,
// phone layout) lives in the `pp-` classes in index.css.
export function AboutPage() {
  return (
    <PageChrome>
      <main className="pp-main">
        <section style={{ backgroundColor: "#0caded", backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(135deg, #0caded 0%, #0ba6e6 55%, #0a9fd8 100%)", backgroundSize: "22px 22px, 100% 100%", color: "#FFFFFF" }}>
          <div className="pp-fade-1" style={{ maxWidth: "1200px", margin: "0 auto", padding: "72px 32px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ margin: "0", fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FFFFFF" }}>About</p>
            <h1 style={{ margin: "0", fontWeight: 800, fontSize: "var(--fs-display)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "#FFFFFF", textWrap: "balance" }}>About MaSign</h1>
            <p style={{ margin: "0", maxWidth: "620px", fontSize: "var(--fs-lead)", color: "#FFFFFF", textWrap: "pretty" }}>An AI-assisted contract review project: it helps you read a contract, and it shows you where each result comes from.</p>
          </div>
        </section>

        {/* Open project */}
        <section aria-label="Open project" style={{ background: "#FFFFFF" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "64px 32px" }}>
            <div style={{ padding: "24px 28px", border: "1px solid #e8e8e8", borderRadius: "16px", background: "#f8f9fb", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "16px 32px" }}>
              <div style={{ flex: "1 1 520px", display: "flex", alignItems: "flex-start", gap: "16px", minWidth: "0" }}>
                <span style={{ flex: "none", width: "44px", height: "44px", borderRadius: "10px", border: "1px solid #e8e8e8", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12" /></svg></span>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                  <h2 style={{ margin: "0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Built in the open</h2>
                  <p style={{ margin: "0", fontSize: "var(--fs-sm)", color: "#555555" }}>Python · FastAPI · React · PostgreSQL — the code, the rubric and the tests are on GitHub.</p><p style={{ margin: "0", fontSize: "var(--fs-sm)", color: "#555555" }}>MaSign is an educational project, built as part of a course assignment. It is not a company and does not offer any paid product or support — see the <a href="/educational-disclaimer" style={{ color: "#087eac" }}>educational disclaimer</a> for what that means in practice.</p>
                </div>
              </div>
              <a className="pp-btn-sec" href="https://github.com/moshayeb/MaSign" style={{ display: "inline-flex", alignItems: "center", minHeight: "52px", padding: "0 26px", borderRadius: "999px", border: "1px solid #d0d0d0", background: "#FFFFFF", color: "#111111", textDecoration: "none", fontWeight: 700, fontSize: "var(--fs-body)" }}>View on GitHub</a>
            </div>
          </div>
        </section>

        {/* Clear expectations */}
        <section aria-labelledby="exp-title" style={{ background: "#f5f5f5" }}>
          <div className="pp-sec" style={{ maxWidth: "1200px", margin: "0 auto", padding: "96px 32px", display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "48px 64px" }}>
            <div style={{ flex: "1 1 320px", minWidth: "0", display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ margin: "0", fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#0caded" }}>Before you rely on it</p>
              <h2 id="exp-title" style={{ margin: "0", fontSize: "var(--fs-h2)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, color: "#111111", textWrap: "balance" }}>Clear expectations</h2>
              <p style={{ margin: "0", fontSize: "var(--fs-lead)", color: "#555555", textWrap: "pretty" }}>MaSign gives you a fast first read with sources you can open. Here is what it is — and what it is not.</p>
              <a href="/educational-disclaimer" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "var(--fs-body-sm)", fontWeight: 700, color: "#087eac", textDecoration: "none" }}>Read the full disclaimer <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
            </div>
            <ul className="pp-exp-card" style={{ flex: "1.4 1 480px", minWidth: "0", margin: "0", listStyle: "none", padding: "8px 36px", borderRadius: "24px", border: "1px solid #e8e8e8", background: "#FFFFFF", boxShadow: "0 24px 48px -32px rgba(4,60,90,0.25)" }}>
              <li style={{ display: "flex", gap: "20px", alignItems: "flex-start", padding: "24px 0", borderBottom: "1px solid #e8e8e8" }}>
                  <span style={{ flex: "none", width: "52px", height: "52px", borderRadius: "16px", background: "linear-gradient(135deg, #0caded, #0a9fd8)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18M5 7l-3 6a3 3 0 0 0 6 0L5 7Zm14 0-3 6a3 3 0 0 0 6 0l-3-6ZM5 7h14" /></svg></span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                    <span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", color: "#0caded" }}>01</span>
                    <h3 style={{ margin: "0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Assists, not legal advice</h3>
                    <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>MaSign supports your review of a contract; it does not replace a lawyer and does not make legal decisions.</p>
                  </div>
                </li>
              <li style={{ display: "flex", gap: "20px", alignItems: "flex-start", padding: "24px 0", borderBottom: "1px solid #e8e8e8" }}>
                  <span style={{ flex: "none", width: "52px", height: "52px", borderRadius: "16px", background: "linear-gradient(135deg, #0caded, #0a9fd8)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3ZM12 9v4m0 3h.01" /></svg></span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                    <span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", color: "#0caded" }}>02</span>
                    <h3 style={{ margin: "0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>AI findings may be imperfect</h3>
                    <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>Answers and risk findings are generated by a model reading the uploaded text — verify anything that matters against the source passage each one links to.</p>
                  </div>
                </li>
              <li style={{ display: "flex", gap: "20px", alignItems: "flex-start", padding: "24px 0" }}>
                  <span style={{ flex: "none", width: "52px", height: "52px", borderRadius: "16px", background: "linear-gradient(135deg, #0caded, #0a9fd8)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z" /></svg></span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                    <span style={{ fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", color: "#0caded" }}>03</span>
                    <h3 style={{ margin: "0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>How your data is used</h3>
                    <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>Passages relevant to a question or review are sent to the configured AI provider (Anthropic or OpenAI) to generate the answer or finding.</p>
                  </div>
                </li>
            </ul>
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
