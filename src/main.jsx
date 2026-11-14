import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Login, { isLoggedIn, savedPassword } from './Login.jsx'
import { hydrateFromFile, setSyncPassword } from './lib/db.js'

/** Load the saved database (file locally, shared storage on Vercel) into localStorage. */
async function loadData(password) {
  setSyncPassword(password)
  await hydrateFromFile().catch(() => {})
}

function Root() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn)
  const onLogin = async (password) => {
    await loadData(password)
    setLoggedIn(true)
  }
  return loggedIn ? <App /> : <Login onLogin={onLogin} />
}

// Already logged in: load the data before the app renders, so it starts from it.
const ready = isLoggedIn() ? loadData(savedPassword()) : Promise.resolve()
ready.finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
})
