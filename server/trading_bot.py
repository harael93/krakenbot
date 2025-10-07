import os
import time
import threading
import sqlite3
from datetime import datetime

import ccxt
import numpy as np
import pandas as pd
import logging
import traceback

from config import config

# === Strategy params (from user) ===
EMA_SHORT_PERIOD = 20
EMA_LONG_PERIOD = 50
EMA_WEIGHT = 1.0

RSI_PERIOD = 14
RSI_WEIGHT = 0.8
RSI_OVERSOLD = 30

BOLLINGER_PERIOD = 20
BOLLINGER_STD = 2
BOLLINGER_WEIGHT = 0.5

WEDGE_WEIGHT = 0.7
VOLUME_WEIGHT = 0.6

RESISTANCE_WEIGHT = -1.0
SCORE_THRESHOLD = 2.5
RESISTANCE_BUFFER_PERCENT = 0.002
BREAKOUT_VOLUME_MULTIPLIER = 2

FIRST_TP_PERCENT = 0.01
ATR_PERIOD = 14
ATR_MULTIPLIER = 1.5

# Trading / exchange config
SYMBOL = os.environ.get('TRADING_SYMBOL', config.DEFAULT_SYMBOL)
BUY_USD_AMOUNT = float(os.environ.get('BUY_USD_AMOUNT', '10'))

# Live trading guard: must be explicitly enabled
LIVE_TRADING = os.environ.get('LIVE_TRADING', 'false').lower() in ('1', 'true', 'yes')
KRAKEN_API_KEY = os.environ.get('KRAKEN_API_KEY')
KRAKEN_API_SECRET = os.environ.get('KRAKEN_API_SECRET')

exchange = None
if LIVE_TRADING and KRAKEN_API_KEY and KRAKEN_API_SECRET:
    exchange = ccxt.kraken({'apiKey': KRAKEN_API_KEY, 'secret': KRAKEN_API_SECRET})
else:
    # For data polling we use a public client (no keys)
    exchange = ccxt.kraken()

# === Database setup ===
DB_PATH = os.path.join(os.path.dirname(__file__), 'trades.db')
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
curs = conn.cursor()
curs.execute('''
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    amount REAL,
    entry_price REAL,
    tp REAL,
    sl REAL,
    result TEXT,
    open_time TEXT,
    close_time TEXT
)
''')
conn.commit()

logger = logging.getLogger('trading_bot')
logging.basicConfig(level=logging.INFO)

def log_trade(symbol, amount, entry_price, tp, sl, result='OPEN'):
    curs.execute('''INSERT INTO trades (symbol, amount, entry_price, tp, sl, result, open_time) VALUES (?, ?, ?, ?, ?, ?, ?)''', (
        symbol, amount, entry_price, tp, sl, result, datetime.utcnow().isoformat()
    ))
    conn.commit()
    return curs.lastrowid

def close_trade(trade_id, result):
    curs.execute('''UPDATE trades SET result=?, close_time=? WHERE id=?''', (result, datetime.utcnow().isoformat(), trade_id))
    conn.commit()


# === Indicator helpers ===
def calculate_ema(prices, period):
    return pd.Series(prices).ewm(span=period, adjust=False).mean().values

def calculate_rsi(prices, period=RSI_PERIOD):
    series = pd.Series(prices)
    delta = series.diff()
    up = delta.clip(lower=0).rolling(window=period).mean()
    down = -delta.clip(upper=0).rolling(window=period).mean()
    rs = up / down
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50).values

def calculate_bollinger(prices, period=BOLLINGER_PERIOD, std=BOLLINGER_STD):
    s = pd.Series(prices)
    ma = s.rolling(period).mean()
    sigma = s.rolling(period).std()
    upper = (ma + std * sigma).values
    lower = (ma - std * sigma).values
    return upper, lower

def calculate_atr(candles, period=ATR_PERIOD):
    # candles: list of [ts, open, high, low, close, ...]
    df = pd.DataFrame(candles, columns=['time','open','high','low','close','vwap','volume','count'][:len(candles[0])])
    # ensure numeric
    df['high'] = pd.to_numeric(df['high'])
    df['low'] = pd.to_numeric(df['low'])
    df['close'] = pd.to_numeric(df['close'])
    tr = pd.concat([
        df['high'] - df['low'],
        (df['high'] - df['close'].shift()).abs(),
        (df['low'] - df['close'].shift()).abs()
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean().iloc[-1]

def detect_wedge(candles):
    highs = [c[2] for c in candles[-10:]]
    lows = [c[3] for c in candles[-10:]]
    if max(highs) - min(highs) < (np.mean(highs) * 0.005) and max(lows) - min(lows) < (np.mean(lows) * 0.005):
        return True
    return False

def near_resistance(price, recent_high):
    return price >= recent_high * (1 - RESISTANCE_BUFFER_PERCENT)

def breakout(price, recent_high, volume, avg_volume):
    return price > recent_high and volume >= avg_volume * BREAKOUT_VOLUME_MULTIPLIER


# === Signal evaluation ===
def evaluate_buy_signal(candles):
    closes = [float(c[4]) for c in candles]
    highs = [float(c[2]) for c in candles]
    volumes = [float(c[6]) if len(c) > 6 else 0 for c in candles]
    current_price = closes[-1]
    recent_high = max(highs[-20:]) if len(highs) >= 20 else max(highs)
    avg_volume = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else float(np.mean(volumes))

    # resistance caveat
    if near_resistance(current_price, recent_high) and not breakout(current_price, recent_high, volumes[-1], avg_volume):
        return False

    score = 0.0
    ema_short = calculate_ema(closes, EMA_SHORT_PERIOD)
    ema_long = calculate_ema(closes, EMA_LONG_PERIOD)
    # slope check
    if len(ema_short) >= 2 and (ema_short[-1] - ema_short[-2]) > 0:
        score += EMA_WEIGHT

    rsi = calculate_rsi(closes, RSI_PERIOD)
    if rsi[-1] < RSI_OVERSOLD:
        score += RSI_WEIGHT

    upper, lower = calculate_bollinger(closes)
    if current_price <= float(lower[-1]):
        score += BOLLINGER_WEIGHT

    if detect_wedge(candles):
        score += WEDGE_WEIGHT

    if volumes[-1] > avg_volume:
        score += VOLUME_WEIGHT

    return score >= SCORE_THRESHOLD


# === Trading and monitoring ===
def place_buy_order(symbol, amount):
    if LIVE_TRADING and exchange and getattr(exchange, 'create_market_buy_order', None):
        logger.info('Placing live buy order %s %s', symbol, amount)
        return exchange.create_market_buy_order(symbol, amount)
    else:
        logger.info('DRY-RUN buy order %s %s', symbol, amount)
        return {'info': 'dry-run', 'symbol': symbol, 'amount': amount}

def place_sell_order(symbol, amount):
    if LIVE_TRADING and exchange and getattr(exchange, 'create_market_sell_order', None):
        logger.info('Placing live sell order %s %s', symbol, amount)
        return exchange.create_market_sell_order(symbol, amount)
    else:
        logger.info('DRY-RUN sell order %s %s', symbol, amount)
        return {'info': 'dry-run', 'symbol': symbol, 'amount': amount}

def monitor_trade(entry_price, amount, trade_id, candles_snapshot):
    remaining = amount
    tp_hit = False
    atr = calculate_atr(candles_snapshot)

    while remaining > 0:
        ticker = exchange.fetch_ticker(SYMBOL)
        price = float(ticker['last'])

        if not tp_hit and price >= entry_price * (1 + FIRST_TP_PERCENT):
            sell_amount = remaining / 2
            place_sell_order(SYMBOL, sell_amount)
            remaining -= sell_amount
            tp_hit = True
            print(f'First TP hit, sold {sell_amount} at {price}')
        elif tp_hit:
            trailing_stop = price - atr * ATR_MULTIPLIER
            if price < trailing_stop:
                place_sell_order(SYMBOL, remaining)
                profit_pct = (price - entry_price) / entry_price
                adjust_weights(profit_pct)
                close_trade(trade_id, 'CLOSED')
                break

        time.sleep(15)

    if remaining > 0:
        close_trade(trade_id, 'CLOSED')

def adjust_weights(profit_pct):
    global EMA_WEIGHT, RSI_WEIGHT, BOLLINGER_WEIGHT, WEDGE_WEIGHT, VOLUME_WEIGHT, ATR_MULTIPLIER
    factor = 1.01 if profit_pct > 0 else 0.99
    EMA_WEIGHT *= factor
    RSI_WEIGHT *= factor
    BOLLINGER_WEIGHT *= factor
    WEDGE_WEIGHT *= factor
    VOLUME_WEIGHT *= factor
    ATR_MULTIPLIER *= factor
    print(f'Weights updated: EMA {EMA_WEIGHT:.3f}, RSI {RSI_WEIGHT:.3f}, ATR {ATR_MULTIPLIER:.3f}')


# === Polling loop (fetch ohlcv and evaluate) ===
def run_polling_loop(symbol=SYMBOL, timeframe='1m'):
    logger.info('Starting polling loop for %s %s LIVE_TRADING=%s', symbol, timeframe, LIVE_TRADING)
    local_candles = []
    error_backoff = 1
    max_backoff = 300
    while True:
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=100)
            # CCXT returns [ts, open, high, low, close, volume]
            local_candles = [list(map(float, [c[0], c[1], c[2], c[3], c[4], c[5] if len(c) > 5 else 0])) for c in ohlcv]
            if len(local_candles) >= BOLLINGER_PERIOD:
                if evaluate_buy_signal(local_candles):
                    entry_price = float(local_candles[-1][4])
                    amount = BUY_USD_AMOUNT / entry_price
                    trade_id = log_trade(symbol, amount, entry_price, None, None)
                    logger.info('BUY signal: placing order for %s %s at %s', amount, symbol, entry_price)
                    place_buy_order(symbol, amount)
                    # start monitor thread
                    t = threading.Thread(target=monitor_trade, args=(entry_price, amount, trade_id, local_candles.copy()))
                    t.daemon = True
                    t.start()
            # success -> reset backoff
            error_backoff = 1
        except KeyboardInterrupt:
            logger.info('Polling loop interrupted by user')
            break
        except Exception as e:
            # Log full traceback for diagnosis
            logger.error('Error in polling loop: %s', repr(e))
            logger.debug(traceback.format_exc())
            # Exponential backoff for transient errors
            logger.info('Backing off for %s seconds', error_backoff)
            time.sleep(error_backoff)
            error_backoff = min(max_backoff, error_backoff * 2)
            continue

        # Normal poll sleep
        time.sleep(30)


if __name__ == '__main__':
    run_polling_loop()
