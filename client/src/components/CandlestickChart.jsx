import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE, WS_BASE } from '../api'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  LineController,
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
  PointElement,
  LineElement,
  LineController,
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
  const [baseChartData, setBaseChartData] = useState(null)
  const [botTrades, setBotTrades] = useState([])

  // Indicator toggles
  const [rsiEnabled, setRsiEnabled] = useState(false)
  const [emaEnabled, setEmaEnabled] = useState(false)
  const [bbEnabled, setBbEnabled] = useState(false)
  const wsRef = useRef(null)

  // Fetch initial historical data
  const fetchHistoricalData = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/ohlcv/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}?timeframe=${encodeURIComponent(timeframe)}&limit=100`)
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

  const wsUrl = `${WS_BASE}/ws/ohlcv/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}`
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

    // keep base chart data separate so we can add/remove indicators without recalculating bars
    setBaseChartData({ labels, datasets })
  }

  // Compute indicators and merge into chartData whenever historicalData or toggles change
  useEffect(() => {
    if (!baseChartData || !historicalData || historicalData.length === 0) return

    const closes = historicalData.map(c => Number(c.close))
    const times = baseChartData.labels

    const extraDatasets = []

    // EMA helper
    const ema = (values, period) => {
      const k = 2 / (period + 1)
      const out = []
      let prev = null
      for (let i = 0; i < values.length; i++) {
        const v = values[i]
        if (i === period - 1) {
          const sum = values.slice(0, period).reduce((a, b) => a + b, 0)
          prev = sum / period
          out[i] = prev
        } else if (i >= period) {
          prev = v * k + prev * (1 - k)
          out[i] = prev
        } else {
          out[i] = null
        }
      }
      return out
    }

    // RSI helper (Wilder)
    const rsi = (values, period = 14) => {
      const out = []
      let gains = 0, losses = 0
      for (let i = 1; i < values.length; i++) {
        const change = values[i] - values[i - 1]
        if (i <= period) {
          if (change > 0) gains += change
          else losses += Math.abs(change)
          if (i === period) {
            let avgGain = gains / period
            let avgLoss = losses / period
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
            out[i] = 100 - 100 / (1 + rs)
            var prevAvgGain = avgGain
            var prevAvgLoss = avgLoss
          }
        } else {
          const gain = Math.max(0, change)
          const loss = Math.max(0, -change)
          prevAvgGain = (prevAvgGain * (period - 1) + gain) / period
          prevAvgLoss = (prevAvgLoss * (period - 1) + loss) / period
          const rs = prevAvgLoss === 0 ? 100 : prevAvgGain / prevAvgLoss
          out[i] = 100 - 100 / (1 + rs)
        }
      }
      return out
    }

    // Bollinger Bands helper (SMA + stddev)
    const sma = (values, period) => {
      const out = []
      for (let i = 0; i < values.length; i++) {
        if (i >= period - 1) {
          const slice = values.slice(i - period + 1, i + 1)
          const mean = slice.reduce((a, b) => a + b, 0) / period
          out[i] = mean
        } else {
          out[i] = null
        }
      }
      return out
    }

    if (emaEnabled) {
      const fast = ema(closes, 12)
      const slow = ema(closes, 26)
      extraDatasets.push({
        label: 'EMA 12',
        type: 'line',
        data: fast.map((v, i) => ({ x: times[i], y: v })),
        borderColor: 'rgba(255,165,0,0.95)',
        borderWidth: 2,
        backgroundColor: 'transparent',
        tension: 0.15,
        pointRadius: 0,
        fill: false,
        spanGaps: true
      })
      extraDatasets.push({
        label: 'EMA 26',
        type: 'line',
        data: slow.map((v, i) => ({ x: times[i], y: v })),
        borderColor: 'rgba(54,162,235,0.95)',
        borderWidth: 2,
        backgroundColor: 'transparent',
        tension: 0.15,
        pointRadius: 0,
        fill: false,
        spanGaps: true
      })
    }

    if (bbEnabled) {
      const period = 20
      const middle = sma(closes, period)
      const upper = []
      const lower = []
      for (let i = 0; i < closes.length; i++) {
        if (i >= period - 1 && middle[i] != null) {
          const slice = closes.slice(i - period + 1, i + 1)
          const mean = middle[i]
          const variance = slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / period
          const sd = Math.sqrt(variance)
          upper[i] = mean + 2 * sd
          lower[i] = mean - 2 * sd
        } else {
          upper[i] = null
          lower[i] = null
        }
      }

      extraDatasets.push({
        label: 'BB Upper',
        type: 'line',
        data: upper.map((v, i) => ({ x: times[i], y: v })),
        borderColor: 'rgba(153,102,255,0.6)',
        borderDash: [4, 4],
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        spanGaps: true
      })
      extraDatasets.push({
        label: 'BB Middle',
        type: 'line',
        data: middle.map((v, i) => ({ x: times[i], y: v })),
        borderColor: 'rgba(153,102,255,0.9)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        spanGaps: true
      })
      extraDatasets.push({
        label: 'BB Lower',
        type: 'line',
        data: lower.map((v, i) => ({ x: times[i], y: v })),
        borderColor: 'rgba(153,102,255,0.6)',
        borderDash: [4, 4],
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        spanGaps: true
      })
    }

    if (rsiEnabled) {
      const rr = rsi(closes, 14)
      extraDatasets.push({
        label: 'RSI (14)',
        type: 'line',
        data: rr.map((v, i) => ({ x: times[i], y: v })),
        borderColor: 'rgba(255,99,132,0.95)',
        borderWidth: 1.5,
        backgroundColor: 'transparent',
        tension: 0.2,
        pointRadius: 0,
        fill: false,
        yAxisID: 'rsi',
        spanGaps: true
      })
    }

    // Merge base + indicators
    let merged = { labels: baseChartData.labels, datasets: [...baseChartData.datasets, ...extraDatasets] }

    // Add trade markers (entry / tp / sl) as scatter/point datasets
    if (botTrades && botTrades.length > 0) {
      const entries = botTrades.filter(t => t.symbol === symbol && t.entry_price).map(t => ({ x: new Date(t.open_time), y: Number(t.entry_price) }))
      const tps = botTrades.filter(t => t.symbol === symbol && t.tp).map(t => ({ x: new Date(t.open_time), y: Number(t.tp) }))
      const sls = botTrades.filter(t => t.symbol === symbol && t.sl).map(t => ({ x: new Date(t.open_time), y: Number(t.sl) }))

      if (entries.length) merged.datasets.push({ label: 'Entries', type: 'scatter', data: entries, pointBackgroundColor: 'green', pointRadius: 6 })
      if (tps.length) merged.datasets.push({ label: 'TakeProfits', type: 'scatter', data: tps, pointBackgroundColor: 'blue', pointRadius: 6 })
      if (sls.length) merged.datasets.push({ label: 'StopLosses', type: 'scatter', data: sls, pointBackgroundColor: 'red', pointRadius: 6 })
    }

    setChartData(merged)
  }, [baseChartData, historicalData, rsiEnabled, emaEnabled, bbEnabled, botTrades, symbol])

  // Poll bot trades periodically
  useEffect(() => {
    let mounted = true
    const loadTrades = async () => {
      try {
        const res = await fetch(`${API_BASE}/bot/trades`)
        if (!res.ok) return
        const j = await res.json()
        if (mounted) setBotTrades(j.trades || [])
      } catch (err) {
        console.error('Error loading bot trades', err)
      }
    }
    loadTrades()
    const id = setInterval(loadTrades, 15000)
    return () => { mounted = false; clearInterval(id) }
  }, [symbol])

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
      },
      rsi: {
        type: 'linear',
        position: 'right',
        suggestedMin: 0,
        suggestedMax: 100,
        display: true,
        grid: { drawOnChartArea: false }
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
      {/* Indicator toggles */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', margin: '0.5rem 0' }}>
        <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input type="checkbox" checked={rsiEnabled} onChange={(e) => setRsiEnabled(e.target.checked)} />
          RSI
        </label>
        <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input type="checkbox" checked={emaEnabled} onChange={(e) => setEmaEnabled(e.target.checked)} />
          EMA(12/26)
        </label>
        <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input type="checkbox" checked={bbEnabled} onChange={(e) => setBbEnabled(e.target.checked)} />
          Bollinger Bands
        </label>
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