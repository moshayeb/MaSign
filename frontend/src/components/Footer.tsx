import { Wordmark } from './Wordmark'

const GITHUB = 'https://github.com/moshayeb/MaSign'

// The public footer (MAS-132, superseding MAS-125's "no links to pages that
// don't exist" for this specific set — owner decision 2026-09-24: build the
// small set of static pages the footer needs instead of omitting the links).
// Every href below resolves to something real: an in-app page (src/pages/),
// the workspace itself, or a working GitHub URL. None are placeholders.
export function Footer() {
  return (
    <footer className="sitefoot">
      <div className="sitefoot-inner">
        <div className="sitefoot-grid">
          <div className="sitefoot-col sitefoot-brand">
            <Wordmark height={24} className="sitefoot-logo" />
            <p className="sitefoot-tagline">Understand contracts before you sign.</p>
            <p className="sitefoot-sub muted small">Ask questions, review risks, and open the exact source clause.</p>
            <a className="link" href={GITHUB} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
          </div>

          <nav className="sitefoot-col" aria-labelledby="sitefoot-product">
            <h3 id="sitefoot-product" className="sitefoot-heading">
              Product
            </h3>
            <a className="link" href="/how-it-works">
              How it works
            </a>
            <a className="link" href="/">
              Open workspace
            </a>
            <a className="link" href="/what-masign-checks">
              What MaSign checks
            </a>
          </nav>

          <nav className="sitefoot-col" aria-labelledby="sitefoot-resources">
            <h3 id="sitefoot-resources" className="sitefoot-heading">
              Resources
            </h3>
            <a className="link" href="/documentation">
              Documentation
            </a>
            <a className="link" href={GITHUB} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
            <a className="link" href={`${GITHUB}/issues`} target="_blank" rel="noreferrer noopener">
              Report an issue
            </a>
          </nav>

          <nav className="sitefoot-col" aria-labelledby="sitefoot-project">
            <h3 id="sitefoot-project" className="sitefoot-heading">
              Project
            </h3>
            <a className="link" href="/about">
              About MaSign
            </a>
            <a className="link" href="/privacy">
              Privacy
            </a>
            <a className="link" href="/educational-disclaimer">
              Educational disclaimer
            </a>
          </nav>
        </div>

        <div className="sitefoot-divider" role="presentation" />

        <div className="sitefoot-bottom">
          <p className="sitefoot-copyright">© 2026 MaSign · Educational project</p>
          <a className="link" href={GITHUB} target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}
