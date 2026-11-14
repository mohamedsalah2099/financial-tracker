import { PASSWORD } from '../src/password.js'

/**
 * Shared database for the deployed site, so every device sees the same data.
 * Same protocol as db-plugin.js on the dev server:
 *   GET /api/db  -> the saved database (404 if nothing saved yet)
 *   PUT /api/db  -> replaces it
 * Stored as one JSON value in Upstash Redis. Add it in Vercel → Storage → Upstash
 * (Redis); that sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).
 * Requests must carry the login password in the X-App-Password header.
 */

const KEY = 'personal-finance-db'

function redis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, headers: { Authorization: `Bearer ${token}` } } : null
}

/** X-Json-Db tells the app this is a real database; without it the app keeps local data. */
function reply(body, status, isDb = true) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  if (isDb) headers['X-Json-Db'] = '1'
  return new Response(body, { status, headers })
}

function check(request) {
  const db = redis()
  if (!db) return { error: reply('{"error":"storage not set up"}', 503, false) }
  let given = ''
  try {
    given = decodeURIComponent(request.headers.get('x-app-password') || '')
  } catch {
    // malformed header: treated as a wrong password
  }
  if (given !== PASSWORD) return { error: reply('{"error":"wrong password"}', 401, false) }
  return { db }
}

export async function GET(request) {
  const { db, error } = check(request)
  if (error) return error
  const res = await fetch(`${db.url}/get/${KEY}`, { headers: db.headers })
  if (!res.ok) return reply('{"error":"storage read failed"}', 502, false)
  const { result } = await res.json()
  return result == null ? reply('{}', 404) : reply(result, 200)
}

export async function PUT(request) {
  const { db, error } = check(request)
  if (error) return error
  const text = await request.text()
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object')
  } catch {
    return reply('{"error":"invalid JSON"}', 400)
  }
  const res = await fetch(`${db.url}/set/${KEY}`, { method: 'POST', headers: db.headers, body: text })
  if (!res.ok) return reply('{"error":"storage write failed"}', 502, false)
  return new Response(null, { status: 204, headers: { 'X-Json-Db': '1' } })
}
