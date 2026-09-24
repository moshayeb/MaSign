import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PAGES } from './pages'

// A static page's path wins if it matches; everything else (including "/"
// and any unrecognised path) is the workspace (MAS-132).
const Page = PAGES[window.location.pathname] ?? App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
