"""Reproduces the log's failure: one sentence split across two chunks."""
import asyncio, json, time, urllib.request

async def main():
    ws_msgs = []
    import websockets
    async with websockets.connect("ws://localhost:8000/ws/phone") as ws:
        await ws.send(json.dumps({"type": "call.start"}))
        await asyncio.sleep(0.5)
        # exactly how 4s chunks split it in the log
        for seq, chunk in enumerate([
            "we're at 22 Kellett Road in Brixton,",
            "London SW2 1EB.",
            "the kitchen's on fire and my mum's in the back bedroom",
        ]):
            await ws.send(json.dumps({"type": "transcript", "seq": seq,
                                      "text": chunk, "is_final": True}))
            print(f"  chunk {seq}: {chunk!r}")
            await asyncio.sleep(2.5)
        await asyncio.sleep(4)
    with urllib.request.urlopen("http://localhost:8000/health", timeout=10) as r:
        h = json.loads(r.read())
    print("\nresolved address ->", repr(h["address"]))

asyncio.run(main())
