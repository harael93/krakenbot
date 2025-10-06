import { useState, useEffect, useRef, useCallback } from 'react'

const TickerWidget = ({ exchange, symbol }) => {
  const [tickerData, setTickerData] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const wsRef = useRef(null)

  const connectWebSocket = useCallback(() => {
    try {
      if (wsRef.current) {
        wsRef.current.close()
      }

  const wsUrl = `ws://localhost:8000/ws/ticker/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}`
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        setIsConnected(true)
        setError(null)
        console.log(`Connected to ticker WebSocket: ${exchange} ${symbol}`)
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          setTickerData(data)
        } catch (err) {
          console.error('Error parsing ticker data:', err)
        }
      }

      wsRef.current.onclose = () => {
        setIsConnected(false)
        console.log('Ticker WebSocket disconnected')
      }

      wsRef.current.onerror = (error) => {
        setError('WebSocket connection error')
        console.error('Ticker WebSocket error:', error)
      }
    } catch (err) {
      setError('Failed to create WebSocket connection')
      console.error('WebSocket creation error:', err)
    }
  }, [exchange, symbol])

  useEffect(() => {
    connectWebSocket()
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connectWebSocket])

  const formatPrice = (price) => {
    if (price === null || price === undefined) return 'N/A'
    return typeof price === 'number' ? price.toFixed(2) : price
  }

  const formatPercentage = (percentage) => {
    if (percentage === null || percentage === undefined) return 'N/A'
    return typeof percentage === 'number' ? percentage.toFixed(2) + '%' : percentage
  }

  const getPriceChangeClass = (change) => {
    if (change > 0) return 'price-positive'
    if (change < 0) return 'price-negative'
    return 'price-neutral'
  }

  return (
    <div className="ticker-widget">
      <div className="ticker-header">
        <h3>Live Ticker: {symbol}</h3>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </div>

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={connectWebSocket}>Retry Connection</button>
        </div>
      )}

      {tickerData && (
        <div className="ticker-data">
          <div className="ticker-grid">
            <div className="ticker-item">
              <div className="ticker-label">Last Price</div>
              <div className="ticker-value">
                ${formatPrice(tickerData.last)}
              </div>
            </div>

            <div className="ticker-item">
              <div className="ticker-label">24h Change</div>
              <div className={`ticker-value ${getPriceChangeClass(tickerData.change)}`}>
                {formatPrice(tickerData.change)} ({formatPercentage(tickerData.percentage)})
              </div>
            </div>

            <div className="ticker-item">
              <div className="ticker-label">Bid / Ask</div>
              <div className="ticker-value">
                ${formatPrice(tickerData.bid)} / ${formatPrice(tickerData.ask)}
              </div>
            </div>

            <div className="ticker-item">
              <div className="ticker-label">24h High</div>
              <div className="ticker-value">
                ${formatPrice(tickerData.high)}
              </div>
            </div>

            <div className="ticker-item">
              <div className="ticker-label">24h Low</div>
              <div className="ticker-value">
                ${formatPrice(tickerData.low)}
              </div>
            </div>

            <div className="ticker-item">
              <div className="ticker-label">Volume</div>
              <div className="ticker-value">
                {tickerData.volume ? tickerData.volume.toLocaleString() : 'N/A'}
              </div>
            </div>
          </div>

          {tickerData.datetime && (
            <div className="ticker-timestamp">
              Last updated: {new Date(tickerData.datetime).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {!tickerData && isConnected && (
        <div className="loading">
          <p>Waiting for ticker data...</p>
        </div>
      )}
    </div>
  )
}

export default TickerWidget