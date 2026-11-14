import { useEffect, useState } from 'react'

/** Daily USD rates; the second URL is the API's documented fallback mirror. */
const RATE_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
]
const CACHE_KEY = 'wedding-finance-live-rate'

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return Number(cached?.rate) > 0 ? cached : null
  } catch {
    return null
  }
}

async function fetchUsdToEgp() {
  for (const url of RATE_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const data = await res.json()
      const rate = Number(data?.usd?.egp)
      if (rate > 0) return { rate: Math.round(rate * 100) / 100, date: data.date }
    } catch {
      // try the next URL
    }
  }
  return null
}

/**
 * Today's EGP per $1. Starts from the last fetched rate (or the fallback),
 * then updates once the API answers.
 * Returns { rate, date, status: 'live' | 'cached' | 'fallback' }.
 */
export function useLiveUsdToEgp(fallbackRate) {
  const [state, setState] = useState(() => {
    const cached = readCache()
    return cached
      ? { ...cached, status: 'cached' }
      : { rate: fallbackRate, date: null, status: 'fallback' }
  })

  useEffect(() => {
    let cancelled = false
    fetchUsdToEgp().then((live) => {
      if (cancelled || !live) return
      setState({ ...live, status: 'live' })
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(live))
      } catch {
        // the rate is still used for this visit
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
