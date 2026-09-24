import type { ReactNode } from 'react'
import { Toaster } from 'sonner'
import { Footer } from './Footer'
import { Wordmark } from './Wordmark'

// The header + toaster + footer every screen shares — the workspace (App.tsx)
// and the public static pages alike, so the site reads as one product, not a
// workspace with unrelated pages bolted on (MAS-132).
export function PageChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <Toaster position="top-right" theme="light" richColors closeButton />
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="MaSign home">
            <Wordmark height={26} />
          </a>
        </div>
      </header>
      {children}
      <Footer />
    </>
  )
}
