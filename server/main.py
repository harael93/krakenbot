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
    """Get or create a Kraken exchange instance. This API supports Kraken only."""
    if exchange_name.lower() != 'kraken':
        raise HTTPException(status_code=400, detail="Only 'kraken' exchange is supported by this server")

    key = 'kraken'
    if key not in exchange_instances:
        try:
            exchange_instances[key] = ccxt.kraken({
                'sandbox': False,
                'enableRateLimit': True,
            })
            logger.info("Created Kraken exchange instance")
        except Exception as e:
            logger.error(f"Error creating Kraken exchange instance: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to create Kraken exchange instance: {e}")

    return exchange_instances[key]


def resolve_symbol_for_exchange(exchange, symbol: str) -> str:
    """Try to resolve a user-provided symbol into an exchange-supported symbol.

    Tries exact match first, then common aliases (BTC<->XBT, USD<->USDT),
    and finally searches markets by base/quote.
    """
    try:
        # Ensure markets are loaded
        if hasattr(exchange, 'load_markets'):
            try:
                exchange.load_markets()
            except Exception:
                # ignore load errors, we'll still try to resolve
                pass

        symbols = []
        if hasattr(exchange, 'symbols') and exchange.symbols:
            symbols = exchange.symbols
        elif hasattr(exchange, 'markets') and exchange.markets:
            symbols = list(exchange.markets.keys())

        # Normalize
        candidate = symbol.strip()
        if candidate in symbols:
            return candidate

        # Basic variations
        candidate_upper = candidate.upper()
        if candidate_upper in symbols:
            return candidate_upper

        # If pair-like, try swaps
        if '/' in candidate:
            base, quote = candidate.split('/', 1)
            base = base.strip()
            quote = quote.strip()

            # Base aliases - do not auto-convert BTC <-> XBT; only use the provided base
            base_aliases = [base]
            quote_aliases = [quote]
            if quote.upper() in ('USD', 'USDT', 'USDC'):
                quote_aliases = ['USD', 'USDT', 'USDC']

            # Try combinations
            for b in base_aliases:
                for q in quote_aliases:
                    cand = f"{b}/{q}"
                    if cand in symbols:
                        return cand
                    if cand.upper() in symbols:
                        return cand.upper()

            # Some exchanges use alternate separators or IDs; search markets by base/quote fields
            try:
                for sym, m in (exchange.markets or {}).items():
                    if not m:
                        continue
                    mb = (m.get('base') or '').upper()
                    mq = (m.get('quote') or '').upper()
                    if mb == base.upper() and mq == quote.upper():
                        return sym
                    # allow alias matches
                    if mb in [b.upper() for b in base_aliases] and mq in [q.upper() for q in quote_aliases]:
                        return sym
            except Exception:
                pass

        # Last resort: try to find any market that contains the base or quote
        try:
            if '/' in candidate:
                base, quote = candidate.split('/', 1)
                for sym, m in (exchange.markets or {}).items():
                    if not m:
                        continue
                    if base.upper() == (m.get('base') or '').upper() or base.upper() == (m.get('symbol') or '').upper():
                        return sym
        except Exception:
            pass

    except Exception:
        pass

    # If nothing found, return original symbol and let the caller handle the not-found error
    return symbol

@app.get("/")
async def root():
    return {"message": "KrakenBot API is running", "version": "1.0.0"}

@app.get("/exchanges")
async def get_available_exchanges():
    """Get list of available exchanges"""
    # Kraken-only for this server
    available_exchanges = [
        {"id": "kraken", "name": "Kraken"},
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

@app.get("/ohlcv/{exchange_name}/{symbol:path}")
async def get_ohlcv_data(
    exchange_name: str, 
    symbol: str, 
    timeframe: str = "1h", 
    limit: int = 100
):
    """Get OHLCV (candlestick) data for a trading pair"""
    try:
        exchange = get_exchange_instance(exchange_name)
        
        # Resolve symbol to an exchange-supported symbol
        resolved = resolve_symbol_for_exchange(exchange, symbol)
        if resolved != symbol:
            logger.debug(f"Resolved symbol {symbol} -> {resolved}")

        # Fetch OHLCV data
        ohlcv = exchange.fetch_ohlcv(resolved, timeframe, limit=limit)
        
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

@app.websocket("/ws/ticker/{exchange_name}/{symbol:path}")
async def websocket_ticker(websocket: WebSocket, exchange_name: str, symbol: str):
    """WebSocket endpoint for real-time ticker data"""
    room = f"ticker_{exchange_name}_{symbol}"
    await manager.connect(websocket, room)
    
    try:
        exchange = get_exchange_instance(exchange_name)
        
        # Start ticker polling (since we're using regular CCXT, not Pro)
        while True:
            try:
                resolved = resolve_symbol_for_exchange(exchange, symbol)
                if resolved != symbol:
                    logger.debug(f"Resolved symbol {symbol} -> {resolved}")
                ticker = exchange.fetch_ticker(resolved)
                
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

                # Log the outgoing payload for debugging
                try:
                    logger.debug(f"Outgoing ticker_data: {json.dumps(ticker_data)}")
                except Exception:
                    logger.debug(f"Outgoing ticker_data (repr): {repr(ticker_data)}")

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

@app.websocket("/ws/ohlcv/{exchange_name}/{symbol:path}/{timeframe}")
async def websocket_ohlcv(websocket: WebSocket, exchange_name: str, symbol: str, timeframe: str):
    """WebSocket endpoint for real-time OHLCV (candlestick) data"""
    room = f"ohlcv_{exchange_name}_{symbol}_{timeframe}"
    await manager.connect(websocket, room)
    
    try:
        exchange = get_exchange_instance(exchange_name)
        
        # Send initial data
        try:
            resolved_initial = resolve_symbol_for_exchange(exchange, symbol)
            initial_ohlcv = exchange.fetch_ohlcv(resolved_initial, timeframe, limit=100)
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
            
            # Log and send initial OHLCV
            try:
                logger.debug(f"Sending initial OHLCV length={len(formatted_initial)} for {symbol}")
            except Exception:
                logger.debug("Sending initial OHLCV (could not stringify)")

            await manager.send_personal_message(json.dumps(initial_data), websocket)
        except Exception as e:
            logger.error(f"Error sending initial OHLCV data: {e}")
        
        # Start OHLCV polling (since we're using regular CCXT, not Pro)
        last_candle_timestamp = None
        while True:
            try:
                resolved = resolve_symbol_for_exchange(exchange, symbol)
                if resolved != symbol:
                    logger.debug(f"Resolved symbol {symbol} -> {resolved}")
                ohlcv = exchange.fetch_ohlcv(resolved, timeframe, limit=2)
                
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
                        try:
                            logger.debug(f"Broadcasting OHLCV update: {json.dumps(candle_data)}")
                        except Exception:
                            logger.debug(f"Broadcasting OHLCV update (repr): {repr(candle_data)}")

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