import { useEffect, useMemo, useState } from 'react'
import { persist } from './lib/db.js'
import { forecastHomePurchase, formatMoney } from './lib/finance.js'

const VIEW_KEY = 'wedding-finance-purchase-view-v1'

// Each purchase keeps its own saved plan; the forecast math is the same.
const KINDS = {
  home: {
    key: 'wedding-finance-home-plan-v1',
    title: 'Home purchase forecast 🏠',
    tab: '🏠 Home',
    noun: 'home',
    priceStep: 50000,
    defaults: {
      priceEgp: 4000000,
      maxSharePct: 50,
      windowStart: 6,
      windowEnd: 12,
      // Rent ($300) + personal ($500) — the monthly costs already in the plan.
      monthlyCostUsd: 800,
    },
  },
  car: {
    key: 'wedding-finance-car-plan-v1',
    title: 'Car purchase forecast 🚗',
    tab: '🚗 Car',
    noun: 'car',
    priceStep: 25000,
    defaults: {
      priceEgp: 1200000,
      maxSharePct: 30,
      windowStart: 3,
      windowEnd: 9,
      monthlyCostUsd: 800,
    },
  },
}

function loadView() {
  try {
    const view = JSON.parse(localStorage.getItem(VIEW_KEY) || '"home"')
    return KINDS[view] ? view : 'home'
  } catch {
    return 'home'
  }
}

function loadPlan(kind) {
  const { key, defaults } = KINDS[kind]
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }
  } catch {
    return defaults
  }
}

function egpCompact(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.?0+$/, '')}M EGP`
  return formatMoney(Math.round(value / 1000) * 1000, 'EGP')
}

export default function HomePlanner(props) {
  const [view, setView] = useState(loadView)

  useEffect(() => {
    persist(VIEW_KEY, view)
  }, [view])

  return (
    <PurchasePlanner
      // Remount on switch so each kind loads its own saved plan.
      key={view}
      kind={view}
      onKindChange={setView}
      {...props}
    />
  )
}

function PurchasePlanner({ kind, onKindChange, settings, startTotalUsd, weddingDate, extraIncome }) {
  const config = KINDS[kind]
  const { noun } = config
  const [plan, setPlan] = useState(() => loadPlan(kind))

  useEffect(() => {
    persist(config.key, plan)
  }, [config.key, plan])

  const windowStart = Math.max(1, Number(plan.windowStart) || 1)
  const windowEnd = Math.max(windowStart, Number(plan.windowEnd) || windowStart)

  const result = useMemo(
    () =>
      forecastHomePurchase({
        settings,
        startTotalUsd,
        weddingDate,
        extraIncome,
        monthlyCostUsd: plan.monthlyCostUsd,
        priceEgp: plan.priceEgp,
        maxShare: (Number(plan.maxSharePct) || 0) / 100,
        windowStart,
        windowEnd,
      }),
    [settings, startTotalUsd, weddingDate, extraIncome, plan, windowStart, windowEnd],
  )

  if (!result) return null

  const { bestInWindow, firstAffordable, windowEndMonth } = result
  const set = (key) => (e) => setPlan({ ...plan, [key]: e.target.value })
  const share = (Number(plan.maxSharePct) || 0) / 100

  // Show the window, plus every month up to the first affordable one (if it's later).
  const lastShown = Math.max(windowEnd, firstAffordable?.month ?? 0)
  const shown = result.months.slice(0, lastShown)

  let verdict
  if (bestInWindow) {
    verdict = {
      tone: 'yes',
      title: `Yes — the ideal time is ${bestInWindow.label}`,
      body: `${bestInWindow.month} months after the wedding your total balance reaches ${formatMoney(
        bestInWindow.totalUsd,
        'USD',
      )}, so the ${noun} (${formatMoney(result.priceUsd, 'USD')}) is within your ${
        plan.maxSharePct
      }% limit. You'd keep ${formatMoney(bestInWindow.backupUsd, 'USD')} as backup.`,
    }
  } else if (firstAffordable && firstAffordable.month < windowStart) {
    verdict = {
      tone: 'yes',
      title: `Yes — affordable even before your window (${firstAffordable.label})`,
      body: `Any month in your ${windowStart}–${windowEnd} month window works; month ${windowStart} is the earliest you planned for.`,
    }
  } else {
    verdict = {
      tone: 'no',
      title: `Not within ${windowStart}–${windowEnd} months of the wedding`,
      body: `By ${windowEndMonth.label} your total balance is about ${formatMoney(
        windowEndMonth.totalUsd,
        'USD',
      )}. Keeping ${100 - plan.maxSharePct}% as backup means you need ${formatMoney(
        result.neededTotalUsd,
        'USD',
      )} — ${formatMoney(result.shortfallUsd, 'USD')} short.`,
    }
  }

  return (
    <section className="panel full panel-home">
      <div className="panel-head">
        <h2>{config.title}</h2>
        <div className="purchase-toggle" role="group" aria-label="Forecast to show">
          {Object.entries(KINDS).map(([id, k]) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === kind}
              className={id === kind ? 'active' : ''}
              onClick={() => onKindChange(id)}
            >
              {k.tab}
            </button>
          ))}
        </div>
        <span className="rate-badge">
          After the wedding · total balance incl. gold · {result.rate} EGP per $1
        </span>
      </div>

      <div className="home-top">
        <div className="home-inputs">
          <label>
            {noun === 'car' ? 'Car' : 'Home'} price (EGP)
            <input
              type="number"
              min="0"
              step={config.priceStep}
              value={plan.priceEgp}
              onChange={set('priceEgp')}
            />
          </label>
          <label>
            Max share of balance (%)
            <input
              type="number"
              min="1"
              max="100"
              value={plan.maxSharePct}
              onChange={set('maxSharePct')}
            />
          </label>
          <label>
            Buy between (months after wedding)
            <span className="home-range">
              <input type="number" min="1" value={plan.windowStart} onChange={set('windowStart')} />
              –
              <input type="number" min="1" value={plan.windowEnd} onChange={set('windowEnd')} />
            </span>
          </label>
          <label>
            Living costs after wedding ($/month)
            <input
              type="number"
              min="0"
              step="50"
              value={plan.monthlyCostUsd}
              onChange={set('monthlyCostUsd')}
            />
          </label>
        </div>

        <div className={`home-verdict ${verdict.tone}`}>
          <strong>
            {verdict.tone === 'yes' ? '✓ ' : '✕ '}
            {verdict.title}
          </strong>
          <p>{verdict.body}</p>
          {verdict.tone === 'no' ? (
            <ul>
              <li>
                <b>Wait:</b>{' '}
                {firstAffordable
                  ? `it fits in ${firstAffordable.label} (${firstAffordable.month} months after the wedding).`
                  : 'it does not fit within 5 years at these numbers.'}
              </li>
              <li>
                <b>Cheaper {noun}:</b> by {windowEndMonth.label} the rule allows up to{' '}
                {egpCompact(result.maxPriceEgpAtWindowEnd)}.
              </li>
              <li>
                <b>Save more:</b> an extra {formatMoney(result.extraPerMonthUsd, 'USD')}/month from
                the wedding would make {egpCompact(Number(plan.priceEgp) || 0)} fit by{' '}
                {windowEndMonth.label}.
              </li>
            </ul>
          ) : null}
        </div>
      </div>

      <ul className="home-months">
        {shown.map((m) => {
          const pct = Math.min(100, (result.priceUsd / m.totalUsd) * 100)
          return (
            <li
              key={m.month}
              className={[
                m.inWindow ? 'in-window' : '',
                m.affordable ? 'ok' : '',
                m === bestInWindow || (!bestInWindow && m === firstAffordable) ? 'best' : '',
              ].join(' ')}
              title={`Total ${formatMoney(m.totalUsd, 'USD')} · ${noun} is ${pct.toFixed(0)}% of it`}
            >
              <span className="home-month">
                <b>{m.label}</b>
                <small>+{m.month}</small>
              </span>
              <span className={`home-status ${m.affordable ? 'ok' : 'no'}`}>
                {m.affordable ? '✓' : '✕'} {pct.toFixed(0)}%
              </span>
              <span className="home-bar" aria-hidden="true">
                <span className="home-bar-fill" style={{ width: `${pct}%` }} />
                <span className="home-bar-limit" style={{ left: `${share * 100}%` }} />
              </span>
              <span className="home-total">{formatMoney(m.totalUsd, 'USD')}</span>
            </li>
          )
        })}
      </ul>

      <p className="wish-whatif-note">
        Bar = {noun} price as a share of your total balance (spendable USD + gold); the tick marks
        your {plan.maxSharePct}% limit. Shaded rows are your {windowStart}–{windowEnd} month window.
        Assumes your salary stays at {formatMoney(Number(settings.salaryAfterIncrease), 'USD')}, the
        rate stays at {result.rate} EGP per $1, and extra income dated after the wedding is
        included. If the exchange rate moves, the {noun}&apos;s USD cost moves with it.
      </p>
    </section>
  )
}
