import React from 'react'

const ExchangeSelector = ({
  selectedExchange,
  selectedSymbol,
  selectedTimeframe,
  availableMarkets,
  onExchangeChange,
  onSymbolChange,
  onTimeframeChange
}) => {
  // Kraken-only UI
  const exchanges = [
    { id: 'kraken', name: 'Kraken' }
  ]

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

  // Popular trading pairs as fallback
  // Show all fetched markets; render as a scrollable listbox if there are many
  const symbolsToShow = availableMarkets.length > 0 ? availableMarkets : []
  const [filter, setFilter] = React.useState('')

  // Filter symbols by typed input (case-insensitive)
  const filteredSymbols = filter.trim()
    ? symbolsToShow.filter(m => m.symbol.toLowerCase().includes(filter.trim().toLowerCase()))
    : symbolsToShow

  return (
    <div className="exchange-selector">
      <h3>Market Selection</h3>
      
      <div className="selector-grid">
        <div className="selector-group">
          <label htmlFor="exchange-select">Exchange:</label>
          <select
            id="exchange-select"
            value={selectedExchange}
            onChange={(e) => onExchangeChange(e.target.value)}
            className="selector"
          >
            {exchanges.map(exchange => (
              <option key={exchange.id} value={exchange.id}>
                {exchange.name}
              </option>
            ))}
          </select>
        </div>

        <div className="selector-group">
          <label htmlFor="symbol-select">Trading Pair:</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input
              aria-label="Filter markets"
              placeholder="Type to filter (e.g. XBT, BTC, USD)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="selector"
              style={{ padding: '0.5rem' }}
            />

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
      </div>
    </div>
  )
}

export default ExchangeSelector