import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import 'chartjs-adapter-date-fns'

ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  BarElement,
  Title,
  Tooltip,
  Legend
)

const CandlestickChart = ({ exchange, symbol, timeframe }) => {
  const [chartData, setChartData] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const [historicalData, setHistoricalData] = useState([])
  const wsRef = useRef(null)

  // Fetch initial historical data
  const fetchHistoricalData = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:8000/ohlcv/${exchange}/${symbol}?timeframe=${timeframe}&limit=100`)
      if (response.ok) {
        const data = await response.json()
        setHistoricalData(data.data || [])
        updateChartData(data.data || [])
      }
    } catch (err) {
      console.error('Error fetching historical data:', err)
      setError('Failed to fetch historical data')
    }
  }, [exchange, symbol, timeframe])

  // Connect to WebSocket for real-time updates
  const connectWebSocket = useCallback(() => {
    try {
      if (wsRef.current) {
        wsRef.current.close()
      }

      const wsUrl = `ws://localhost:8000/ws/ohlcv/${exchange}/${symbol}/${timeframe}`
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        setIsConnected(true)
        setError(null)
        console.log(`Connected to OHLCV WebSocket: ${exchange} ${symbol} ${timeframe}`)
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          
          if (data.type === 'initial_ohlcv') {
            setHistoricalData(data.data)
            updateChartData(data.data)
          } else if (data.type === 'ohlcv_update') {
            // Update the last candle or add new one
            setHistoricalData(prev => {
              const newData = [...prev]
              const lastIndex = newData.length - 1
              
              // Check if this is an update to the current candle or a new candle
              if (newData.length > 0 && newData[lastIndex].timestamp === data.timestamp) {
                // Update existing candle
                newData[lastIndex] = {
                  timestamp: data.timestamp,
                  datetime: data.datetime,
                  open: data.open,
                  high: data.high,
                  low: data.low,
                  close: data.close,
                  volume: data.volume
                }
              } else {
                // Add new candle
                newData.push({
                  timestamp: data.timestamp,
                  datetime: data.datetime,
                  open: data.open,
                  high: data.high,
                  low: data.low,
                  close: data.close,
                  volume: data.volume
                })
                
                // Keep only last 100 candles
                if (newData.length > 100) {
                  newData.shift()
                }
              }
              
              updateChartData(newData)
              return newData
            })
          }
        } catch (err) {
          console.error('Error parsing OHLCV data:', err)
        }
      }

      wsRef.current.onclose = () => {
        setIsConnected(false)
        console.log('OHLCV WebSocket disconnected')
      }

      wsRef.current.onerror = (error) => {
        setError('WebSocket connection error')
        console.error('OHLCV WebSocket error:', error)
      }
    } catch (err) {
      setError('Failed to create WebSocket connection')
      console.error('WebSocket creation error:', err)
    }
  }, [exchange, symbol, timeframe])

  // Update chart data format for Chart.js
  const updateChartData = (data) => {
    if (!data || data.length === 0) return

    const labels = data.map(candle => new Date(candle.timestamp || candle.datetime))
    const candlestickData = data.map(candle => ({
      x: new Date(candle.timestamp || candle.datetime),
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      v: candle.volume
    }))

    // Since Chart.js doesn't have native candlestick support, we'll use bar chart to represent OHLC
    const datasets = [
      {
        label: 'High-Low',
        data: candlestickData.map(candle => ({
          x: candle.x,
          y: [candle.l, candle.h]
        })),
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
        type: 'bar'
      },
      {
        label: 'Open-Close',
        data: candlestickData.map(candle => ({
          x: candle.x,
          y: [Math.min(candle.o, candle.c), Math.max(candle.o, candle.c)],
          color: candle.c >= candle.o ? 'green' : 'red'
        })),
        backgroundColor: candlestickData.map(candle => 
          candle.c >= candle.o ? 'rgba(75, 192, 192, 0.8)' : 'rgba(255, 99, 132, 0.8)'
        ),
        borderColor: candlestickData.map(candle => 
          candle.c >= candle.o ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)'
        ),
        borderWidth: 1,
        type: 'bar'
      }
    ]

    setChartData({
      labels,
      datasets
    })
  }

  useEffect(() => {
    fetchHistoricalData()
    connectWebSocket()
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [fetchHistoricalData, connectWebSocket])

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: `${symbol} - ${timeframe} Candlestick Chart`
      },
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: timeframe.includes('m') ? 'minute' : timeframe.includes('h') ? 'hour' : 'day'
        }
      },
      y: {
        beginAtZero: false
      }
    },
    interaction: {
      intersect: false,
      mode: 'index'
    }
  }

  return (
    <div className="candlestick-chart">
      <div className="chart-header">
        <h3>Candlestick Chart: {symbol}</h3>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Live Data' : '🔴 Disconnected'}
        </div>
      </div>

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => {
            fetchHistoricalData()
            connectWebSocket()
          }}>
            Retry Connection
          </button>
        </div>
      )}

      <div className="chart-container">
        {chartData ? (
          <Bar data={chartData} options={options} />
        ) : (
          <div className="loading">
            <p>Loading chart data...</p>
          </div>
        )}
      </div>

      <div className="chart-info">
        <p>Timeframe: {timeframe}</p>
        <p>Data points: {historicalData.length}</p>
        {historicalData.length > 0 && (
          <p>
            Last update: {new Date(
              historicalData[historicalData.length - 1]?.timestamp || 
              historicalData[historicalData.length - 1]?.datetime
            ).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}

export default CandlestickChart