import asyncio, os, sys, json, urllib.request
sys.path.insert(0, ".")
from dotenv import load_dotenv
load_dotenv(".env")

LINE = ("It's 22 Kellett Road in Brixton, S W 2 1 E B. "
        "The kitchen's on fire and my mum's in the back bedroom, she can't get out.")

async def main():
    from openai import AsyncOpenAI
    oai = AsyncOpenAI(timeout=60.0)
    print("1. synthesising the caller's voice with OpenAI TTS ...")
    speech = await oai.audio.speech.create(model="gpt-4o-mini-tts", voice="alloy",
                                           input=LINE, response_format="mp3")
    audio = speech.read() if hasattr(speech, "read") else speech.content
    print(f"   {len(audio)} bytes of mp3")

    print("2. POSTing it to /transcribe exactly as the handset does ...")
    req = urllib.request.Request(
        "http://localhost:8000/transcribe?seq=0&mime=audio%2Fmpeg",
        data=audio, method="POST", headers={"content-type": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=90) as r:
        body = json.loads(r.read())
        print(f"   HTTP {r.status} -> {body}")

    print("3. what the backend believes after the lanes run ...")
    await asyncio.sleep(8)
    with urllib.request.urlopen("http://localhost:8000/health", timeout=10) as r:
        print("   ", json.loads(r.read()))

asyncio.run(main())
