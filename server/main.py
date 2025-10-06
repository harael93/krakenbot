"""
FastAPI server for cryptocurrency market data using CCXT Pro
Provides WebSocket endpoints for real-time market data and candlestick charts
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import ccxt
import asyncio
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="KrakenBot API",
    description="Cryptocurrency market data API using CCXT Pro",
    version="1.0.0"
)

# Enable CORS for the React client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables to manage connections and exchanges
active_connections: Dict[str, List[WebSocket]] = {}
exchange_instances: Dict[str, ccxt.Exchange] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, room: str):
        await websocket.accept()
        if room not in self.active_connections:
            self.active_connections[room] = []
        self.active_connections[room].append(websocket)
        logger.info(f"Client connected to room: {room}")
    
    def disconnect(self, websocket: WebSocket, room: str):
        if room in self.active_connections:
            self.active_connections[room].remove(websocket)
        logger.info(f"Client disconnected from room: {room}")
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)
    
    async def broadcast_to_room(self, message: str, room: str):
        if room in self.active_connections:
            for connection in self.active_connections[room]:
                try:
                    await connection.send_text(message)
                except:
                    # Remove broken connections
                    self.active_connections[room].remove(connection)

manager = ConnectionManager()

def get_exchange_instance(exchange_name: str):
    """Get or create an exchange instance"""
    if exchange_name not in exchange_instances:
        try:
            if exchange_name.lower() == 'binance':
                exchange_instances[exchange_name] = ccxt.binance({
                    'sandbox': False,
                    'enableRateLimit': True,
                })
            elif exchange_name.lower() == 'kraken':
                exchange_instances[exchange_name] = ccxt.kraken({
                    'sandbox': False,
                    'enableRateLimit': True,
                })
            elif exchange_name.lower() == 'coinbase':
                exchange_instances[exchange_name] = ccxt.coinbasepro({
                    'sandbox': False,
                    'enableRateLimit': True,
                })
            else:
                # Default to binance if unknown exchange
                exchange_instances[exchange_name] = ccxt.binance({
                    'sandbox': False,
                    'enableRateLimit': True,
                })
            logger.info(f"Created new exchange instance: {exchange_name}")
        except Exception as e:
            logger.error(f"Error creating exchange instance {exchange_name}: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to create exchange instance: {e}")
    
    return exchange_instances[exchange_name]

@app.get("/")
async def root():
    return {"message": "KrakenBot API is running", "version": "1.0.0"}

@app.get("/exchanges")
async def get_available_exchanges():
    """Get list of available exchanges"""
    available_exchanges = [
        {"id": "binance", "name": "Binance"},
        {"id": "kraken", "name": "Kraken"},
        {"id": "coinbase", "name": "Coinbase Pro"},
    ]
    return {"exchanges": available_exchanges}

@app.get("/markets/{exchange_name}")
async def get_markets(exchange_name: str):
    """Get available trading pairs for an exchange"""
    try:
        exchange = get_exchange_instance(exchange_name)
        markets = exchange.load_markets()
        
        # Format markets for easier consumption
        formatted_markets = []
        for symbol, market in markets.items():
            if market.get('active', True) and market.get('spot', True):  # Only active spot markets
                formatted_markets.append({
                    "symbol": symbol,
                    "base": market.get('base', ''),
                    "quote": market.get('quote', ''),
                    "active": market.get('active', True)
                })
        
        return {"exchange": exchange_name, "markets": formatted_markets[:100]}  # Limit to first 100
    except Exception as e:
        logger.error(f"Error fetching markets for {exchange_name}: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/ohlcv/{exchange_name}/{symbol}")
async def get_ohlcv_data(
    exchange_name: str, 
    symbol: str, 
    timeframe: str = "1h", 
    limit: int = 100
):
    """Get OHLCV (candlestick) data for a trading pair"""
    try:
        exchange = get_exchange_instance(exchange_name)
        
        # Fetch OHLCV data
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
        
        # Format data
        formatted_data = []
        for candle in ohlcv:
            formatted_data.append({
                "timestamp": candle[0],
                "datetime": datetime.fromtimestamp(candle[0] / 1000).isoformat(),
                "open": candle[1],
                "high": candle[2],
                "low": candle[3],
                "close": candle[4],
                "volume": candle[5]
            })
        
        return {
            "exchange": exchange_name,
            "symbol": symbol,
            "timeframe": timeframe,
            "data": formatted_data
        }
    except Exception as e:
        logger.error(f"Error fetching OHLCV data: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.websocket("/ws/ticker/{exchange_name}/{symbol}")
async def websocket_ticker(websocket: WebSocket, exchange_name: str, symbol: str):
    """WebSocket endpoint for real-time ticker data"""
    room = f"ticker_{exchange_name}_{symbol}"
    await manager.connect(websocket, room)
    
    try:
        exchange = get_exchange_instance(exchange_name)
        
        # Start ticker polling (since we're using regular CCXT, not Pro)
        while True:
            try:
                ticker = exchange.fetch_ticker(symbol)
                
                ticker_data = {
                    "type": "ticker",
                    "exchange": exchange_name,
                    "symbol": symbol,
                    "timestamp": ticker.get('timestamp'),
                    "datetime": ticker.get('datetime'),
                    "bid": ticker.get('bid'),
                    "ask": ticker.get('ask'),
                    "last": ticker.get('last'),
                    "change": ticker.get('change'),
                    "percentage": ticker.get('percentage'),
                    "high": ticker.get('high'),
                    "low": ticker.get('low'),
                    "volume": ticker.get('baseVolume')
                }
                
                await manager.broadcast_to_room(json.dumps(ticker_data), room)
                
                # Poll every 2 seconds
                await asyncio.sleep(2)
                
            except Exception as e:
                logger.error(f"Error in ticker stream: {e}")
                await asyncio.sleep(5)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
        logger.info(f"WebSocket disconnected from ticker stream: {symbol}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, room)

@app.websocket("/ws/ohlcv/{exchange_name}/{symbol}/{timeframe}")
async def websocket_ohlcv(websocket: WebSocket, exchange_name: str, symbol: str, timeframe: str):
    """WebSocket endpoint for real-time OHLCV (candlestick) data"""
    room = f"ohlcv_{exchange_name}_{symbol}_{timeframe}"
    await manager.connect(websocket, room)
    
    try:
        exchange = get_exchange_instance(exchange_name)
        
        # Send initial data
        try:
            initial_ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=100)
            formatted_initial = []
            for candle in initial_ohlcv:
                formatted_initial.append({
                    "timestamp": candle[0],
                    "datetime": datetime.fromtimestamp(candle[0] / 1000).isoformat(),
                    "open": candle[1],
                    "high": candle[2],
                    "low": candle[3],
                    "close": candle[4],
                    "volume": candle[5]
                })
            
            initial_data = {
                "type": "initial_ohlcv",
                "exchange": exchange_name,
                "symbol": symbol,
                "timeframe": timeframe,
                "data": formatted_initial
            }
            
            await manager.send_personal_message(json.dumps(initial_data), websocket)
        except Exception as e:
            logger.error(f"Error sending initial OHLCV data: {e}")
        
        # Start OHLCV polling (since we're using regular CCXT, not Pro)
        last_candle_timestamp = None
        while True:
            try:
                ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=2)
                
                if ohlcv and len(ohlcv) > 0:
                    latest_candle = ohlcv[-1]  # Get the most recent candle
                    
                    # Only send update if this is a new or updated candle
                    if last_candle_timestamp != latest_candle[0]:
                        candle_data = {
                            "type": "ohlcv_update",
                            "exchange": exchange_name,
                            "symbol": symbol,
                            "timeframe": timeframe,
                            "timestamp": latest_candle[0],
                            "datetime": datetime.fromtimestamp(latest_candle[0] / 1000).isoformat(),
                            "open": latest_candle[1],
                            "high": latest_candle[2],
                            "low": latest_candle[3],
                            "close": latest_candle[4],
                            "volume": latest_candle[5]
                        }
                        
                        await manager.broadcast_to_room(json.dumps(candle_data), room)
                        last_candle_timestamp = latest_candle[0]
                
                # Poll every 30 seconds for OHLCV updates
                await asyncio.sleep(30)
                
            except Exception as e:
                logger.error(f"Error in OHLCV stream: {e}")
                await asyncio.sleep(10)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
        logger.info(f"WebSocket disconnected from OHLCV stream: {symbol}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, room)

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up exchange connections on shutdown"""
    for exchange_name, exchange in exchange_instances.items():
        try:
            if hasattr(exchange, 'close'):
                if asyncio.iscoroutinefunction(exchange.close):
                    await exchange.close()
                else:
                    exchange.close()
            logger.info(f"Closed exchange connection: {exchange_name}")
        except Exception as e:
            logger.error(f"Error closing exchange {exchange_name}: {e}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )