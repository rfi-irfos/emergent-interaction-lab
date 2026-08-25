import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The browser's default scroll restoration remembers the scroll offset per
// history entry and silently re-applies it on reload - on a hash-routed SPA
// like this one, reloading the same tab after having scrolled deep into a
// section (e.g. #pricing) can look exactly like "opening the page always
// jumps to pricing", even on a bare URL with no hash at all (flagged live).
// Manual restoration means a fresh load always starts at the top unless a
// real hash/deep-link says otherwise.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="loading-screen"><div className="loading-spinner" /></div>}>
      <App />
    </Suspense>
  </StrictMode>,
)
