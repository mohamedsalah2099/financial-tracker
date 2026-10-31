import { useState } from 'react'

const PASSWORD = 'mosalah'
const AUTH_KEY = 'wedding-finance-logged-in'

export function isLoggedIn() {
  try {
    return localStorage.getItem(AUTH_KEY) === '1'
  } catch {
    return false
  }
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

  const submit = (event) => {
    event.preventDefault()
    if (value !== PASSWORD) {
      setError(true)
      return
    }
    try {
      localStorage.setItem(AUTH_KEY, '1')
    } catch {
      // still let them in for this visit
    }
    onLogin()
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
      <button type="submit" className="primary">
        Login
      </button>
      {error ? <p className="login-error">Wrong password</p> : null}
    </form>
  )
}
