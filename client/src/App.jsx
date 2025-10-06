import { useState, useEffect, useRef } from 'react'
import './App.css'
import TickerWidget from './components/TickerWidget'
import CandlestickChart from './components/CandlestickChart'
import ExchangeSelector from './components/ExchangeSelector'
import ApiStatus from './components/ApiStatus'

const API_BASE_URL = 'http://localhost:8000'

function App() {
  const [selectedExchange, setSelectedExchange] = useState('binance')
  const [selectedSymbol, setSelectedSymbol] = useState('BTC/USDT')
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h')
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
        setAvailableMarkets(data.markets || [])
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
            <p>Make sure the FastAPI server is running on localhost:8000</p>
            <p>Run: <code>python main.py</code> in the server directory</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
