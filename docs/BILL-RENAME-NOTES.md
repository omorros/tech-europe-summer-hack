# Rename: SizeUp → Lantern — the part I did not touch

The product is now **Lantern**. I renamed every surface, document and frontend
identifier, but stopped at your lane because `SizeUp` is load-bearing there, not
cosmetic. Renaming any of the below redeploys the Worker to a different URL or
breaks an env var that is already set on your machine and in CI. Your call, and
it is safe to leave all of it as-is for the submission — nothing user-facing
carries these strings.

## Would break the deployed Worker

| Where | Value | What breaks |
|---|---|---|
| `worker/wrangler.toml:1` | `name = "sizeup-walkthrough"` | changing it deploys to a **new** `*.workers.dev` URL |
| `worker/wrangler.toml:18` | `PUBLIC_URL = "https://sizeup-walkthrough.bill-…"` | fal webhooks route here; must match the deployed name |
| `worker/wrangler.toml:12` | KV binding `SIZEUP_JOBS` | rebinding needs the namespace re-created or re-bound |
| `worker/package.json` | `"sizeup-walkthrough-worker"` | harmless on its own, only matters for consistency |

## Env vars set on your machine and in CI

`SIZEUP_WORKER_URL`, `SIZEUP_WORKER_TOKEN`, `SIZEUP_BRIEFING_LLM`,
`SIZEUP_BRIEFING_VIDEO`, `SIZEUP_BUBBLE_MODE`, `SIZEUP_AVATAR_ID`,
`SIZEUP_AVATAR_URL`, `SIZEUP_FAL_RESOLUTION`, `SIZEUP_TTS_VOICE`,
`SIZEUP_FAL_BUDGET_USD` — declared in `backend/.env.example`, read across
`backend/intelligence/*.py`.

Renaming means editing your local `.env`, any GitHub secret, and every reader
at once. Cheap after the hackathon, not worth the risk today.

## Yours to reword whenever

`frontend-integration.md` and `bill_worklog.md` both say SizeUp in prose. I left
them alone because they are your documents.

## What I did rename

All four PRDs (and `sizeup-final-prd.md` → `lantern-final-prd.md`), `../PRODUCT.md`,
`../DESIGN.md`, `../frontend/README.md`, `test-properties.md`, every string in
`frontend/`, and the BroadcastChannel name in `frontend/lib/bus.ts`.

The name rationale was rewritten rather than substituted — the old line explained
what "size-up" means, which no longer explains the name. **"size-up" stays in the
vocabulary** as the fire-service term for what the product delivers; it is just
not the product's name any more.
