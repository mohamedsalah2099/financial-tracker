/**
 * Keeps data/db.json and localStorage in sync.
 *
 * Local (npm run dev / preview) — db-plugin.js serves the file:
 * - Before the app renders, `hydrateFromFile()` copies the file into
 *   localStorage, so every component keeps reading localStorage as before.
 *   If the file doesn't exist yet, the current localStorage data seeds it.
 * - `persist(key, value)` writes localStorage immediately and saves the
 *   whole database to the file shortly after (debounced).
 *
 * Deployed (Vercel or any static host) — no server can write files:
 * - data/db.json is bundled into the build. A browser loads it on its first
 *   visit, and again whenever a newer db.json is deployed (by `savedAt`).
 * - Edits made on the deployed site stay in that browser's localStorage.
 */

const API = '/api/db'
const SAVE_DELAY_MS = 400
/** savedAt of the db.json this browser last loaded. */
const VERSION_KEY = 'wedding-finance-db-version'

// The db.json present at build time (empty if the file doesn't exist).
const BUNDLED_DB =
  Object.values(import.meta.glob('../../data/db.json', { eager: true, import: 'default' }))[0] ??
  null

/** File field -> localStorage key, plus how each is shaped in localStorage. */
const TABLES = {
  expenses: {
    key: 'wedding-finance-tracker-v3',
    toStorage: (rows) => ({ expenses: rows }),
    fromStorage: (stored) => stored?.expenses,
  },
  wishlist: { key: 'wedding-finance-wishlist-v1' },
  extraIncome: { key: 'wedding-finance-income-v1' },
  dreamIncome: { key: 'wedding-finance-dreams-v1' },
  actualBalances: { key: 'wedding-finance-actuals-v1' },
  homePlan: { key: 'wedding-finance-home-plan-v1' },
  carPlan: { key: 'wedding-finance-car-plan-v1' },
  purchaseView: { key: 'wedding-finance-purchase-view-v1' },
}

let fileAvailable = false
let saveTimer = null

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked — the file (if available) still has the data.
  }
}

/** Snapshot of every table, in the file's shape. */
function snapshot() {
  const db = { savedAt: new Date().toISOString() }
  writeStorage(VERSION_KEY, db.savedAt)
  for (const [field, t] of Object.entries(TABLES)) {
    const stored = readStorage(t.key)
    const value = t.fromStorage ? t.fromStorage(stored) : stored
    if (value !== undefined) db[field] = value
  }
  return db
}

async function saveNow() {
  saveTimer = null
  try {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot()),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    console.warn('[db] could not save data/db.json — kept in localStorage only:', err)
  }
}

function scheduleSave() {
  if (!fileAvailable) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS)
}

function loadIntoStorage(db) {
  for (const [field, t] of Object.entries(TABLES)) {
    if (db[field] === undefined) continue
    writeStorage(t.key, t.toStorage ? t.toStorage(db[field]) : db[field])
  }
  if (db.savedAt) writeStorage(VERSION_KEY, db.savedAt)
}

/** Deployed: load the bundled db.json unless this browser already has it (or newer). */
function hydrateFromBundle() {
  if (!BUNDLED_DB || typeof BUNDLED_DB !== 'object') return
  const seen = readStorage(VERSION_KEY)
  if (seen && BUNDLED_DB.savedAt && seen >= BUNDLED_DB.savedAt) return
  loadIntoStorage(BUNDLED_DB)
}

/** Load data/db.json into localStorage. Call once before rendering. */
export async function hydrateFromFile() {
  let res
  try {
    res = await fetch(API, { cache: 'no-store' })
  } catch {
    res = null
  }

  // No file server here (static deploy): use the copy bundled at build time.
  if (!res || res.headers.get('X-Json-Db') !== '1') {
    hydrateFromBundle()
    return
  }

  fileAvailable = true

  if (res.status === 404) {
    // First run: seed the file from whatever this browser already has.
    await saveNow()
    return
  }
  if (!res.ok) return

  const db = await res.json().catch(() => null)
  if (db && typeof db === 'object') loadIntoStorage(db)
}

/** Save one table: localStorage now, the file shortly after. */
export function persist(key, value) {
  writeStorage(key, value)
  scheduleSave()
}

// Don't lose a pending save when the tab closes.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
    try {
      fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot()),
        keepalive: true,
      })
    } catch {
      // best effort
    }
  })
}
