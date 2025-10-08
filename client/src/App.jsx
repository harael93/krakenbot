import { useState, useEffect, useRef } from 'react'
import './App.css'
import TickerWidget from './components/TickerWidget'
import CandlestickChart from './components/CandlestickChart'
import ExchangeSelector from './components/ExchangeSelector'
import ApiStatus from './components/ApiStatus'

import { API_BASE } from './api'

const API_BASE_URL = API_BASE

function App() {
  // Kraken-only client
  const [selectedExchange, setSelectedExchange] = useState('kraken')
  // Default to ADA/USD per request
 
  const [selectedSymbol, setSelectedSymbol] = useState('ADA/USD')
  const [selectedTimeframe, setSelectedTimeframe] = useState('5m')
  const [apiStatus, setApiStatus] = useState('checking')
  const [availableMarkets, setAvailableMarkets] = useState([])

  // Check API status on mount
  useEffect(() => {
    checkApiStatus()
  }, [])

  const checkApiStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/`)
      if (response.ok) {
        setApiStatus('connected')
        fetchMarkets()
      } else {
        setApiStatus('error')
      }
    } catch (error) {
      console.error('API connection error:', error)
      setApiStatus('error')
    }
  }

  const fetchMarkets = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/markets/${selectedExchange}`)
      if (response.ok) {
        const data = await response.json()
        const markets = data.markets || []
        // Sort markets: prefer USD quote pairs, then alphabetical
        markets.sort((a, b) => {
          const aIsUSD = (a.quote === 'USD') ? 0 : 1
          const bIsUSD = (b.quote === 'USD') ? 0 : 1
          if (aIsUSD !== bIsUSD) return aIsUSD - bIsUSD
          return a.symbol.localeCompare(b.symbol)
        })

        setAvailableMarkets(markets)

        // If current selectedSymbol isn't present in the fetched markets,
        // pick a sensible default: prefer ADA/USD, otherwise first USD pair, otherwise first market
        const symbols = markets.map(m => m.symbol)
        const hasCurrent = symbols.includes(selectedSymbol)
        if (!hasCurrent && symbols.length > 0) {
          let candidate = markets.find(m => (m.base === 'ADA' || m.base === 'ADA') && m.quote === 'USD')
          if (!candidate) candidate = markets.find(m => m.quote === 'USD')
          if (!candidate) candidate = markets[0]
          setSelectedSymbol(candidate.symbol)
        }
      }
    } catch (error) {
      console.error('Error fetching markets:', error)
    }
  }

  useEffect(() => {
    if (apiStatus === 'connected') {
      fetchMarkets()
    }
  }, [selectedExchange, apiStatus])

  const handleExchangeChange = (exchange) => {
    setSelectedExchange(exchange)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>KrakenBot API Test Interface</h1>
        <ApiStatus status={apiStatus} onRetry={checkApiStatus} />
      </header>

      <div className="app-content">
        <div className="controls-section">
          <ExchangeSelector
            selectedExchange={selectedExchange}
            selectedSymbol={selectedSymbol}
            selectedTimeframe={selectedTimeframe}
            availableMarkets={availableMarkets}
            onExchangeChange={handleExchangeChange}
            onSymbolChange={setSelectedSymbol}
            onTimeframeChange={setSelectedTimeframe}
          />
        </div>

        {apiStatus === 'connected' && (
          <>
            <div className="ticker-section">
              <TickerWidget
                exchange={selectedExchange}
                symbol={selectedSymbol}
                apiBaseUrl={API_BASE_URL}
              />
            </div>

            <div className="chart-section">
              <CandlestickChart
                exchange={selectedExchange}
                symbol={selectedSymbol}
                timeframe={selectedTimeframe}
                apiBaseUrl={API_BASE_URL}
              />
            </div>
          </>
        )}

        {apiStatus === 'error' && (
          <div className="error-message">
            <h3>Cannot connect to API server</h3>
            <p>Make sure the FastAPI server is running at https://krakenbot.deployedlogic.site</p>
            <p>Run: <code>python main.py</code> in the server directory</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
