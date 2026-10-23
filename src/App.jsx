import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EXPENSES,
  DEFAULT_SETTINGS,
  expenseRate,
  expenseSpendableUsd,
  formatDate,
  formatMoney,
  parseDate,
  runProjection,
} from './lib/finance.js'
import { persist } from './lib/db.js'
import Forecast from './Forecast.jsx'
import HomePlanner from './HomePlanner.jsx'
import './App.css'

const STORAGE_KEY = 'wedding-finance-tracker-v3'
const WISHLIST_KEY = 'wedding-finance-wishlist-v1'
const INCOME_KEY = 'wedding-finance-income-v1'
const DREAMS_KEY = 'wedding-finance-dreams-v1'

const SETTINGS = DEFAULT_SETTINGS

/** Every expense carries its own USD price; older saved items get the default. */
function withOwnRate(expense) {
  return { ...expense, usdRate: Number(expense.usdRate) || SETTINGS.usdToEgp }
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
  { key: 'usdToEgp', label: 'USD → EGP rate' },
  { key: 'openingUsd', label: 'Opening USD ($35k + $5k)', format: 'USD' },
  { key: 'nbkUsd', label: 'NBK Bank account (USD)', format: 'USD' },
  { key: 'goldReserveEgp', label: 'Gold reserve (EGP, not spent)', format: 'EGP' },
  { key: 'salaryBeforeIncrease', label: 'Salary until increase', format: 'USD' },
  { key: 'salaryAfterIncrease', label: 'Salary after increase', format: 'USD' },
  { key: 'salaryIncreaseDate', label: 'Increase effective from' },
  {
    key: 'excludeJulySalaryAtWedding',
    label: 'Exclude July salary (paid in August)',
    format: 'bool',
  },
]

function formatRuleValue(key, value, format) {
  if (format === 'bool') return value ? 'Yes' : 'No'
  if (format === 'USD') return formatMoney(Number(value), 'USD')
  if (format === 'EGP') return formatMoney(Number(value), 'EGP')
  return value
}

function emptyExpense() {
  return {
    id: crypto.randomUUID(),
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
function exportLedgerCsv(ledger, rate) {
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
    round(row.usdBalance + row.goldEgp / rate),
  ])
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
  // BOM so Excel reads UTF-8 (÷, —, −) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cash-flow-timeline-${formatDate(new Date())}.csv`
  link.click()
  URL.revokeObjectURL(url)
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
  const [dream, setDream] = useState(emptyDream)

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
    persist(DREAMS_KEY, dreams)
  }, [dreams])

  const addDream = (event) => {
    event.preventDefault()
    if (!dream.label.trim() || !(Number(dream.amount) > 0)) return
    setDreams((prev) => [
      ...prev,
      {
        ...dream,
        id: crypto.randomUUID(),
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
    setIncomes((prev) =>
      [
        ...prev,
        {
          ...income,
          id: crypto.randomUUID(),
          label: income.label.trim(),
          amount: Number(income.amount),
        },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    )
    setIncome(emptyIncome())
  }

  const today = formatDate(new Date())

  const removeIncome = (id) => {
    setIncomes((prev) => prev.filter((i) => i.id !== id))
  }

  const addWish = (event) => {
    event.preventDefault()
    if (!wish.label.trim()) return
    setWishlist((prev) => [
      ...prev,
      { ...wish, id: crypto.randomUUID(), label: wish.label.trim() },
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

  const wedding = parseDate(SETTINGS.weddingDate)
  const daysToWedding = Math.round((wedding - parseDate(today)) / 86400000)
  const weddingLabel = wedding.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const projection = useMemo(
    () => runProjection(SETTINGS, expenses, SETTINGS.weddingDate, incomes),
    [expenses, incomes],
  )

  const ledgerByMonth = useMemo(() => {
    const groups = []
    for (const row of projection.ledger) {
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
      group.endBalance = row.usdBalance
    }
    return groups
  }, [projection.ledger])

  /** Matches the name or the date (e.g. "2026-09" finds everything in September). */
  const filteredExpenses = useMemo(() => {
    const q = expenseQuery.trim().toLowerCase()
    if (!q) return expenses
    return expenses.filter(
      (e) => e.label.toLowerCase().includes(q) || (e.date || '').includes(q),
    )
  }, [expenses, expenseQuery])

  const filteredWishlist = useMemo(() => {
    const q = wishQuery.trim().toLowerCase()
    return q ? wishlist.filter((w) => w.label.toLowerCase().includes(q)) : wishlist
  }, [wishlist, wishQuery])

  /** What-if: wishlist priced items converted to USD at the default rate. */
  const wishImpact = useMemo(() => {
    const priced = wishlist.filter((w) => Number(w.amount) > 0)
    const usd = priced.reduce(
      (sum, w) => sum + expenseSpendableUsd(w, SETTINGS.usdToEgp),
      0,
    )
    return { usd, priced: priced.length, unpriced: wishlist.length - priced.length }
  }, [wishlist])

  /** What-if: every dream income arrives (EGP at the default rate). */
  const dreamsUsd = useMemo(
    () =>
      dreams.reduce((sum, d) => sum + expenseSpendableUsd(d, SETTINGS.usdToEgp), 0),
    [dreams],
  )

  const addExpense = (event) => {
    event.preventDefault()
    if (!draft.label.trim() || !draft.amount) return
    setExpenses((prev) => [
      ...prev,
      {
        ...draft,
        id: crypto.randomUUID(),
        amount: Number(draft.amount),
        usdRate: Number(draft.usdRate) || SETTINGS.usdToEgp,
      },
    ])
    setDraft(emptyExpense())
  }

  const removeExpense = (id) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id))
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
          <p className="hero-label">Remaining on {SETTINGS.weddingDate}</p>
          <p className="hero-total">
            {formatMoney(projection.totalUsdEquivalent, 'USD')}
            <span className="hero-sub"> total equivalent</span>
          </p>
          <div className="hero-split">
            <span>Spendable {formatMoney(projection.finalUsd, 'USD')}</span>
            <span>Gold {formatMoney(projection.finalEgp, 'EGP')}</span>
          </div>
        </aside>
      </header>

      <main className="layout">
        <div className="main-col">
          <div className="col-stack">
            <section className="panel panel-locked" aria-readonly="true">
              <div className="panel-head">
                <h2>Starting position &amp; rules</h2>
                <span className="locked-badge">Fixed scenario</span>
              </div>
              <dl className="rules-grid">
                {RULE_FIELDS.map(({ key, label, format }) => (
                  <div key={key} className="rule-item">
                    <dt>{label}</dt>
                    <dd>{formatRuleValue(key, SETTINGS[key], format)}</dd>
                  </div>
                ))}
              </dl>
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
                    EGP at {SETTINGS.usdToEgp} per $1
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
                  aria-label="Add income"
                  title="Add income"
                >
                  +
                </button>
              </form>
              <p className="wish-whatif-note">
                Added to spendable USD on its date · EGP at {SETTINGS.usdToEgp} per $1
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
                title="Every expense has its own USD price, set when you add it. USD items deduct from spendable USD directly; EGP items deduct amount ÷ price. Your gold reserve is never touched."
              >
                Default USD price: {SETTINGS.usdToEgp} EGP
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
                <li key={expense.id}>
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
                    </span>
                  </span>
                  <span className="exp-amount">
                    <b>{formatMoney(Number(expense.amount), expense.currency)}</b>
                    <small>
                      {expense.currency === 'EGP'
                        ? `÷ ${expenseRate(expense, SETTINGS.usdToEgp)} = ${formatMoney(
                            -expenseSpendableUsd(expense, SETTINGS.usdToEgp),
                            'USD',
                          )}`
                        : `≈ ${formatMoney(
                            (Number(expense.amount) || 0) *
                              expenseRate(expense, SETTINGS.usdToEgp),
                            'EGP',
                          )}`}
                    </small>
                  </span>
                  <span className="wish-actions">
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
                USD price (EGP per $1, optional)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={`Default: ${SETTINGS.usdToEgp}`}
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
                      -expenseSpendableUsd(draft, SETTINGS.usdToEgp),
                      'USD',
                    )}
                  </strong>
                  {draft.currency === 'EGP' ? (
                    <>
                      {' '}
                      ({formatMoney(Number(draft.amount) || 0, 'EGP')} ÷{' '}
                      {expenseRate(draft, SETTINGS.usdToEgp)})
                    </>
                  ) : null}
                </p>
              ) : null}
              <button type="submit" className="primary">
                Add expense
              </button>
            </form>
            <button type="button" className="ghost" onClick={resetExpenses}>
              Reset default expenses
            </button>
          </section>
        </aside>

        <Forecast
          ledger={projection.ledger}
          asOfDate={SETTINGS.asOfDate}
          weddingDate={SETTINGS.weddingDate}
        />

        <HomePlanner
          settings={SETTINGS}
          startTotalUsd={projection.totalUsdEquivalent}
          weddingDate={SETTINGS.weddingDate}
          extraIncome={incomes}
        />

        <section className="panel full">
          <div className="panel-head">
            <h2>Cash-flow timeline</h2>
            <button
              type="button"
              className="export-btn"
              onClick={() => exportLedgerCsv(projection.ledger, projection.rate)}
            >
              ↓ Export CSV
            </button>
          </div>
          <p className="expense-note">
            Gold reserve stays at {formatMoney(projection.finalEgp, 'EGP')} throughout and is
            included in Total. {projection.ledger.length} entries, grouped by month.
          </p>
          <div className="table-wrap ledger-scroll">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th className="col-day">Day</th>
                  <th>Event</th>
                  <th className="num">Change</th>
                  <th className="num">Spendable USD</th>
                  <th className="num">Total (USD eq.)</th>
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
                      <th className="num">{formatMoney(group.endBalance, 'USD')}</th>
                      <th />
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
                        <td className="num">{formatMoney(row.usdBalance, 'USD')}</td>
                        <td className="num total">
                          {formatMoney(row.usdBalance + row.goldEgp / projection.rate, 'USD')}
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
    </div>
  )
}

export default App
