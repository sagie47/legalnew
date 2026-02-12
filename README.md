<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# RCIC Case Law Assistant

Vite + React frontend with an Express backend for grounded legal chat responses.

## Run Locally

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and configure required values.
3. Start backend API:
   `npm run dev:server`
4. Start frontend:
   `npm run dev`

Frontend runs on `http://localhost:3000` and proxies `/api` to backend `http://localhost:3001`.

## SQL History

Set `DATABASE_URL` for SQL-backed sessions/messages history.

When enabled, the API persists:
- chat sessions (`sessions`)
- messages + citations (`messages`)
- external identity mapping (`users`)

For local auth-bypass mode, history is keyed by `DEV_EXTERNAL_AUTH_ID`.

## A2AJ REST + Router

This app now uses deterministic A2AJ REST retrieval plus an LLM intent router (no Groq Remote MCP tools).

Core flow:
- Pinecone grounding (`P#`)
- Optional A2AJ case-law retrieval (`C#`)
- Groq final answer generation with grounded sources only

Required server env:
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `ROUTER_MODEL`
- `A2AJ_API_BASE`

Optional:
- `A2AJ_API_KEY`
- `A2AJ_TIMEOUT_MS`
- `A2AJ_TOP_K`
- `A2AJ_FETCH_DETAILS_TOP_K` (fetch full-text details for top N case hits; default `2`)
- `A2AJ_DECISION_SNIPPET_CHARS` (max chars for decision excerpt injected into prompt; default `1600`)
- `A2AJ_DECISIONS_SEARCH_PATH` (force a specific endpoint path if needed)
- `A2AJ_DECISIONS_SEARCH_METHOD` (`GET` or `POST`, default `GET`)
- `A2AJ_ENABLED`
- `A2AJ_CASELAW_ENABLED`
- `A2AJ_LEGISLATION_ENABLED`
- `DEBUG_MODE`
- `PROMPT_INJECTION_BLOCK_ENABLED` (default `true`; blocks obvious non-RCIC jailbreak attempts and sanitizes override lines)

Deprecated (no longer used for A2AJ retrieval):
- `MCP_BASE_URL*`
- `MCP_SERVER_LABEL*`
- `MCP_API_KEY`

## Auth Configuration (Neon Auth)

Set `VITE_NEON_AUTH_URL` in `.env` to your Neon Auth base URL exactly as shown in Neon.

Example:
`VITE_NEON_AUTH_URL=https://ep-xxx.neonauth.c-2.us-east-2.aws.neon.build/dbname/auth`

For social sign-in, also set:
`VITE_NEON_AUTH_CALLBACK_URL=http://localhost:3000`

This callback URL must be present in Neon Auth allowed callback/origin URLs (exact match, including protocol and host).

The login screen uses:
- `POST /sign-in/email`
- `POST /sign-up/email`
- `POST /sign-in/social`
- `GET /get-session`
- `POST /sign-out`

## PDI Ingestion

Ingest IRCC PDI pages into Pinecone:

- `POST /api/ingest/pdi`
- accepts `url` or `urls[]`, optional `namespace`, optional `dryRun`
- in dry-run mode, returns extraction/chunk stats without embedding or upsert
- chunk tuning env:
  - `PDI_CHUNK_MAX_CHARS` (default `3200`)
  - `PDI_CHUNK_MIN_CHARS` (default `800`, merges tiny tails)
  - `PDI_CHUNK_OVERLAP_CHARS` (default `500`)
  - `PDI_TABLE_BOUNDARY_BUFFER_CHARS` (default `400`, avoids splitting table rows)

Implementation and curl examples: `server/ingest/pdi/README.md`
