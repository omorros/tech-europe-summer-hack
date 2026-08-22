import sys
sys.path.insert(0, ".")
from dotenv import load_dotenv
load_dotenv(".env")
from building.golden import slugify, load_cached
from call.orchestrator import resolve_address

for spoken in ["22 Kellett Road SW21EB", "22 Kellett Road SW2 1EB", "22 Kellett Road",
               "14 Deerdale Road SE24 0AW", "14 Deerdale Road"]:
    resolved = resolve_address(spoken)
    hit = load_cached(resolved, "approach") is not None
    print(f"{'CACHE HIT ' if hit else 'CACHE MISS'}  said {spoken!r}\n            -> {resolved!r}\n            -> slug {slugify(resolved)!r}")
