"""
Configuration settings for KrakenBot API
"""

import os
from typing import Dict, Any

class Config:
    # Server settings
    HOST = "0.0.0.0"
    PORT = 8080
    DEBUG = True
    
    # CORS settings
    ALLOWED_ORIGINS = [
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Create React App dev server
        "http://localhost:8080",
        'https://krakenbot.pages.dev',  # production frontend URL
        'https://krakenbot.deployedlogic.site',  # additional production host
        'http://localhost:8082' # backend host for testing
    ]
    
    
    # Default exchange settings
    DEFAULT_EXCHANGE = "binance"
    DEFAULT_SYMBOL = "ADA/USD"
    DEFAULT_TIMEFRAME = "5m"
    
    # Rate limiting
    ENABLE_RATE_LIMIT = True
    
    # Supported exchanges
    SUPPORTED_EXCHANGES = {
        "binance": {
            "name": "Binance",
            "has_websockets": True,
            "sandbox": False
        },
        "kraken": {
            "name": "Kraken",
            "has_websockets": True,
            "sandbox": False
        },
        "coinbase": {
            "name": "Coinbase Pro",
            "has_websockets": True,
            "sandbox": False
        }
    }
    
    # Supported timeframes
    SUPPORTED_TIMEFRAMES = [
        "1m", "3m", "5m", "15m", "30m",
        "1h", "2h", "4h", "6h", "8h", "12h",
        "1d", "3d", "1w", "1M"
    ]

config = Config()