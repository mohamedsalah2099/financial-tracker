import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Login, { isLoggedIn } from './Login.jsx'
import { hydrateFromFile } from './lib/db.js'

function Root() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn)
  return loggedIn ? <App /> : <Login onLogin={() => setLoggedIn(true)} />
}

// Load data/db.json into localStorage first, so the app starts from the file.
hydrateFromFile().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
})
