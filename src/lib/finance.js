const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function parseDate(value) {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Spendable USD removed when paying this amount in EGP at the given rate. */
export function egpExpenseToUsd(egpAmount, usdToEgpRate) {
  const rate = Number(usdToEgpRate) || 1
  const egp = Number(egpAmount) || 0
  if (egp <= 0) return 0
  return egp / rate
}

/** EGP-per-USD price for this expense; falls back to the global rate. */
export function expenseRate(expense, fallbackRate) {
  return Number(expense.usdRate) || Number(fallbackRate) || 1
}

export function expenseSpendableUsd(expense, usdToEgpRate) {
  const amount = Number(expense.amount) || 0
  if (expense.currency === 'USD') return amount
  if (expense.currency === 'EGP')
    return egpExpenseToUsd(amount, expenseRate(expense, usdToEgpRate))
  return 0
}

export function formatMoney(amount, currency) {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  })
  const sign = amount < 0 ? '−' : ''
  return `${sign}${currency === 'USD' ? '$' : ''}${formatted}${currency === 'EGP' ? ' EGP' : ''}`
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

function firstDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1)
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function salaryForWorkMonth(workMonthDate, settings) {
  const increaseFrom = parseDate(settings.salaryIncreaseDate)
  const workStart = firstDayOfMonth(
    workMonthDate.getFullYear(),
    workMonthDate.getMonth(),
  )
  if (increaseFrom && workStart >= firstDayOfMonth(increaseFrom.getFullYear(), increaseFrom.getMonth())) {
    return settings.salaryAfterIncrease
  }
  return settings.salaryBeforeIncrease
}

/** Salary for work in month M is paid on the 1st of month M+1. */
export function buildSalaryEvents(settings, weddingDate) {
  const events = []
  const from = parseDate(settings.planStartDate)
  const wedding = parseDate(weddingDate)
  if (!from || !wedding) return events

  let cursor = firstDayOfMonth(from.getFullYear(), from.getMonth())
  const weddingMonth = wedding.getMonth()
  const weddingYear = wedding.getFullYear()

  while (cursor <= wedding) {
    const paymentDate = addMonths(cursor, 1)
    if (paymentDate > wedding) break

    const isJulyWorkExcluded =
      settings.excludeJulySalaryAtWedding &&
      cursor.getMonth() === 6 &&
      cursor.getFullYear() === weddingYear

    if (!isJulyWorkExcluded) {
      const amount = salaryForWorkMonth(cursor, settings)
      events.push({
        id: `salary-${monthKey(cursor)}`,
        kind: 'salary',
        date: formatDate(paymentDate),
        label: `Salary (work: ${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()})`,
        amountUsd: amount,
        amountEgp: 0,
        recurring: false,
        locked: true,
      })
    }

    cursor = addMonths(cursor, 1)
  }

  return events
}

function normalizeCustomExpense(expense, fallbackRate) {
  return {
    id: expense.id,
    kind: 'expense',
    date: expense.date,
    label: expense.label || 'Expense',
    amountUsd: expense.currency === 'USD' ? Number(expense.amount) || 0 : 0,
    amountEgp: expense.currency === 'EGP' ? Number(expense.amount) || 0 : 0,
    rate: expenseRate(expense, fallbackRate),
    recurring: expense.type === 'monthly',
    monthEnd: expense.monthEnd || '',
    locked: false,
  }
}

export function expandCustomExpenses(customExpenses, weddingDate, fallbackRate) {
  const wedding = parseDate(weddingDate)
  if (!wedding) return []

  const events = []
  for (const raw of customExpenses) {
    const base = normalizeCustomExpense(raw, fallbackRate)
    if (!base.recurring) {
      const on = parseDate(base.date)
      if (on && on <= wedding) events.push({ ...base, id: raw.id })
      continue
    }

    const start = parseDate(raw.date)
    const end = parseDate(raw.monthEnd || weddingDate) || wedding
    if (!start) continue

    const cap = end < wedding ? end : wedding
    let cursor = firstDayOfMonth(start.getFullYear(), start.getMonth())
    const capMonth = firstDayOfMonth(cap.getFullYear(), cap.getMonth())

    while (cursor <= capMonth) {
      events.push({
        ...base,
        id: `${raw.id}-${monthKey(cursor)}`,
        date: formatDate(cursor),
        label: `${base.label} (${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()})`,
      })
      cursor = addMonths(cursor, 1)
    }
  }

  return events
}

/** One-off extra income; EGP is converted to spendable USD at the default rate. */
export function buildIncomeEvents(extraIncome, rate) {
  return extraIncome.map((income) => {
    const amount = Number(income.amount) || 0
    const isEgp = income.currency === 'EGP'
    const usd = isEgp ? egpExpenseToUsd(amount, rate) : amount
    return {
      id: income.id,
      kind: 'income',
      date: income.date,
      name: income.label || 'Extra income',
      detail: isEgp ? `${formatMoney(amount, 'EGP')} ÷ ${rate}` : '',
      label: isEgp
        ? `${income.label || 'Extra income'} — ${formatMoney(amount, 'EGP')} ÷ ${rate}`
        : income.label || 'Extra income',
      amountUsd: usd,
      amountEgp: 0,
      recurring: false,
      locked: false,
    }
  })
}

const KIND_ORDER = { salary: 0, income: 1, expense: 2 }

export function mergeEvents(salaryEvents, customEvents) {
  return [...salaryEvents, ...customEvents].sort((a, b) => {
    const da = parseDate(a.date)?.getTime() ?? 0
    const db = parseDate(b.date)?.getTime() ?? 0
    if (da !== db) return da - db
    if (a.kind === b.kind) return a.label.localeCompare(b.label)
    return (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3)
  })
}

/**
 * End-of-month spendable USD from the as-of month through the wedding month
 * (the wedding month closes on the wedding day, not the calendar month end).
 */
export function buildMonthlyForecast(ledger, asOfDate, weddingDate) {
  const asOf = parseDate(asOfDate)
  const wedding = parseDate(weddingDate)
  if (!asOf || !wedding || ledger.length === 0) return []

  const months = []
  let i = 0
  let balance = ledger[0].usdBalance
  let start = balance
  let cursor = firstDayOfMonth(asOf.getFullYear(), asOf.getMonth())

  while (cursor <= wedding) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const end = monthEnd < wedding ? monthEnd : wedding
    let inflow = 0
    let outflow = 0

    while (i < ledger.length && parseDate(ledger[i].date) <= end) {
      const row = ledger[i]
      if (row.kind !== 'opening') {
        if (row.usdDelta > 0) inflow += row.usdDelta
        else outflow -= row.usdDelta
      }
      balance = row.usdBalance
      i += 1
    }

    months.push({
      key: monthKey(cursor),
      label: `${MONTH_NAMES[cursor.getMonth()].slice(0, 3)} ${cursor.getFullYear()}`,
      endDate: formatDate(end),
      start,
      inflow,
      outflow,
      change: balance - start,
      balance,
      isWeddingMonth: end === wedding,
    })

    start = balance
    cursor = addMonths(cursor, 1)
  }

  return months
}

/**
 * Month-by-month total balance (spendable + gold, in USD) after the wedding, and
 * whether a home fits the rule "price ≤ maxShare × total balance" each month.
 * After the wedding: salaryAfterIncrease lands on the 1st of each month (the first
 * one is the July salary paid in August) and monthlyCostUsd goes out.
 */
export function forecastHomePurchase({
  settings,
  startTotalUsd,
  weddingDate,
  extraIncome = [],
  monthlyCostUsd,
  priceEgp,
  maxShare,
  windowStart,
  windowEnd,
  horizon = 60,
}) {
  const wedding = parseDate(weddingDate)
  const rate = Number(settings.usdToEgp) || 1
  const salary = Number(settings.salaryAfterIncrease) || 0
  const cost = Number(monthlyCostUsd) || 0
  const share = Math.min(Math.max(Number(maxShare) || 0, 0.01), 1)
  const priceUsd = (Number(priceEgp) || 0) / rate
  const neededTotalUsd = priceUsd / share
  if (!wedding) return null

  const months = []
  let total = Number(startTotalUsd) || 0
  let previous = wedding

  for (let m = 1; m <= horizon; m += 1) {
    const date = addMonths(wedding, m)
    const bonus = extraIncome
      .filter((i) => {
        const on = parseDate(i.date)
        return on && on > previous && on <= date
      })
      .reduce(
        (sum, i) =>
          sum + (i.currency === 'EGP' ? egpExpenseToUsd(i.amount, rate) : Number(i.amount) || 0),
        0,
      )
    total += salary - cost + bonus
    months.push({
      month: m,
      date: formatDate(date),
      label: `${MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`,
      totalUsd: total,
      limitUsd: total * share,
      affordable: priceUsd <= total * share,
      backupUsd: total - priceUsd,
      inWindow: m >= windowStart && m <= windowEnd,
    })
    previous = date
  }

  const firstAffordable = months.find((m) => m.affordable) ?? null
  const windowEndMonth = months.find((m) => m.month === windowEnd) ?? months[months.length - 1]
  const bestInWindow = months.find((m) => m.inWindow && m.affordable) ?? null
  const shortfallUsd = Math.max(0, neededTotalUsd - windowEndMonth.totalUsd)

  return {
    months,
    priceUsd,
    neededTotalUsd,
    firstAffordable,
    bestInWindow,
    windowEndMonth,
    shortfallUsd,
    /** Extra saving per month (from the wedding) that would make it fit by windowEnd. */
    extraPerMonthUsd: shortfallUsd / windowEnd,
    /** The most expensive home the rule allows at the end of the window. */
    maxPriceEgpAtWindowEnd: windowEndMonth.limitUsd * rate,
    rate,
  }
}

export function runProjection(settings, customExpenses, weddingDate, extraIncome = []) {
  const wedding = parseDate(weddingDate)
  const asOf = parseDate(settings.asOfDate) ?? new Date()

  let spendableUsd =
    (Number(settings.openingUsd) || 0) + (Number(settings.nbkUsd) || 0)
  const goldEgp = Number(settings.goldReserveEgp ?? settings.openingEgp) || 0
  const rate = Number(settings.usdToEgp) || 1

  const salaryEvents = buildSalaryEvents(settings, weddingDate)
  const customEvents = expandCustomExpenses(customExpenses, weddingDate, rate)
  const incomeEvents = buildIncomeEvents(extraIncome, rate)
  const timeline = mergeEvents(salaryEvents, [...incomeEvents, ...customEvents])

  const ledger = [
    {
      id: 'opening',
      date: formatDate(asOf),
      label: 'Opening balance (spendable USD incl. NBK + gold reserve)',
      usdDelta: 0,
      egpExpense: 0,
      usdBalance: spendableUsd,
      goldEgp,
      kind: 'opening',
    },
  ]

  for (const event of timeline) {
    const eventDate = parseDate(event.date)
    if (!eventDate || eventDate > wedding) continue
    if (eventDate < startOfDay(asOf) && event.kind !== 'opening') continue

    let usdDelta = 0
    let egpExpense = 0

    if (event.kind === 'salary' || event.kind === 'income') {
      spendableUsd += event.amountUsd
      usdDelta = event.amountUsd
    } else {
      if (event.amountUsd > 0) {
        spendableUsd -= event.amountUsd
        usdDelta = -event.amountUsd
      }
      if (event.amountEgp > 0) {
        const usdFromEgp = egpExpenseToUsd(event.amountEgp, event.rate)
        spendableUsd -= usdFromEgp
        usdDelta -= usdFromEgp
        egpExpense = event.amountEgp
      }
    }

    const usdFromEgpExpense =
      event.kind === 'expense' && event.amountEgp > 0
        ? egpExpenseToUsd(event.amountEgp, event.rate)
        : 0

    let label = event.label
    if (usdFromEgpExpense > 0) {
      label = `${event.label} — ${formatMoney(event.amountEgp, 'EGP')} ÷ ${event.rate} = ${formatMoney(-usdFromEgpExpense, 'USD')} spendable`
    }

    ledger.push({
      id: event.id,
      date: event.date,
      label,
      // Plain event name + conversion note, for compact on-screen display.
      name: event.name ?? event.label,
      detail:
        event.detail ??
        (usdFromEgpExpense > 0 ? `${formatMoney(event.amountEgp, 'EGP')} ÷ ${event.rate}` : ''),
      usdDelta,
      egpExpense,
      usdFromEgpExpense,
      expenseRate: usdFromEgpExpense > 0 ? event.rate : null,
      usdBalance: spendableUsd,
      goldEgp,
      kind: event.kind,
    })
  }

  const totalUsdEquivalent = spendableUsd + goldEgp / rate

  return {
    ledger,
    finalUsd: spendableUsd,
    finalEgp: goldEgp,
    totalUsdEquivalent,
    rate,
    weddingDate,
  }
}

export const DEFAULT_SETTINGS = {
  asOfDate: '2026-09-27',
  planStartDate: '2026-09-01',
  weddingDate: '2027-07-02',
  openingUsd: 40000,
  nbkUsd: 650,
  goldReserveEgp: 140000,
  usdToEgp: 51,
  salaryBeforeIncrease: 4250,
  salaryAfterIncrease: 4650,
  salaryIncreaseDate: '2027-02-01',
  excludeJulySalaryAtWedding: true,
}

export const DEFAULT_EXPENSES = [
  {
    id: 'personal',
    label: 'Personal expenses',
    amount: 500,
    currency: 'USD',
    usdRate: 51,
    type: 'monthly',
    date: '2026-10-01',
    monthEnd: '2027-07-01',
  },
  {
    id: 'sister-uni',
    label: "Sister's university",
    amount: 1500,
    currency: 'USD',
    usdRate: 51,
    type: 'one-time',
    date: '2027-02-01',
  },
]
