import { APP_VERSION } from '../version'

// The footer MaSign did not have (MAS-125). It carries the disclaimer the
// product needs on every screen, and two links that actually exist — the
// repository and the version. About / Privacy / Documentation come with the
// pages themselves (MAS-126); a link to a page that does not exist reads as
// less finished than no link at all.
export function Footer() {
  return (
    <footer className="sitefoot">
      <div className="sitefoot-inner">
        <p className="sitefoot-note">AI-assisted contract review. Verify important terms before signing.</p>
        <p className="sitefoot-meta muted small">
          <a href="https://github.com/moshayeb/MaSign" target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
          <span aria-hidden="true">·</span>
          <span>Version {APP_VERSION}</span>
        </p>
      </div>
    </footer>
  )
}
