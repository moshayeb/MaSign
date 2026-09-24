import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { HomePage } from './HomePage.tsx'
import { PAGES } from './pages'

// MAS-133: the workspace moved from "/" to "/workspace". A bookmark or
// shared link from before that move looks like "/#<contract_id>/<tab>" —
// without this redirect it would land on the new home page with an ignored
// hash. Forward it to the workspace, preserving the hash, before anything
// renders (the `else` below is deliberate: rendering HomePage first, even
// briefly, would flash the wrong page before the navigation lands).
if (window.location.pathname === '/' && window.location.hash) {
  window.location.replace(`/workspace${window.location.hash}`)
} else {
  const ROUTES: Record<string, typeof App> = { '/': HomePage, '/workspace': App, ...PAGES }
  const Page = ROUTES[window.location.pathname] ?? HomePage

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  )
}
