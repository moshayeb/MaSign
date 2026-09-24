import type { ReactNode } from 'react'
import { PageChrome } from '../components/PageChrome'

// Shared layout for the small set of public pages the footer links to
// (MAS-132) — same header/footer chrome as the workspace, a narrow readable
// column for the prose.
export function StaticPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PageChrome>
      <main className="content staticpage">
        <article className="card staticpage-article">
          <h1>{title}</h1>
          {children}
        </article>
      </main>
    </PageChrome>
  )
}
