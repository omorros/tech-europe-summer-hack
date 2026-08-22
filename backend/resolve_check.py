import sys
sys.path.insert(0, ".")
from dotenv import load_dotenv
load_dotenv(".env")
from call.orchestrator import resolve_address

heard = "It's 22 Kellett Road in Brixton, SW21EB. The kitchen's on fire and my mum's in the back bedroom. She can't get out."
import intelligence.extractor as ex
E = [getattr(ex, n) for n in dir(ex) if isinstance(getattr(ex, n), type) and hasattr(getattr(ex, n), "extract")][-1]
ents = E().extract(heard)
print("entities:", [(t, v) for t, v, _ in ents])
addr = next((v for t, v, _ in ents if t == "ADDRESS"), None)
print("ADDRESS extracted:", repr(addr))
print("resolve_address ->", repr(resolve_address(addr)))
for probe in ["22 Kellett Road SW2 1EB", "22 Kellett Road", "22 Kellett Road SW21EB"]:
    print(f"  resolve({probe!r}) -> {resolve_address(probe)!r}")
