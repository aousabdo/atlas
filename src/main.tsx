import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'

import App from './App'
import { applyTheme, initialTheme } from './lib/theme'
import './styles/index.css'

applyTheme(initialTheme())

/**
 * The hosted app gets real routes, so /map?focus=beacon is a shareable link.
 *
 * The single-file build cannot: it is opened from file:// or from wherever
 * someone dropped it, and BrowserRouter has no basename that matches
 * /Users/.../atlas.html. It uses hash routing instead, which needs no server
 * and no knowledge of the path. The presence of the inlined bundles is what
 * identifies a standalone build.
 */
const isStandalone = typeof window !== 'undefined' && window.__ATLAS_DATA__ !== undefined
const Router = isStandalone ? HashRouter : BrowserRouter
const routerProps = isStandalone ? {} : { basename: import.meta.env.BASE_URL }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router {...routerProps}>
      <App />
    </Router>
  </StrictMode>,
)
