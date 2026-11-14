import { useState } from 'react'
import { PASSWORD } from './password.js'

const AUTH_KEY = 'wedding-finance-logged-in'

/** The password this browser logged in with ('' if none); the sync API needs it too. */
export function savedPassword() {
  try {
    return localStorage.getItem(AUTH_KEY) || ''
  } catch {
    return ''
  }
}

export function isLoggedIn() {
  return savedPassword() === PASSWORD
}

export function logout() {
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    // ignore
  }
  window.location.reload()
}

export default function Login({ onLogin }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (value !== PASSWORD) {
      setError(true)
      return
    }
    try {
      localStorage.setItem(AUTH_KEY, value)
    } catch {
      // still let them in for this visit
    }
    setBusy(true)
    await onLogin(value)
  }

  return (
    <form className="login" onSubmit={submit}>
      <input
        type="password"
        placeholder="Password"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(false)
        }}
        autoFocus
      />
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Loading…' : 'Login'}
      </button>
      {error ? <p className="login-error">Wrong password</p> : null}
    </form>
  )
}
