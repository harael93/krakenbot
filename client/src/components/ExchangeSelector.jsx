import React from 'react'
import { API_BASE } from '../api'

const ExchangeSelector = ({
  selectedExchange,
  selectedSymbol,
  selectedTimeframe,
  availableMarkets,
 
  onSymbolChange,
  onTimeframeChange
}) => {
  // API_BASE imported from ../api
  // Kraken-only UI (single exchange)

  const timeframes = [
    { id: '1m', name: '1 Minute' },
    { id: '3m', name: '3 Minutes' },
    { id: '5m', name: '5 Minutes' },
    { id: '15m', name: '15 Minutes' },
    { id: '30m', name: '30 Minutes' },
    { id: '1h', name: '1 Hour' },
    { id: '2h', name: '2 Hours' },
    { id: '4h', name: '4 Hours' },
    { id: '6h', name: '6 Hours' },
    { id: '8h', name: '8 Hours' },
    { id: '12h', name: '12 Hours' },
    { id: '1d', name: '1 Day' },
    { id: '3d', name: '3 Days' },
    { id: '1w', name: '1 Week' }
  ]

  // Enhanced selector state
  const [filter, setFilter] = React.useState('')
  const [showUSDOnly, setShowUSDOnly] = React.useState(true)
  const [highlightedIndex, setHighlightedIndex] = React.useState(0)
  const listRef = React.useRef(null)

  const normalize = React.useCallback((s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, ''), [])

  // Scoring helper: exact match > startsWith (base or symbol) > contains
  const scoreMarket = React.useCallback((market, q) => {
    if (!q) return 0
    const qn = normalize(q)
    const sym = normalize(market.symbol)
    const base = normalize(market.base || '')
    const quote = normalize(market.quote || '')

    if (sym === qn) return 100
    if (base === qn) return 90
    if (quote === qn) return 85
    if (sym.startsWith(qn)) return 75
    if (base.startsWith(qn)) return 70
    if (sym.includes(qn)) return 50
    if (base.includes(qn) || quote.includes(qn)) return 45
    return 0
  }, [normalize])

  // Build filtered & sorted list
  const filteredSymbols = React.useMemo(() => {
    const q = filter.trim()
    const symbolsToShow = availableMarkets.length > 0 ? availableMarkets : []
    let list = symbolsToShow.slice()

    if (showUSDOnly) {
      list = list.filter(m => (m.quote || '').toUpperCase() === 'USD')
    }

    if (q) {
      list = list
        .map(m => ({ m, score: scoreMarket(m, q) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || a.m.symbol.localeCompare(b.m.symbol))
        .map(x => x.m)
    } else {
      // no query: prioritize USD pairs then alphabetic
      list.sort((a, b) => {
        const aUsd = ((a.quote || '').toUpperCase() === 'USD') ? 0 : 1
        const bUsd = ((b.quote || '').toUpperCase() === 'USD') ? 0 : 1
        if (aUsd !== bUsd) return aUsd - bUsd
        return a.symbol.localeCompare(b.symbol)
      })
    }

    // limit size to keep UI snappy
    return list.slice(0, 500)
  }, [availableMarkets, filter, showUSDOnly, scoreMarket])

  // Keep highlighted index in bounds and scroll into view
  React.useEffect(() => {
    setHighlightedIndex(i => Math.max(0, Math.min(i, Math.max(0, filteredSymbols.length - 1))))
  }, [filteredSymbols.length])

  // Live dashboard state: when bot is started, poll /bot/trades and show live updates
  const [dashboardActive, setDashboardActive] = React.useState(false)
  const [dashboardTrades, setDashboardTrades] = React.useState([])
  const dashboardPollRef = React.useRef(null)

  const fetchDashboardTrades = async () => {
    try {
      const res = await fetch(`${API_BASE}/bot/trades?limit=50`)
      if (!res.ok) return
      const j = await res.json()
      setDashboardTrades(j.trades || [])
    } catch (err) {
      // ignore transient errors
      // console.error('dashboard fetch', err)
    }
  }

  const startDashboard = async () => {
    // start server bot then activate dashboard only on success
    try {
      const res = await fetch(`${API_BASE}/bot/start?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=${encodeURIComponent(selectedTimeframe)}`, { method: 'POST' })
      if (!res.ok) { alert('Failed to start bot'); return }
      setDashboardActive(true)
      // initial fetch and start interval
      fetchDashboardTrades()
      dashboardPollRef.current = setInterval(fetchDashboardTrades, 3000)
    } catch (err) {
      alert('Failed to start bot: ' + err)
    }
  }

  const stopDashboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/bot/stop`, { method: 'POST' })
      if (!res.ok) { alert('Failed to stop bot'); return }
      setDashboardActive(false)
      if (dashboardPollRef.current) { clearInterval(dashboardPollRef.current); dashboardPollRef.current = null }
      setDashboardTrades([])
    } catch (err) {
      alert('Failed to stop bot: ' + err)
    }
  }

  // cleanup on unmount
  React.useEffect(() => {
    return () => { if (dashboardPollRef.current) clearInterval(dashboardPollRef.current) }
  }, [])

  React.useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[highlightedIndex]
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, filteredSymbols])

  const handleKeyDown = (e) => {
    if (!filteredSymbols || filteredSymbols.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setHighlightedIndex(i => Math.min(i + 1, filteredSymbols.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault(); const sel = filteredSymbols[highlightedIndex]; if (sel) onSymbolChange(sel.symbol)
    } else if (e.key === 'Escape') {
      e.preventDefault(); setFilter('')
    }
  }

  return (
    <div className="exchange-selector">
      <h3>Market Selection</h3>
      
      <div className="selector-grid">
      

        <div className="selector-group">
          <label htmlFor="symbol-select">Trading Pair:</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* Quick presets for common pairs */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {['ADA/USD', 'ETH/USD', 'BTC/USD', 'LTC/USD'].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onSymbolChange(p)}
                  className="selector"
                  style={{ padding: '0.25rem 0.5rem', cursor: 'pointer', background: 'transparent' }}
                >
                  {p}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                aria-label="Filter markets"
                placeholder="Type to filter (e.g. ADA, BTC, USD, ADA/USD)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={handleKeyDown}
                className="selector"
                style={{ padding: '0.5rem', flex: 1 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <input type="checkbox" checked={showUSDOnly} onChange={(e) => setShowUSDOnly(e.target.checked)} />
                <span style={{ fontSize: '0.9rem' }}>USD</span>
              </label>
            </div>

            {filteredSymbols.length > 0 ? (
            // Use a size attribute to show a scrollable listbox so the user can easily
            // scroll through long lists of market pairs (use min to keep it compact)
            <select
              id="symbol-select"
              value={selectedSymbol}
              onChange={(e) => onSymbolChange(e.target.value)}
              className="selector"
              size={Math.min(15, filteredSymbols.length)}
              style={{ overflowY: 'auto' }}
            >
              {filteredSymbols.map(market => (
                <option key={market.symbol} value={market.symbol}>
                  {market.symbol}
                  {market.base && market.quote && ` (${market.base}/${market.quote})`}
                </option>
              ))}
            </select>
            ) : (
              <select id="symbol-select" disabled className="selector">
                <option>No markets match filter</option>
              </select>
            )}
          </div>
        </div>

        <div className="selector-group">
          <label htmlFor="timeframe-select">Timeframe:</label>
          <select
            id="timeframe-select"
            value={selectedTimeframe}
            onChange={(e) => onTimeframeChange(e.target.value)}
            className="selector"
          >
            {timeframes.map(timeframe => (
              <option key={timeframe.id} value={timeframe.id}>
                {timeframe.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="selection-summary">
        <p>
          <strong>Current Selection:</strong> {selectedExchange.toUpperCase()} - {selectedSymbol} - {selectedTimeframe}
        </p>
        {availableMarkets.length > 0 && (
          <p className="market-info">
            {availableMarkets.length} markets available from {selectedExchange}
          </p>
        )}
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type="button" className="selector" onClick={startDashboard}>Start Bot</button>
          <button type="button" className="selector" onClick={stopDashboard}>Stop Bot</button>
          <button type="button" className="selector" onClick={async () => {
            try { const res = await fetch(`${API_BASE}/bot/status`); const j = await res.json(); alert(JSON.stringify(j)) } catch (err) { alert('Failed to query status: ' + err) }
          }}>Bot Status</button>
        </div>
      </div>
      {dashboardActive && (
        <div style={{ marginTop: '0.5rem', borderTop: '1px solid #ddd', paddingTop: '0.5rem' }}>
          <h4>Live Bot Dashboard</h4>
          {dashboardTrades.length === 0 ? (
            <p>No trades yet</p>
          ) : (
            <ul style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {dashboardTrades.map(t => (
                <li key={t.id}>{t.open_time}: {t.symbol} @ {t.entry_price} ({t.result})</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default ExchangeSelector