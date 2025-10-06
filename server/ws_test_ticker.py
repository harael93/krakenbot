import asyncio
import websockets

async def run():
    uri = 'ws://localhost:8000/ws/ticker/kraken/XBT/USD'
    print('Connecting to', uri)
    try:
        async with websockets.connect(uri) as ws:
            print('Connected. Waiting for messages...')
            while True:
                msg = await ws.recv()
                print('MSG:', msg)
    except Exception as e:
        print('Error:', e)

if __name__ == '__main__':
    asyncio.run(run())