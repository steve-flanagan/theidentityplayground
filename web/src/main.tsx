import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// getElementById returns HTMLElement | null, and createRoot won't accept null.
// Vite's template silences this with a `!` non-null assertion; an explicit
// check costs one line and fails with a message that says what's wrong instead
// of a null dereference somewhere inside React.
const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Cannot mount: #root is missing from index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
