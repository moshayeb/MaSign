import { PageChrome } from '../components/PageChrome'

// MAS-210: ported from the approved redesign canvas
// (docs/redesign/canvas/HowItWorks.dc.html). Inline styles mirror the artboard so
// the page matches the design exactly; shared behaviour (hover, focus,
// phone layout) lives in the `pp-` classes in index.css.
export function HowItWorksPage() {
  return (
    <PageChrome>
      <main className="pp-main">
        <section style={{ backgroundColor: "#0caded", backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(135deg, #0caded 0%, #0ba6e6 55%, #0a9fd8 100%)", backgroundSize: "22px 22px, 100% 100%", color: "#FFFFFF" }}>
          <div className="pp-fade-1" style={{ maxWidth: "1200px", margin: "0 auto", padding: "72px 32px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ margin: "0", fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FFFFFF" }}>How it works</p>
            <h1 style={{ margin: "0", fontWeight: 800, fontSize: "var(--fs-display)", lineHeight: 1.05, letterSpacing: "-0.03em", color: "#FFFFFF", textWrap: "balance" }}>From upload to a cited answer</h1>
            <p style={{ margin: "0", maxWidth: "620px", fontSize: "var(--fs-lead)", color: "#FFFFFF", textWrap: "pretty" }}>Three steps, and answers to what people usually ask before uploading a contract.</p>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-title" style={{ background: "#f5f5f5" }}>
          <div className="pp-sec" style={{ maxWidth: "1200px", margin: "0 auto", padding: "96px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "56px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", textAlign: "center", maxWidth: "680px" }}>
              <h2 id="how-title" style={{ margin: "0", fontSize: "var(--fs-h2)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, color: "#111111", textWrap: "balance" }}>How MaSign works</h2>
              <p style={{ margin: "0", fontSize: "var(--fs-lead)", color: "#555555", textWrap: "balance" }}>A clear first read of your contract, in three steps.</p>
            </div>
            <ol style={{ margin: "0", padding: "0", listStyle: "none", width: "100%", display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "32px 24px" }}>
              <li style={{ flex: "1 1 240px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="pp-lift" style={{ padding: "14px", borderRadius: "18px", border: "1px solid #e8e8e8", background: "#FFFFFF" }}><svg viewBox="0 0 240 160" width="100%" height="84" role="img" aria-label="A contract file being uploaded">
      <circle cx="120" cy="84" r="62" fill="#e6f6fd" />
      <circle cx="54" cy="40" r="4" fill="#0caded" /><circle cx="194" cy="52" r="3" fill="#0caded" opacity="0.6" /><circle cx="186" cy="132" r="5" fill="#e6f6fd" />
      <rect x="82" y="26" width="72" height="96" rx="9" fill="#FFFFFF" stroke="#111111" strokeWidth="2.2" />
      <rect x="94" y="44" width="48" height="4" rx="2" fill="#cfd8dc" /><rect x="94" y="54" width="48" height="4" rx="2" fill="#cfd8dc" /><rect x="94" y="64" width="30" height="4" rx="2" fill="#cfd8dc" /><rect x="94" y="74" width="48" height="4" rx="2" fill="#cfd8dc" />
      <rect x="94" y="94" width="34" height="16" rx="4" fill="#0caded" />
      <text x="111" y="106" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="9" fontWeight="800" fill="#FFFFFF">PDF</text>
      <circle cx="158" cy="112" r="20" fill="#0caded" stroke="#FFFFFF" strokeWidth="4" />
      <path d="M158 121v-18m-7 7 7-7 7 7" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg></div>
                <span style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}><span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "999px", background: "#0caded", color: "#FFFFFF", fontSize: "var(--fs-body-sm)", fontWeight: 800 }}>1</span><h3 style={{ margin: "0", fontSize: "var(--fs-h3)", fontWeight: 700, letterSpacing: "-0.01em", color: "#111111" }}>Upload</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", color: "#555555" }}>Add a contract — TXT, PDF or DOCX. MaSign reads it and splits it into passages.</p>
              </li>
              <span className="pp-step-arrow" aria-hidden="true" style={{ flex: "none", alignItems: "center", justifyContent: "center", width: "40px", height: "40px", marginTop: "37px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", color: "#0caded" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <li style={{ flex: "1 1 240px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="pp-lift" style={{ padding: "14px", borderRadius: "18px", border: "1px solid #e8e8e8", background: "#FFFFFF" }}><svg viewBox="0 0 240 160" width="100%" height="84" role="img" aria-label="A magnifying glass finding a risky clause">
      <circle cx="120" cy="84" r="62" fill="#e6f6fd" />
      <circle cx="46" cy="118" r="4" fill="#0caded" /><circle cx="196" cy="132" r="3" fill="#0caded" opacity="0.6" />
      <rect x="66" y="24" width="80" height="104" rx="9" fill="#FFFFFF" stroke="#111111" strokeWidth="2.2" />
      <rect x="78" y="42" width="56" height="4" rx="2" fill="#cfd8dc" /><rect x="78" y="52" width="56" height="4" rx="2" fill="#cfd8dc" />
      <rect x="76" y="62" width="60" height="12" rx="3" fill="#dff4fb" /><rect x="78" y="70" width="56" height="2.5" rx="1.2" fill="#0caded" />
      <rect x="78" y="84" width="56" height="4" rx="2" fill="#cfd8dc" /><rect x="78" y="94" width="56" height="4" rx="2" fill="#cfd8dc" /><rect x="78" y="104" width="38" height="4" rx="2" fill="#cfd8dc" />
      <circle cx="150" cy="86" r="26" fill="#FFFFFF" fillOpacity="0.85" stroke="#111111" strokeWidth="3" />
      <path d="M168 105l18 18" stroke="#111111" strokeWidth="7" strokeLinecap="round" />
      <path d="M150 74l11 20h-22z" fill="#0caded" stroke="#0caded" strokeWidth="2" strokeLinejoin="round" />
      <path d="M150 81v6m0 4v.5" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="158" y="26" width="46" height="18" rx="9" fill="#fbeae8" />
      <text x="181" y="39" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="800" fill="#a12c22">High</text>
    </svg></div>
                <span style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}><span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "999px", background: "#0caded", color: "#FFFFFF", fontSize: "var(--fs-body-sm)", fontWeight: 800 }}>2</span><h3 style={{ margin: "0", fontSize: "var(--fs-h3)", fontWeight: 700, letterSpacing: "-0.01em", color: "#111111" }}>Review</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", color: "#555555" }}>Every upload gets a whole-contract risk review and its key financial terms, each with its source. No findings does not mean a contract is safe to sign.</p>
              </li>
              <span className="pp-step-arrow" aria-hidden="true" style={{ flex: "none", alignItems: "center", justifyContent: "center", width: "40px", height: "40px", marginTop: "37px", borderRadius: "999px", border: "1px solid #e8e8e8", background: "#FFFFFF", color: "#0caded" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <li style={{ flex: "1 1 240px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="pp-lift" style={{ padding: "14px", borderRadius: "18px", border: "1px solid #e8e8e8", background: "#FFFFFF" }}><svg viewBox="0 0 240 160" width="100%" height="84" role="img" aria-label="An answer linked to its passage in the contract">
      <circle cx="120" cy="84" r="62" fill="#e6f6fd" />
      <circle cx="200" cy="28" r="4" fill="#0caded" /><circle cx="34" cy="126" r="3" fill="#0caded" opacity="0.6" />
      <rect x="130" y="46" width="76" height="94" rx="9" fill="#FFFFFF" stroke="#111111" strokeWidth="2.2" />
      <rect x="142" y="62" width="52" height="4" rx="2" fill="#cfd8dc" /><rect x="142" y="72" width="52" height="4" rx="2" fill="#cfd8dc" />
      <rect x="140" y="82" width="56" height="12" rx="3" fill="#dff4fb" /><rect x="142" y="90" width="52" height="2.5" rx="1.2" fill="#0caded" />
      <rect x="142" y="104" width="52" height="4" rx="2" fill="#cfd8dc" /><rect x="142" y="114" width="52" height="4" rx="2" fill="#cfd8dc" /><rect x="142" y="124" width="34" height="4" rx="2" fill="#cfd8dc" />
      <path d="M36 30h82a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10H62l-14 12V80H36a10 10 0 0 1-10-10V40a10 10 0 0 1 10-10z" fill="#FFFFFF" stroke="#111111" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="38" y="44" width="60" height="4" rx="2" fill="#cfd8dc" /><rect x="38" y="56" width="44" height="4" rx="2" fill="#cfd8dc" />
      <rect x="90" y="51" width="18" height="16" rx="4" fill="#0caded" />
      <text x="99" y="63" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="800" fill="#FFFFFF">1</text>
      <path d="M108 66 C 124 80, 124 88, 138 88" fill="none" stroke="#0caded" strokeWidth="2.4" strokeDasharray="4 4" strokeLinecap="round" />
      <circle cx="139" cy="88" r="3.5" fill="#0caded" />
    </svg></div>
                <span style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}><span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "999px", background: "#0caded", color: "#FFFFFF", fontSize: "var(--fs-body-sm)", fontWeight: 800 }}>3</span><h3 style={{ margin: "0", fontSize: "var(--fs-h3)", fontWeight: 700, letterSpacing: "-0.01em", color: "#111111" }}>Check sources</h3></span>
                <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", color: "#555555" }}>Ask a question or open a finding, then read its cited passage in the contract. An answer that cannot be grounded is marked.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq-title" style={{ background: "#FFFFFF" }}>
          <div className="pp-sec" style={{ maxWidth: "880px", margin: "0 auto", padding: "96px 32px 64px", display: "flex", flexDirection: "column", alignItems: "center", gap: "40px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", textAlign: "center", maxWidth: "680px" }}>
              <h2 id="faq-title" style={{ margin: "0", fontSize: "var(--fs-h2)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, color: "#111111", textWrap: "balance" }}>Questions, answered</h2>
              <p style={{ margin: "0", fontSize: "var(--fs-lead)", color: "#555555", textWrap: "balance" }}>What people usually want to know before uploading a contract.</p>
            </div>
            <div className="pp-faq" style={{ width: "100%", borderTop: "1px solid #e8e8e8" }}>
              <details style={{ borderBottom: "1px solid #e8e8e8" }}>
                <summary style={{ listStyle: "none", cursor: "pointer", minHeight: "64px", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Is this legal advice?<span className="pp-faq-plus" style={{ flex: "none", width: "32px", height: "32px", borderRadius: "8px", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span></summary>
                <p style={{ margin: "0 0 20px", maxWidth: "760px", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>No. MaSign is an AI-assisted review tool that helps you read a contract. It does not replace a lawyer and does not make legal decisions.</p>
              </details>
              <details style={{ borderBottom: "1px solid #e8e8e8" }}>
                <summary style={{ listStyle: "none", cursor: "pointer", minHeight: "64px", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Which files can I upload?<span className="pp-faq-plus" style={{ flex: "none", width: "32px", height: "32px", borderRadius: "8px", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span></summary>
                <p style={{ margin: "0 0 20px", maxWidth: "760px", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>PDF, DOCX and TXT. MaSign reads the text and splits it into passages, so each result can point back to where it came from.</p>
              </details>
              <details style={{ borderBottom: "1px solid #e8e8e8" }}>
                <summary style={{ listStyle: "none", cursor: "pointer", minHeight: "64px", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Where does my contract go?<span className="pp-faq-plus" style={{ flex: "none", width: "32px", height: "32px", borderRadius: "8px", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span></summary>
                <p style={{ margin: "0 0 20px", maxWidth: "760px", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>The text is stored as passages in the database of the instance you use. To answer a question or run a review, only the relevant passages are sent to the configured AI provider (Anthropic or OpenAI). There is no analytics or tracking script.</p>
              </details>
              <details style={{ borderBottom: "1px solid #e8e8e8" }}>
                <summary style={{ listStyle: "none", cursor: "pointer", minHeight: "64px", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Whose side does the review take?<span className="pp-faq-plus" style={{ flex: "none", width: "32px", height: "32px", borderRadius: "8px", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span></summary>
                <p style={{ margin: "0 0 20px", maxWidth: "760px", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>The customer’s — the party receiving the services, goods or licence — unless the contract makes clear you are the other party.</p>
              </details>
              <details style={{ borderBottom: "1px solid #e8e8e8" }}>
                <summary style={{ listStyle: "none", cursor: "pointer", minHeight: "64px", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>What if the document isn’t a contract?<span className="pp-faq-plus" style={{ flex: "none", width: "32px", height: "32px", borderRadius: "8px", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span></summary>
                <p style={{ margin: "0 0 20px", maxWidth: "760px", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>MaSign labels every upload as a contract, uncertain, or not a contract. A clean review of an invoice says the rubric may not apply, rather than “nothing found”.</p>
              </details>
              <details style={{ borderBottom: "1px solid #e8e8e8" }}>
                <summary style={{ listStyle: "none", cursor: "pointer", minHeight: "64px", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>What if a contract contains instructions to the AI?<span className="pp-faq-plus" style={{ flex: "none", width: "32px", height: "32px", borderRadius: "8px", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span></summary>
                <p style={{ margin: "0 0 20px", maxWidth: "760px", fontSize: "var(--fs-body-sm)", lineHeight: 1.65, color: "#555555" }}>A guardrail checks each passage before it is sent. Sentences aimed at the AI are removed, and the workspace tells you a passage was withheld.</p>
              </details>
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
