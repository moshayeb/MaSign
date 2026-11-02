import { PageChrome } from './components/PageChrome'

// MAS-210: ported from the approved redesign canvas
// (docs/redesign/canvas/Main.dc.html). Inline styles mirror the artboard so
// the page matches the design exactly; shared behaviour (hover, focus,
// phone layout) lives in the `pp-` classes in index.css.
export function HomePage() {
  return (
    <PageChrome>
      <main className="pp-main">
        {/* Hero */}
        <section style={{ backgroundColor: "#0caded", backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(135deg, #0caded 0%, #0ba6e6 55%, #0a9fd8 100%)", backgroundSize: "22px 22px, 100% 100%", color: "#FFFFFF", overflow: "hidden" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "88px 32px 96px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "56px" }}>
            <div className="pp-fade-1" style={{ flex: "1.1 1 460px", minWidth: "0", display: "flex", flexDirection: "column", gap: "24px" }}>
              <p style={{ margin: "0", fontSize: "var(--fs-caption)", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FFFFFF" }}>AI-assisted contract analysis</p>
              <h1 style={{ margin: "0", fontWeight: 800, fontSize: "var(--fs-display)", lineHeight: 1.04, letterSpacing: "-0.025em", textTransform: "uppercase", color: "#FFFFFF", textWrap: "balance" }}>Understand your contract before you sign.</h1>
              <p style={{ margin: "0", maxWidth: "520px", fontSize: "var(--fs-lead)", lineHeight: 1.6, color: "#FFFFFF", textWrap: "pretty" }}>MaSign helps you find important terms, review possible risks, and open the exact contract text behind each&nbsp;result.</p>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
                <a className="pp-btn-light" href="/workspace" style={{ display: "inline-flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 10px 0 26px", borderRadius: "999px", background: "#FFFFFF", color: "#0a9fd8", textDecoration: "none", fontWeight: 700, fontSize: "var(--fs-body)" }}>Open workspace <span style={{ flex: "none", width: "28px", height: "28px", borderRadius: "999px", background: "#0caded", color: "#FFFFFF", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
                <a className="pp-btn-glass" href="/how-it-works" style={{ display: "inline-flex", alignItems: "center", minHeight: "52px", padding: "0 26px", borderRadius: "999px", border: "1px solid rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.16)", color: "#FFFFFF", textDecoration: "none", fontWeight: 700, fontSize: "var(--fs-body)" }}>See how it works</a>
              </div>
              <p style={{ margin: "0", fontSize: "var(--fs-small)", color: "#FFFFFF" }}>Supports PDF, DOCX and TXT files</p>
            </div>

            <figure className="pp-fade-2" style={{ flex: "1 1 460px", minWidth: "0", margin: "0", display: "flex", flexDirection: "column", gap: "12px" }} aria-label="Illustrative example of the MaSign workspace">
              <div style={{ position: "relative" }}>
                <div className="pp-tilt" style={{ position: "relative", zIndex: 1, borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 30px 60px -20px rgba(4,60,90,0.35)", overflow: "hidden", color: "#333333" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "14px 20px", borderBottom: "1px solid #e8e8e8", background: "#f8f9fb" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: "0" }}>
                      <span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, padding: "3px 7px", borderRadius: "4px", background: "#e6f6fd", color: "#06648a" }}>PDF</span>
                      <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "#111111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Master_Services_Agreement.pdf</span>
                    </div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--fs-caption)", fontWeight: 600, color: "#1a7f47", background: "#e1f2e8", padding: "3px 10px", borderRadius: "999px", whiteSpace: "nowrap" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#1a7f47" }}></span>Reviewed</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 240px", minWidth: "0", padding: "20px", borderRight: "1px solid #e8e8e8", display: "flex", flexDirection: "column", gap: "14px" }}>
                      <p style={{ margin: "0", fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#555555" }}>§ 9.2 Limitation of liability</p>
                      <p style={{ margin: "0", fontSize: "var(--fs-sm)", lineHeight: 1.65, color: "#333333" }}>Neither party shall be liable for indirect damages. <span style={{ background: "#dff4fb", boxShadow: "inset 0 -2px 0 #0caded", color: "#111111" }}>The Supplier shall have no liability for any loss arising from a breach of data security.</span></p>
                      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "6px", padding: "12px", borderRadius: "10px", background: "#f8f9fb", border: "1px solid #e8e8e8" }}>
                        <p style={{ margin: "0", fontSize: "var(--fs-caption)", fontWeight: 600, color: "#111111" }}>Is the supplier liable for a data breach?</p>
                        <p style={{ margin: "0", fontSize: "var(--fs-caption)", lineHeight: 1.5, color: "#555555" }}>No — it is excluded <span style={{ whiteSpace: "nowrap" }}>entirely <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "18px", height: "18px", padding: "0 5px", borderRadius: "4px", background: "#0caded", color: "#FFFFFF", fontSize: "var(--fs-micro)", fontWeight: 700, verticalAlign: "1px" }}>1</span></span></p>
                      </div>
                    </div>
                    <div style={{ flex: "1 1 220px", minWidth: "0", padding: "20px", display: "flex", flexDirection: "column", gap: "16px", background: "#f8f9fb" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <p style={{ margin: "0", fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#555555" }}>Risk review</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "10px 12px", border: "1px solid #e8e8e8", borderRadius: "10px", background: "#FFFFFF" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--fs-small)", fontWeight: 700, color: "#111111" }}><span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, color: "#a12c22", background: "#fbeae8", padding: "1px 8px", borderRadius: "999px" }}>High</span>Liability cap</span>
                        <span style={{ fontSize: "var(--fs-caption)", lineHeight: 1.5, color: "#555555" }}>Vendor excludes liability for its own data breaches.</span>
                      </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "10px 12px", border: "1px solid #e8e8e8", borderRadius: "10px", background: "#FFFFFF" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--fs-small)", fontWeight: 700, color: "#111111" }}><span style={{ fontSize: "var(--fs-micro)", fontWeight: 700, color: "#8f5509", background: "#f9edd8", padding: "1px 8px", borderRadius: "999px" }}>Medium</span>Termination</span>
                        <span style={{ fontSize: "var(--fs-caption)", lineHeight: 1.5, color: "#555555" }}>90 days' notice to terminate.</span>
                      </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <p style={{ margin: "0", fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#555555", marginBottom: "4px" }}>Key terms</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", fontSize: "var(--fs-caption)", padding: "6px 0", borderBottom: "1px solid #e8e8e8" }}><span style={{ color: "#555555", whiteSpace: "nowrap" }}>Recurring fee</span><span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}><span style={{ fontWeight: 600, color: "#111111", whiteSpace: "nowrap" }}>EUR 4,200 / month</span></span></div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", fontSize: "var(--fs-caption)", padding: "6px 0" }}><span style={{ color: "#555555", whiteSpace: "nowrap" }}>Initial term</span><span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}><span style={{ fontWeight: 600, color: "#111111", whiteSpace: "nowrap" }}>24 months</span></span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <figcaption style={{ fontSize: "var(--fs-caption)", color: "#FFFFFF", textAlign: "right" }}>Illustrative example, not a real upload</figcaption>
            </figure>
          </div>
        </section>

        {/* Trust strip */}
        <section aria-label="At a glance" style={{ background: "#FFFFFF", borderBottom: "1px solid #e8e8e8" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "22px 32px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "12px 40px", fontSize: "var(--fs-sm)", fontWeight: 600, color: "#333333" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" /></svg>PDF · DOCX · TXT</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 7H5v6h4l-2 4M19 7h-4v6h4l-2 4" /></svg>Cited to the passage</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>Customer-side review</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0caded" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18M5 7l-3 6a3 3 0 0 0 6 0L5 7Zm14 0-3 6a3 3 0 0 0 6 0l-3-6ZM5 7h14" /></svg>A first read, not a lawyer</span>
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
                <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", color: "#555555" }}>MaSign starts a risk review and looks for key terms. Check its coverage before relying on a result.</p>
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
                <p style={{ margin: "0", fontSize: "var(--fs-body-sm)", color: "#555555" }}>Ask a question or open a finding, then read its cited passage in the contract.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* Why MaSign */}
        <section aria-labelledby="why-title" style={{ background: "#FFFFFF" }}>
          <div className="pp-sec" style={{ maxWidth: "1200px", margin: "0 auto", padding: "96px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "48px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", textAlign: "center", maxWidth: "680px" }}>
              <h2 id="why-title" style={{ margin: "0", fontSize: "var(--fs-h2)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.1, color: "#111111", textWrap: "balance" }}>Why MaSign</h2>
              <p style={{ margin: "0", fontSize: "var(--fs-lead)", color: "#555555", textWrap: "balance" }}>A clear first read of your contract, with sources you can open.</p>
            </div>
            <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px" }}>
              <a className="pp-lift pp-why-card" href="/how-it-works" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "32px", border: "1px solid #e8e8e8", borderRadius: "16px", background: "#f8f9fb", textDecoration: "none", color: "#555555" }}>
                <span style={{ flex: "none", width: "56px", height: "56px", borderRadius: "16px", background: "linear-gradient(135deg, #0caded, #0a9fd8)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" /></svg></span>
                <span style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}><h3 style={{ margin: "8px 0 0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Cited answers</h3>
                <span style={{ fontSize: "var(--fs-body-sm)", lineHeight: 1.6 }}>Open the cited passage behind a grounded answer.</span></span>
              </a>
              <a className="pp-lift pp-why-card" href="/what-masign-checks" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "32px", border: "1px solid #e8e8e8", borderRadius: "16px", background: "#f8f9fb", textDecoration: "none", color: "#555555" }}>
                <span style={{ flex: "none", width: "56px", height: "56px", borderRadius: "16px", background: "linear-gradient(135deg, #0caded, #0a9fd8)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3ZM12 9v4m0 3h.01" /></svg></span>
                <span style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}><h3 style={{ margin: "8px 0 0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Risk review</h3>
                <span style={{ fontSize: "var(--fs-body-sm)", lineHeight: 1.6 }}>See important contract terms that may need attention.</span></span>
              </a>
              <a className="pp-lift pp-why-card" href="/what-masign-checks" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "32px", border: "1px solid #e8e8e8", borderRadius: "16px", background: "#f8f9fb", textDecoration: "none", color: "#555555" }}>
                <span style={{ flex: "none", width: "56px", height: "56px", borderRadius: "16px", background: "linear-gradient(135deg, #0caded, #0a9fd8)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2 8h3m-3 4h5" /></svg></span>
                <span style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}><h3 style={{ margin: "8px 0 0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Key terms</h3>
                <span style={{ fontSize: "var(--fs-body-sm)", lineHeight: 1.6 }}>Find fees, dates, renewals, notice periods, and termination terms.</span></span>
              </a>
              <a className="pp-lift pp-why-card" href="/how-it-works" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "32px", border: "1px solid #e8e8e8", borderRadius: "16px", background: "#f8f9fb", textDecoration: "none", color: "#555555" }}>
                <span style={{ flex: "none", width: "56px", height: "56px", borderRadius: "16px", background: "linear-gradient(135deg, #0caded, #0a9fd8)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm0-12v4m0 3h.01" /></svg></span>
                <span style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}><h3 style={{ margin: "8px 0 0", fontSize: "var(--fs-lead)", fontWeight: 700, color: "#111111" }}>Honest unknowns</h3>
                <span style={{ fontSize: "var(--fs-body-sm)", lineHeight: 1.6 }}>See when information is missing or could not be checked.</span></span>
              </a>
            </div>
            <a className="pp-btn-solid" href="/workspace" style={{ display: "inline-flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 10px 0 26px", borderRadius: "999px", background: "#0caded", color: "#FFFFFF", textDecoration: "none", fontWeight: 700, fontSize: "var(--fs-body)" }}>Open workspace <span style={{ flex: "none", width: "28px", height: "28px", borderRadius: "999px", background: "#FFFFFF", color: "#0caded", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
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
