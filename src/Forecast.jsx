import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildMonthlyForecast, formatMoney } from './lib/finance.js'

// A month whose balance falls by more than this share is flagged as a big drop.
const BIG_DROP_SHARE = 0.1

const CHART_HEIGHT = 260
const PAD = { top: 24, right: 20, bottom: 30, left: 56 }

/** The typed actual balance for a month, or null when blank / not a number. */
function actualOf(actuals, key) {
  const raw = actuals[key]
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function compactUsd(value) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}k`
  return `${sign}$${Math.round(abs)}`
}

/** Round the axis max up to a tidy step so gridlines land on readable values. */
function niceScale(maxValue, minValue) {
  const lo = Math.min(0, minValue)
  const span = Math.max(maxValue - lo, 1)
  const rawStep = span / 4
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep)
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(maxValue / step) * step
  const ticks = []
  for (let v = min; v <= max + step / 2; v += step) ticks.push(v)
  return { min, max, ticks }
}

function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(720)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.round(entry.contentRect.width)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function ForecastChart({ months, actuals, lowestKey }) {
  const [wrapRef, width] = useWidth()
  const [hover, setHover] = useState(null)

  const actualPoints = months
    .map((m, i) => ({ i, value: actualOf(actuals, m.key) }))
    .filter((p) => p.value != null)
  const actualValues = actualPoints.map((p) => p.value)
  const { min, max, ticks } = niceScale(
    Math.max(...months.map((m) => m.projected), ...actualValues),
    Math.min(...months.map((m) => m.projected), ...actualValues),
  )

  const innerW = width - PAD.left - PAD.right
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom
  const step = months.length > 1 ? innerW / (months.length - 1) : 0
  const x = (i) => PAD.left + i * step
  const y = (v) => PAD.top + innerH - ((v - min) / (max - min)) * innerH

  const linePath = months.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${y(m.projected)}`).join('')
  const areaPath = `${linePath}L${x(months.length - 1)},${y(Math.max(min, 0))}L${x(0)},${y(Math.max(min, 0))}Z`

  const actualPath = actualPoints
    .map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.value)}`)
    .join('')

  const lowestIndex = months.findIndex((m) => m.key === lowestKey)
  const labelEvery = Math.ceil(months.length / Math.max(2, Math.floor(innerW / 64)))

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width
    const i = Math.round((px - PAD.left) / (step || 1))
    setHover(Math.min(months.length - 1, Math.max(0, i)))
  }

  const hovered = hover == null ? null : months[hover]
  const hoveredActual = hovered ? actualOf(actuals, hovered.key) : null

  return (
    <div className="forecast-chart" ref={wrapRef}>
      <div className="forecast-legend" aria-hidden="true">
        <span>
          <i className="key-line projected" /> Projected
        </span>
        <span>
          <i className="key-line actual" /> Actual
        </span>
      </div>
      <svg
        width={width}
        height={CHART_HEIGHT}
        role="img"
        aria-label="Projected end-of-month spendable USD balance up to the wedding"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? 'fc-zero' : 'fc-grid'}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
            />
            <text className="fc-axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {compactUsd(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) =>
          // Regular ticks, plus the last month — skipping a tick that would crowd it.
          (i % labelEvery === 0 && months.length - 1 - i >= labelEvery) ||
          i === months.length - 1 ? (
            <text
              key={m.key}
              className="fc-axis"
              x={x(i)}
              y={CHART_HEIGHT - 8}
              textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'}
            >
              {m.isWeddingMonth ? `💍 ${m.label}` : m.label}
            </text>
          ) : null,
        )}

        <path className="fc-area" d={areaPath} />
        <path className="fc-line projected" d={linePath} />
        {actualPath ? <path className="fc-line actual" d={actualPath} /> : null}

        {hovered ? (
          <line
            className="fc-crosshair"
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + innerH}
          />
        ) : null}

        {months.map((m, i) => (
          <circle
            key={m.key}
            className="fc-dot projected"
            cx={x(i)}
            cy={y(m.projected)}
            r={hover === i ? 5 : 3.5}
          />
        ))}
        {actualPoints.map((p) => (
          <circle
            key={p.i}
            className="fc-dot actual"
            cx={x(p.i)}
            cy={y(p.value)}
            r={hover === p.i ? 5.5 : 4.5}
          />
        ))}

        {lowestIndex >= 0 ? (
          <g className="fc-lowest">
            <circle cx={x(lowestIndex)} cy={y(months[lowestIndex].balance)} r="9" />
            <text
              x={x(lowestIndex)}
              y={y(months[lowestIndex].balance) + 24}
              textAnchor={
                lowestIndex === 0 ? 'start' : lowestIndex === months.length - 1 ? 'end' : 'middle'
              }
            >
              Lowest {compactUsd(months[lowestIndex].balance)}
            </text>
          </g>
        ) : null}
      </svg>

      {hovered ? (
        <div
          className="fc-tooltip"
          style={{
            left: Math.min(Math.max(x(hover), 90), width - 90),
            top: PAD.top - 8,
          }}
        >
          <strong>
            {hovered.label}
            {hovered.isWeddingMonth ? ' · wedding' : ''}
          </strong>
          <span>
            <i className="key-line projected" /> Projected
            <b>{formatMoney(hovered.projected, 'USD')}</b>
          </span>
          {hoveredActual != null ? (
            <>
              <span>
                <i className="key-line actual" /> Actual
                <b>{formatMoney(hoveredActual, 'USD')}</b>
              </span>
              <span className="fc-tooltip-diff">
                Difference
                <b>{formatMoney(hoveredActual - hovered.projected, 'USD')}</b>
              </span>
            </>
          ) : null}
          <span className="fc-tooltip-diff">
            Change in month
            <b>{formatMoney(hovered.change, 'USD')}</b>
          </span>
        </div>
      ) : null}
    </div>
  )
}

export default function Forecast({ ledger, asOfDate, weddingDate, actuals, setActuals }) {
  const months = useMemo(
    () => buildMonthlyForecast(ledger, asOfDate, weddingDate),
    [ledger, asOfDate, weddingDate],
  )

  if (months.length === 0) return null

  const lowest = months.reduce((low, m) => (m.balance < low.balance ? m : low), months[0])
  const biggestDrop = months.reduce(
    (worst, m) => (m.change < (worst?.change ?? 0) ? m : worst),
    null,
  )
  const final = months[months.length - 1]
  const isBigDrop = (m) => m.change < 0 && -m.change >= m.start * BIG_DROP_SHARE

  const setActual = (key, value) => {
    setActuals((prev) => {
      const next = { ...prev }
      if (value === '') delete next[key]
      else next[key] = value
      return next
    })
  }

  return (
    <section className="panel full panel-forecast">
      <div className="panel-head">
        <h2>Financial forecast</h2>
        <span className="rate-badge">Spendable USD · end of month</span>
      </div>

      <div className="fc-body">
        <div className="fc-tiles">
          <div className="fc-tile">
            <span>On your wedding day</span>
            <strong>{formatMoney(final.balance, 'USD')}</strong>
            <small>{final.endDate}</small>
          </div>
          <div className="fc-tile lowest">
            <span>Lowest projected balance</span>
            <strong>{formatMoney(lowest.balance, 'USD')}</strong>
            <small>end of {lowest.label}</small>
          </div>
          <div className={`fc-tile${biggestDrop ? ' drop' : ''}`}>
            <span>Biggest monthly drop</span>
            <strong>{biggestDrop ? formatMoney(biggestDrop.change, 'USD') : 'None'}</strong>
            <small>{biggestDrop ? biggestDrop.label : 'Balance never falls'}</small>
          </div>
        </div>

        <ForecastChart months={months} actuals={actuals} lowestKey={lowest.key} />
      </div>

      <div className="table-wrap">
        <table className="fc-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num col-flow">Money in</th>
              <th className="num col-flow">Money out</th>
              <th className="num">Change</th>
              <th className="num">Projected balance</th>
              <th className="num">Actual balance</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const raw = actuals[m.key]
              const actual = actualOf(actuals, m.key)
              const diff = actual == null ? null : actual - m.projected
              return (
                <tr
                  key={m.key}
                  className={[
                    m.key === lowest.key ? 'is-lowest' : '',
                    isBigDrop(m) ? 'is-drop' : '',
                  ].join(' ')}
                >
                  <td>
                    {m.label}
                    {m.isWeddingMonth ? <span className="fc-tag wedding">💍 Wedding</span> : null}
                    {m.key === lowest.key ? <span className="fc-tag lowest">▼ Lowest</span> : null}
                    {isBigDrop(m) ? <span className="fc-tag drop">⚠ Big drop</span> : null}
                  </td>
                  <td className="num pos col-flow">{m.inflow ? `+${formatMoney(m.inflow, 'USD')}` : '—'}</td>
                  <td className="num neg col-flow">{m.outflow ? formatMoney(-m.outflow, 'USD') : '—'}</td>
                  <td className={`num ${m.change < 0 ? 'neg' : m.change > 0 ? 'pos' : ''}`}>
                    {m.change ? formatMoney(m.change, 'USD') : '—'}
                  </td>
                  <td className="num total">{formatMoney(m.projected, 'USD')}</td>
                  <td className="num">
                    <input
                      className="fc-actual-input"
                      type="number"
                      step="0.01"
                      placeholder="—"
                      aria-label={`Actual balance at end of ${m.label}`}
                      value={raw ?? ''}
                      onChange={(e) => setActual(m.key, e.target.value)}
                    />
                  </td>
                  <td className={`num ${diff == null ? '' : diff < 0 ? 'neg' : 'pos'}`}>
                    {diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatMoney(diff, 'USD')}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="wish-whatif-note">
        Projected = opening balance + salary + extra income − expenses, closed on the last day
        of each month (the wedding month closes on the wedding day). Type your real bank balance
        into “Actual balance” to compare — from then on the whole plan (later months, totals,
        timeline and purchase forecasts) continues from your real balance. A month is flagged ⚠ when it falls by{' '}
        {BIG_DROP_SHARE * 100}% or more.
      </p>
    </section>
  )
}
