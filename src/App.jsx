import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EXPENSES,
  DEFAULT_SETTINGS,
  expenseSpendableUsd,
  formatDate,
  formatMoney,
  itemRate,
  parseDate,
  runProjection,
} from './lib/finance.js'
import { useLiveUsdToEgp } from './lib/rate.js'
import { persist } from './lib/db.js'
import Forecast from './Forecast.jsx'
import PurchasePlanner from './PurchasePlanner.jsx'
import { logout } from './Login.jsx'
import './App.css'
import { Analytics } from '@vercel/analytics/react'

const STORAGE_KEY = 'wedding-finance-tracker-v3'
const WISHLIST_KEY = 'wedding-finance-wishlist-v1'
const INCOME_KEY = 'wedding-finance-income-v1'
const DREAMS_KEY = 'wedding-finance-dreams-v1'
const ACTUALS_KEY = 'wedding-finance-actuals-v1'
const SETTINGS_KEY = 'wedding-finance-settings-v1'

/** Saved settings on top of the defaults, so new settings get their default value. */
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Whole months from today until the wedding (at least 1). */
function monthsUntil(today, wedding) {
  const t = parseDate(today)
  return Math.max(1, (wedding.getFullYear() - t.getFullYear()) * 12 + wedding.getMonth() - t.getMonth())
}

/** crypto.randomUUID only exists on HTTPS/localhost; fall back on plain-HTTP LAN access. */
function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Every expense carries its own USD price; older saved items get the default. */
function withOwnRate(expense) {
  return { ...expense, usdRate: Number(expense.usdRate) || DEFAULT_SETTINGS.usdToEgp }
}

/** Typed month-end bank balances, { 'YYYY-MM': value }. */
function loadActuals() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTUALS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function loadExpenses() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_EXPENSES
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.expenses)
      ? parsed.expenses.map(withOwnRate)
      : DEFAULT_EXPENSES
  } catch {
    return DEFAULT_EXPENSES
  }
}

const RULE_FIELDS = [
  { key: 'asOfDate', label: 'As-of date' },
  { key: 'weddingDate', label: 'Wedding date' },
  { key: 'planStartDate', label: 'Plan salaries from (work month)' },
  { key: 'usdToEgp', label: 'USD → EGP rate (live, for upcoming items)' },
  { key: 'openingUsd', label: 'Opening USD', format: 'USD' },
  { key: 'nbkUsd', label: 'NBK Bank account (USD)', format: 'USD' },
  { key: 'goldReserveEgp', label: 'Gold reserve (EGP, not spent)', format: 'EGP' },
  { key: 'goldValueUsd', label: 'Gold value (USD, used in totals)', format: 'USD' },
  { key: 'salaryBeforeIncrease', label: 'Salary until increase', format: 'USD' },
  { key: 'salaryAfterIncrease', label: 'Salary after increase', format: 'USD' },
  { key: 'salaryIncreaseDate', label: 'Increase effective from' },
  {
    key: 'excludeJulySalaryAtWedding',
    label: 'Exclude July salary (paid in August)',
    format: 'bool',
  },
  { key: 'goalUsd', label: 'Savings goal on wedding day (total)', format: 'USD' },
]

function formatRuleValue(key, value, format) {
  if (format === 'bool') return value ? 'Yes' : 'No'
  if (format === 'USD') return formatMoney(Number(value), 'USD')
  if (format === 'EGP') return formatMoney(Number(value), 'EGP')
  return value
}

function emptyExpense() {
  return {
    id: newId(),
    label: '',
    amount: '',
    currency: 'USD',
    usdRate: '',
    type: 'one-time',
    date: formatDate(new Date()),
    monthEnd: '',
  }
}

function loadList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function emptyWish() {
  return { label: '', amount: '', currency: 'EGP' }
}

function emptyDream() {
  return { label: '', amount: '', currency: 'USD' }
}

function emptyIncome() {
  return { label: '', amount: '', currency: 'USD', date: formatDate(new Date()) }
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Raw numbers (no currency symbols) so the file opens cleanly in Excel/Sheets. */
function exportLedgerCsv(ledger) {
  const round = (n) => Math.round(n * 100) / 100
  // Blank instead of 0 for columns that only apply to some rows (like "—" on screen).
  const optional = (n) => (n ? round(n) : '')
  const header = [
    'Date',
    'Event',
    'Spendable USD change',
    'EGP paid',
    'USD price (EGP per $1)',
    'USD cost (EGP / price)',
    'Spendable USD',
    'Gold reserve (EGP)',
    'Total (USD eq.)',
  ]
  const rows = ledger.map((row) => [
    row.date,
    row.label,
    optional(row.usdDelta),
    optional(row.egpExpense),
    row.expenseRate ?? '',
    optional(-row.usdFromEgpExpense),
    round(row.usdBalance),
    round(row.goldEgp),
    round(row.usdBalance + row.goldUsd),
  ])
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
  // BOM so Excel reads UTF-8 (÷, —, −) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cash-flow-timeline-${formatDate(new Date())}.csv`
  link.click()
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const [expenses, setExpenses] = useState(() => loadExpenses())
  const [draft, setDraft] = useState(emptyExpense)
  const [wishlist, setWishlist] = useState(() => loadList(WISHLIST_KEY))
  const [wish, setWish] = useState(emptyWish)
  const [wishQuery, setWishQuery] = useState('')
  const [expenseQuery, setExpenseQuery] = useState('')
  const [incomes, setIncomes] = useState(() => loadList(INCOME_KEY))
  const [income, setIncome] = useState(emptyIncome)
  const [dreams, setDreams] = useState(() => loadList(DREAMS_KEY))
  const [actuals, setActuals] = useState(loadActuals)
  const [dream, setDream] = useState(emptyDream)
  const [settings, setSettings] = useState(loadSettings)
  const [editingSettings, setEditingSettings] = useState(false)
  const [editingExpenseId, setEditingExpenseId] = useState(null)
  const [editingIncomeId, setEditingIncomeId] = useState(null)

  useEffect(() => {
    persist(STORAGE_KEY, { expenses })
  }, [expenses])

  useEffect(() => {
    persist(WISHLIST_KEY, wishlist)
  }, [wishlist])

  useEffect(() => {
    persist(INCOME_KEY, incomes)
  }, [incomes])

  useEffect(() => {
    persist(ACTUALS_KEY, actuals)
  }, [actuals])

  useEffect(() => {
    persist(DREAMS_KEY, dreams)
  }, [dreams])

  useEffect(() => {
    persist(SETTINGS_KEY, settings)
  }, [settings])

  const setSetting = (key, format) => (e) => {
    const { value, checked } = e.target
    if (format === 'bool') return setSettings((s) => ({ ...s, [key]: checked }))
    if (key.endsWith('Date')) {
      // Dates can't be blank: the whole plan depends on them.
      if (value) setSettings((s) => ({ ...s, [key]: value }))
      return undefined
    }
    return setSettings((s) => ({ ...s, [key]: value === '' ? '' : Number(value) }))
  }

  const addDream = (event) => {
    event.preventDefault()
    if (!dream.label.trim() || !(Number(dream.amount) > 0)) return
    setDreams((prev) => [
      ...prev,
      {
        ...dream,
        id: newId(),
        label: dream.label.trim(),
        amount: Number(dream.amount),
      },
    ])
    setDream(emptyDream())
  }

  const removeDream = (id) => {
    setDreams((prev) => prev.filter((d) => d.id !== id))
  }

  const addIncome = (event) => {
    event.preventDefault()
    if (!income.label.trim() || !(Number(income.amount) > 0) || !income.date) return
    const saved = {
      ...income,
      id: editingIncomeId ?? newId(),
      label: income.label.trim(),
      amount: Number(income.amount),
    }
    // Editing replaces the item (same id); adding appends it.
    setIncomes((prev) =>
      [...prev.filter((i) => i.id !== editingIncomeId), saved].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    )
    setIncome(emptyIncome())
    setEditingIncomeId(null)
  }

  const startEditIncome = (item) => {
    setIncome({ ...emptyIncome(), ...item, amount: String(item.amount) })
    setEditingIncomeId(item.id)
  }

  const cancelEditIncome = () => {
    setIncome(emptyIncome())
    setEditingIncomeId(null)
  }

  const today = formatDate(new Date())

  const removeIncome = (id) => {
    setIncomes((prev) => prev.filter((i) => i.id !== id))
    if (id === editingIncomeId) cancelEditIncome()
  }

  const addWish = (event) => {
    event.preventDefault()
    if (!wish.label.trim()) return
    setWishlist((prev) => [
      ...prev,
      { ...wish, id: newId(), label: wish.label.trim() },
    ])
    setWish(emptyWish())
  }

  const removeWish = (id) => {
    setWishlist((prev) => prev.filter((w) => w.id !== id))
  }

  /** Prefill the expense form; the item stays on the list until removed. */
  const fillExpenseFromWish = (item) => {
    setDraft({
      ...emptyExpense(),
      label: item.label,
      amount: item.amount,
      currency: item.currency,
    })
  }

  const wedding = parseDate(settings.weddingDate)
  const daysToWedding = Math.round((wedding - parseDate(today)) / 86400000)
  const weddingLabel = wedding.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Today's EGP per $1 from the currency API; used for everything not yet paid.
  const liveRate = useLiveUsdToEgp(settings.usdToEgp)
  const rate = liveRate.rate
  /** An item's rate: its own if paid (marked, or dated today or earlier), else the live rate. */
  const rateFor = (item) => itemRate(item, settings.usdToEgp, rate, today)
  const liveSettings = useMemo(() => ({ ...settings, usdToEgp: rate }), [settings, rate])

  const projection = useMemo(
    () =>
      runProjection(
        { ...settings, liveUsdToEgp: rate, today },
        expenses,
        settings.weddingDate,
        incomes,
        actuals,
      ),
    [settings, expenses, incomes, actuals, rate, today],
  )

  // Savings goal: how far the wedding-day total is from it, and the extra per month to close it.
  const goalUsd = Number(settings.goalUsd) || 0
  const goalGap = goalUsd - projection.totalUsdEquivalent
  const goalPerMonth = goalGap / monthsUntil(today, wedding)

  const ledgerByMonth = useMemo(() => {
    const groups = []
    for (const row of projection.ledger) {
      // Actual-balance corrections stay in the ledger (the forecast needs them) but aren't listed.
      if (row.kind === 'actual') continue
      const key = row.date.slice(0, 7)
      let group = groups[groups.length - 1]
      if (!group || group.key !== key) {
        const [y, m] = key.split('-').map(Number)
        group = {
          key,
          label: new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' }),
          rows: [],
          net: 0,
        }
        groups.push(group)
      }
      group.rows.push(row)
      group.net += row.usdDelta || 0
    }
    return groups
  }, [projection.ledger])

  /** Matches the name or the date (e.g. "2026-09" finds everything in September). */
  const filteredExpenses = useMemo(() => {
    const q = expenseQuery.trim().toLowerCase()
    const matches = q
      ? expenses.filter((e) => e.label.toLowerCase().includes(q) || (e.date || '').includes(q))
      : expenses
    // Oldest first; items without a date go last.
    return [...matches].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
  }, [expenses, expenseQuery])

  const filteredWishlist = useMemo(() => {
    const q = wishQuery.trim().toLowerCase()
    return q ? wishlist.filter((w) => w.label.toLowerCase().includes(q)) : wishlist
  }, [wishlist, wishQuery])

  /** What-if: wishlist priced items converted to USD at the default rate. */
  const wishImpact = useMemo(() => {
    const priced = wishlist.filter((w) => Number(w.amount) > 0)
    const usd = priced.reduce(
      (sum, w) => sum + expenseSpendableUsd(w, rate),
      0,
    )
    return { usd, priced: priced.length, unpriced: wishlist.length - priced.length }
  }, [wishlist, rate])

  /** What-if: every dream income arrives (EGP at the default rate). */
  const dreamsUsd = useMemo(
    () =>
      dreams.reduce((sum, d) => sum + expenseSpendableUsd(d, rate), 0),
    [dreams, rate],
  )

  const addExpense = (event) => {
    event.preventDefault()
    if (!draft.label.trim() || !draft.amount) return
    const saved = {
      ...draft,
      id: editingExpenseId ?? newId(),
      amount: Number(draft.amount),
      usdRate: Number(draft.usdRate) || rate,
    }
    // Editing replaces the item in place (same id); adding appends it.
    setExpenses((prev) =>
      editingExpenseId ? prev.map((e) => (e.id === editingExpenseId ? saved : e)) : [...prev, saved],
    )
    setDraft(emptyExpense())
    setEditingExpenseId(null)
  }

  const startEditExpense = (expense) => {
    setDraft({
      ...emptyExpense(),
      ...expense,
      amount: String(expense.amount),
      usdRate: expense.usdRate ?? '',
      monthEnd: expense.monthEnd ?? '',
    })
    setEditingExpenseId(expense.id)
  }

  const cancelEditExpense = () => {
    setDraft(emptyExpense())
    setEditingExpenseId(null)
  }

  /** Paid items keep their own rate; marking an upcoming EGP item paid records today's rate. */
  const togglePaid = (id) => {
    setExpenses((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e
        if (e.paid) return { ...e, paid: false }
        const recordRate = e.currency === 'EGP' && e.date > today
        return { ...e, paid: true, usdRate: recordRate ? rate : e.usdRate }
      }),
    )
  }

  const removeExpense = (id) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id))
    if (id === editingExpenseId) cancelEditExpense()
  }

  const resetExpenses = () => {
    setExpenses(DEFAULT_EXPENSES)
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-intro">
          <p className="eyebrow">
            <span>Wedding finance tracker</span>
            {daysToWedding > 0 ? (
              <span className="countdown">💍 {daysToWedding} days to go</span>
            ) : null}
            <button type="button" className="logout-link" onClick={logout}>
              Log out
            </button>
          </p>
          <h1>
            What you&apos;ll have on <em>your wedding day</em>
          </h1>
          <p className="subtitle">
            Every salary, expense and extra income between now and{' '}
            {weddingLabel}, in one running balance.
          </p>
          <ul className="hero-rules">
            <li>
              <span aria-hidden="true">📅</span>
              <span>
                <b>Salary lands on the 5th</b> of the month after you earn it
              </span>
            </li>
            <li>
              <span aria-hidden="true">⏸</span>
              <span>
                <b>July&apos;s salary isn&apos;t counted</b> — it arrives in August,
                after the wedding
              </span>
            </li>
            <li>
              <span aria-hidden="true">🪙</span>
              <span>
                <b>Gold stays untouched</b> — all spending comes from USD, with EGP
                converted at each expense&apos;s own rate
              </span>
            </li>
          </ul>
        </div>
        <aside className="hero-card">
          <p className="hero-label">Remaining on {settings.weddingDate}</p>
          <p className="hero-total">
            {formatMoney(projection.totalUsdEquivalent, 'USD')}
            <span className="hero-sub"> total equivalent</span>
          </p>
          <div className="hero-split">
            <span>Spendable {formatMoney(projection.finalUsd, 'USD')}</span>
            <span>Gold {formatMoney(projection.goldUsd, 'USD')}</span>
          </div>
          {goalUsd > 0 ? (
            <p className={`hero-goal ${goalGap > 0 ? 'short' : 'ok'}`}>
              {goalGap > 0
                ? `Goal ${formatMoney(goalUsd, 'USD')}: ${formatMoney(goalGap, 'USD')} short. Save ${formatMoney(goalPerMonth, 'USD')} more per month`
                : `Goal ${formatMoney(goalUsd, 'USD')}: on track, ${formatMoney(-goalGap, 'USD')} ahead`}
            </p>
          ) : (
            <p className="hero-goal">Set a savings goal under “Starting position &amp; rules”.</p>
          )}
        </aside>
      </header>

      <main className="layout">
        <div className="main-col">
          <div className="col-stack">
            <section className="panel panel-locked">
              <div className="panel-head">
                <h2>Starting position &amp; rules</h2>
                <button
                  type="button"
                  className="settings-toggle"
                  onClick={() => setEditingSettings((v) => !v)}
                >
                  {editingSettings ? '✓ Done' : '✎ Edit'}
                </button>
              </div>
              <dl className="rules-grid">
                {RULE_FIELDS.map(({ key, label, format }) => (
                  <div key={key} className="rule-item">
                    <dt>
                      {editingSettings && key === 'usdToEgp'
                        ? 'Default rate (offline, and past items without a rate)'
                        : label}
                    </dt>
                    <dd>
                      {editingSettings ? (
                        format === 'bool' ? (
                          <input
                            type="checkbox"
                            checked={Boolean(settings[key])}
                            onChange={setSetting(key, format)}
                          />
                        ) : (
                          <input
                            className="rule-input"
                            type={key.endsWith('Date') ? 'date' : 'number'}
                            step="any"
                            value={settings[key] ?? ''}
                            onChange={setSetting(key, format)}
                          />
                        )
                      ) : (
                        formatRuleValue(key, key === 'usdToEgp' ? rate : settings[key], format)
                      )}
                      {key === 'usdToEgp' && !editingSettings ? (
                        <small className="rate-date">
                          {liveRate.date
                            ? ` · rate of ${liveRate.date}${liveRate.status === 'cached' ? ' (last saved)' : ''}`
                            : ' · default (live rate unavailable)'}
                        </small>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
              {editingSettings ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSettings(DEFAULT_SETTINGS)}
                >
                  Reset settings to defaults
                </button>
              ) : null}
            </section>


            <section className="panel panel-wish">
              <div className="panel-head">
                <h2>Future purchases</h2>
                <span
                  className="locked-badge"
                  title="A scratch list of things you plan to buy. These don't affect the projection until you add them as an expense."
                >
                  Not counted
                </span>
              </div>
              {wishlist.length > 0 ? (
                <input
                  type="search"
                  className="wish-search"
                  aria-label="Search future purchases"
                  placeholder={`Search ${wishlist.length} item${wishlist.length === 1 ? '' : 's'}…`}
                  value={wishQuery}
                  onChange={(e) => setWishQuery(e.target.value)}
                />
              ) : null}
              {wishlist.length === 0 ? (
                <p className="empty-hint">Nothing saved yet.</p>
              ) : filteredWishlist.length === 0 ? (
                <p className="empty-hint wish-scroll">No items match “{wishQuery}”.</p>
              ) : (
                <ul className="wish-list wish-scroll">
                  {filteredWishlist.map((item) => (
                    <li key={item.id}>
                      <span className="wish-dot" aria-hidden="true" />
                      <span className="wish-text">
                        <span className="wish-name">{item.label}</span>
                      </span>
                      {item.amount ? (
                        <span className={`wish-amount ${item.currency.toLowerCase()}`}>
                          {formatMoney(Number(item.amount), item.currency)}
                        </span>
                      ) : null}
                      <span className="wish-actions">
                        <button
                          type="button"
                          className="wish-icon"
                          onClick={() => fillExpenseFromWish(item)}
                          aria-label={`Use ${item.label} as expense`}
                          title="Use as expense"
                        >
                          ↗
                        </button>
                        <button
                          type="button"
                          className="wish-icon danger"
                          onClick={() => removeWish(item.id)}
                          aria-label={`Remove ${item.label}`}
                          title="Remove"
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {wishImpact.priced > 0 ? (
                <div className="wish-whatif">
                  <p className="wish-whatif-title">If you bought all of these</p>
                  <dl>
                    <div>
                      <dt>Wishlist cost</dt>
                      <dd className="neg">{formatMoney(-wishImpact.usd, 'USD')}</dd>
                    </div>
                    <div>
                      <dt>Spendable at wedding</dt>
                      <dd className={projection.finalUsd - wishImpact.usd < 0 ? 'neg' : ''}>
                        {formatMoney(projection.finalUsd - wishImpact.usd, 'USD')}
                      </dd>
                    </div>
                    <div>
                      <dt>Total equivalent</dt>
                      <dd>
                        {formatMoney(projection.totalUsdEquivalent - wishImpact.usd, 'USD')}
                      </dd>
                    </div>
                  </dl>
                  <p className="wish-whatif-note">
                    EGP at {rate} per $1
                    {wishImpact.unpriced > 0
                      ? ` · ${wishImpact.unpriced} item${wishImpact.unpriced > 1 ? 's' : ''} without a price not counted`
                      : ''}
                  </p>
                </div>
              ) : null}
              <form className="wish-bar" onSubmit={addWish}>
                <input
                  className="wish-item"
                  aria-label="Item"
                  value={wish.label}
                  onChange={(e) => setWish({ ...wish, label: e.target.value })}
                  placeholder="What do you want to buy?"
                />
                <div className="wish-price">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="Estimated price (optional)"
                    value={wish.amount}
                    onChange={(e) => setWish({ ...wish, amount: e.target.value })}
                    placeholder="Price"
                  />
                  <div className="wish-currency" role="radiogroup" aria-label="Currency">
                    {['EGP', 'USD'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={wish.currency === c}
                        className={wish.currency === c ? 'active' : ''}
                        onClick={() => setWish({ ...wish, currency: c })}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  className="wish-add"
                  disabled={!wish.label.trim()}
                  aria-label="Save for later"
                  title="Save for later"
                >
                  +
                </button>
              </form>
            </section>

            <section className="panel panel-income">
              <div className="panel-head">
                <h2>Extra income</h2>
                <span className="income-badge">Counted</span>
              </div>
              {incomes.length > 0 ? (
                <ul className="wish-list">
                  {incomes.map((item) => {
                    const upcoming = item.date > today
                    return (
                      <li key={item.id} className={upcoming ? 'upcoming' : ''}>
                        <span className="wish-dot income" aria-hidden="true" />
                        <span className="exp-text">
                          <span className="wish-name">{item.label}</span>
                          <span className="income-date">
                            {item.date}
                            {upcoming ? <span className="upcoming-tag">Upcoming</span> : null}
                          </span>
                        </span>
                        <span className="wish-amount income">
                          +{formatMoney(Number(item.amount), item.currency)}
                        </span>
                        <span className="wish-actions">
                          <button
                            type="button"
                            className="wish-icon"
                            onClick={() => startEditIncome(item)}
                            aria-label={`Edit ${item.label}`}
                            title="Edit"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="wish-icon danger"
                            onClick={() => removeIncome(item.id)}
                            aria-label={`Remove ${item.label}`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              <form className="wish-bar income-bar" onSubmit={addIncome}>
                <input
                  className="wish-item"
                  aria-label="Income source"
                  value={income.label}
                  onChange={(e) => setIncome({ ...income, label: e.target.value })}
                  placeholder="Bonus, freelance, gift…"
                />
                <div className="wish-price">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="Amount"
                    value={income.amount}
                    onChange={(e) => setIncome({ ...income, amount: e.target.value })}
                    placeholder="Amount"
                  />
                  <div className="wish-currency" role="radiogroup" aria-label="Currency">
                    {['USD', 'EGP'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={income.currency === c}
                        className={income.currency === c ? 'active' : ''}
                        onClick={() => setIncome({ ...income, currency: c })}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="date"
                  className="income-date-input"
                  aria-label="Date received"
                  value={income.date}
                  onChange={(e) => setIncome({ ...income, date: e.target.value })}
                />
                <button
                  type="submit"
                  className="wish-add income"
                  disabled={!income.label.trim() || !(Number(income.amount) > 0)}
                  aria-label={editingIncomeId ? 'Save income' : 'Add income'}
                  title={editingIncomeId ? 'Save changes' : 'Add income'}
                >
                  {editingIncomeId ? '✓' : '+'}
                </button>
              </form>
              {editingIncomeId ? (
                <p className="editing-note">
                  Editing an income ·{' '}
                  <button type="button" className="link-btn" onClick={cancelEditIncome}>
                    Cancel
                  </button>
                </p>
              ) : null}
              <p className="wish-whatif-note">
                Added to spendable USD on its date · EGP at {rate} per $1 (live) if still to come
              </p>
            </section>

            <section className="panel panel-dreams">
              <div className="panel-head">
                <h2>Dream income ✦</h2>
                <span className="dream-badge">Not counted</span>
              </div>
              <p className="expense-note">
                Long shots you&apos;d love to land. They never touch the real projection.
              </p>
              {dreams.length > 0 ? (
                <>
                  <ul className="wish-list dream-list">
                    {dreams.map((item) => (
                      <li key={item.id}>
                        <span className="dream-star" aria-hidden="true">
                          ✦
                        </span>
                        <span className="wish-text">
                          <span className="wish-name">{item.label}</span>
                        </span>
                        <span className="wish-amount dream">
                          +{formatMoney(Number(item.amount), item.currency)}
                        </span>
                        <span className="wish-actions">
                          <button
                            type="button"
                            className="wish-icon danger"
                            onClick={() => removeDream(item.id)}
                            aria-label={`Remove ${item.label}`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="dream-whatif">
                    <span>If they all came true</span>
                    <strong>
                      {formatMoney(projection.finalUsd + dreamsUsd, 'USD')}
                    </strong>
                    <small>
                      spendable at wedding ({formatMoney(dreamsUsd, 'USD')} more)
                    </small>
                  </div>
                </>
              ) : null}
              <form className="wish-bar dream-bar" onSubmit={addDream}>
                <input
                  className="wish-item"
                  aria-label="Dream income"
                  value={dream.label}
                  onChange={(e) => setDream({ ...dream, label: e.target.value })}
                  placeholder="input"
                />
                <div className="wish-price">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="Amount"
                    value={dream.amount}
                    onChange={(e) => setDream({ ...dream, amount: e.target.value })}
                    placeholder="Amount"
                  />
                  <div className="wish-currency" role="radiogroup" aria-label="Currency">
                    {['USD', 'EGP'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={dream.currency === c}
                        className={dream.currency === c ? 'active' : ''}
                        onClick={() => setDream({ ...dream, currency: c })}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  className="wish-add dream"
                  disabled={!dream.label.trim() || !(Number(dream.amount) > 0)}
                  aria-label="Add dream"
                  title="Add dream"
                >
                  +
                </button>
              </form>
            </section>
          </div>
        </div>

        <aside className="sidebar">
          <section className="panel panel-active">
            <div className="panel-head">
              <h2>Expenses &amp; withdrawals</h2>
              <span
                className="rate-badge"
                title={`Upcoming EGP expenses use today's live rate${
                  liveRate.date ? ` (${liveRate.date})` : ' (offline: default rate)'
                }; already-paid ones keep the rate they were paid at. Your gold reserve is never touched.`}
              >
                {liveRate.status === 'fallback' ? 'Default' : 'Live'} USD price: {rate} EGP
              </span>
            </div>
            {expenses.length > 0 ? (
              <input
                type="search"
                className="wish-search"
                aria-label="Search expenses"
                placeholder={`Search ${expenses.length} expense${expenses.length === 1 ? '' : 's'} by name or date…`}
                value={expenseQuery}
                onChange={(e) => setExpenseQuery(e.target.value)}
              />
            ) : null}
            {expenses.length === 0 ? (
              <p className="empty-hint">
                No expenses yet — add wedding costs, personal spending, or withdrawals below.
              </p>
            ) : filteredExpenses.length === 0 ? (
              <p className="empty-hint">No expenses match “{expenseQuery}”.</p>
            ) : null}
            <ul className="wish-list expense-compact" hidden={filteredExpenses.length === 0}>
              {filteredExpenses.map((expense) => (
                <li
                  key={expense.id}
                  className={[
                    expense.paid ? 'is-paid' : '',
                    expense.id === editingExpenseId ? 'is-editing' : '',
                  ].join(' ')}
                >
                  <span
                    className={`wish-dot ${expense.type === 'monthly' ? 'monthly' : 'expense'}`}
                    aria-hidden="true"
                  />
                  <span className="exp-text">
                    <span className="wish-name">{expense.label}</span>
                    <span className="exp-meta">
                      {expense.type === 'monthly'
                        ? `Monthly · ${expense.date.slice(0, 7)} → ${
                            expense.monthEnd ? expense.monthEnd.slice(0, 7) : 'wedding'
                          }`
                        : expense.date}
                      {expense.paid ? <span className="paid-tag">✓ Paid</span> : null}
                    </span>
                  </span>
                  <span className="exp-amount">
                    <b>{formatMoney(Number(expense.amount), expense.currency)}</b>
                    <small>
                      {expense.currency === 'EGP'
                        ? `÷ ${rateFor(expense)} = ${formatMoney(
                            -expenseSpendableUsd({ ...expense, usdRate: rateFor(expense) }),
                            'USD',
                          )}`
                        : `≈ ${formatMoney(
                            (Number(expense.amount) || 0) *
                              rateFor(expense),
                            'EGP',
                          )}`}
                    </small>
                  </span>
                  <span className="wish-actions">
                    {expense.type === 'monthly' ? null : (
                      <button
                        type="button"
                        className={`wish-icon${expense.paid ? ' paid-on' : ''}`}
                        onClick={() => togglePaid(expense.id)}
                        aria-pressed={Boolean(expense.paid)}
                        aria-label={`${expense.paid ? 'Unmark' : 'Mark'} ${expense.label} as paid`}
                        title={expense.paid ? 'Paid. Click to unmark' : 'Mark as paid (keeps its rate)'}
                      >
                        ✓
                      </button>
                    )}
                    <button
                      type="button"
                      className="wish-icon"
                      onClick={() => startEditExpense(expense)}
                      aria-label={`Edit ${expense.label}`}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="wish-icon danger"
                      onClick={() => removeExpense(expense.id)}
                      aria-label={`Remove ${expense.label}`}
                      title="Remove"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            <form className="add-form grid two" onSubmit={addExpense}>
              <label>
                Label
                <input
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="e.g. Gold jewelry"
                />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                />
              </label>
              <label>
                Currency
                <select
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                >
                  <option value="USD">USD</option>
                  <option value="EGP">EGP</option>
                </select>
              </label>
              <label>
                USD price paid (EGP per $1, past items only)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={`Live: ${rate}`}
                  value={draft.usdRate}
                  onChange={(e) => setDraft({ ...draft, usdRate: e.target.value })}
                />
              </label>
              <label>
                Type
                <select
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                >
                  <option value="one-time">One-time</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label>
                {draft.type === 'monthly' ? 'First month' : 'Date'}
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>
              {draft.type === 'monthly' ? (
                <label>
                  Last month (optional)
                  <input
                    type="date"
                    value={draft.monthEnd}
                    onChange={(e) => setDraft({ ...draft, monthEnd: e.target.value })}
                  />
                </label>
              ) : (
                <span />
              )}
              {draft.amount ? (
                <p
                  className={
                    draft.currency === 'EGP' ? 'egp-preview' : 'usd-preview'
                  }
                >
                  Spendable USD impact:{' '}
                  <strong>
                    {formatMoney(
                      -expenseSpendableUsd({ ...draft, usdRate: rateFor(draft) }),
                      'USD',
                    )}
                  </strong>
                  {draft.currency === 'EGP' ? (
                    <>
                      {' '}
                      ({formatMoney(Number(draft.amount) || 0, 'EGP')} ÷{' '}
                      {rateFor(draft)})
                    </>
                  ) : null}
                </p>
              ) : null}
              <button type="submit" className="primary">
                {editingExpenseId ? 'Save changes' : 'Add expense'}
              </button>
              {editingExpenseId ? (
                <button type="button" className="link-btn form-cancel" onClick={cancelEditExpense}>
                  Cancel editing
                </button>
              ) : null}
            </form>
            <button type="button" className="ghost" onClick={resetExpenses}>
              Reset default expenses
            </button>
          </section>
        </aside>

        <Forecast
          ledger={projection.ledger}
          goldUsd={projection.goldUsd}
          otherBankUsd={projection.otherBankUsd}
          asOfDate={settings.asOfDate}
          weddingDate={settings.weddingDate}
          actuals={actuals}
          setActuals={setActuals}
          today={today}
        />

        <PurchasePlanner
          settings={liveSettings}
          startTotalUsd={projection.totalUsdEquivalent}
          weddingDate={settings.weddingDate}
          extraIncome={incomes}
        />

        <section className="panel full">
          <div className="panel-head">
            <h2>Cash-flow timeline</h2>
            <button
              type="button"
              className="export-btn"
              onClick={() => exportLedgerCsv(projection.ledger)}
            >
              ↓ Export CSV
            </button>
          </div>
          <p className="expense-note">
            {ledgerByMonth.reduce((n, g) => n + g.rows.length, 0)} entries, grouped by month.
          </p>
          <div className="table-wrap ledger-scroll">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th className="col-day">Day</th>
                  <th>Event</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {ledgerByMonth.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="ledger-month">
                      <th colSpan={2} scope="rowgroup">
                        {group.label}
                        <small>
                          {group.rows.length} {group.rows.length === 1 ? 'entry' : 'entries'}
                        </small>
                      </th>
                      <th className={`num ${group.net < 0 ? 'neg' : group.net > 0 ? 'pos' : ''}`}>
                        {group.net ? formatMoney(group.net, 'USD') : ''}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.id} className={row.kind}>
                        <td className="col-day">{row.date.slice(8)}</td>
                        <td>
                          <span className="ledger-name">{row.name ?? row.label}</span>
                          {row.detail ? <span className="ledger-detail">{row.detail}</span> : null}
                        </td>
                        <td
                          className={`num ${row.usdDelta < 0 ? 'neg' : row.usdDelta > 0 ? 'pos' : ''}`}
                        >
                          {row.usdDelta
                            ? `${row.usdDelta > 0 ? '+' : ''}${formatMoney(row.usdDelta, 'USD')}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Analytics />
    </div>
  )
}

export default App
