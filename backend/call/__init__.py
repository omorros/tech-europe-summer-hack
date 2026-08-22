"""Transport + wiring: HTTP, WebSockets, and the incident orchestrator.

Deliberately empty of imports. `python -m call.selftest` loads this package
before it loads the test module, so re-exporting the orchestrator here would
pull in `intelligence.config` — and with it `backend/.env` — before the test
has had a chance to blank the credentials. That is how a keys-free smoke test
quietly starts paying fal for a walkthrough render.

Import the submodule instead: `from call.orchestrator import orchestrator`.
"""
