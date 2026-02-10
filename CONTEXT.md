# Project Context

## Overview
- Name: `rcic-case-law-assistant`
- App type: Vite + React (TypeScript) + Node backend
- Purpose: RCIC case-law assistant with RAG grounding (Pinecone) and MCP tool use via Groq

## Tech Stack
- React 19 (`react`, `react-dom`)
- Vite 6
- TypeScript 5.8
- UI: Headless UI, Lucide icons
- Backend: Node + Express
- LLM: Groq Responses API (remote MCP tool use)
- Vector DB: Pinecone (index dimension 1024)
- Embeddings: Pinecone Inference (`llama-text-embed-v2`, 1024-dim)

## Local Development
1. Install dependencies: `npm install`
2. Configure `.env` (see Environment section)
3. Run backend: `npm run dev:server`
4. Run frontend: `npm run dev`

## Scripts
- `npm run dev` — Vite dev server (port 3000)
- `npm run dev:server` — Node API server (port 3001)
- `npm run build` — Production build
- `npm run preview` — Preview build

## Key Files & Folders
- `App.tsx` — Main app component
- `index.tsx` — App entry
- `pages/ChatPage.tsx` — Chat UI and send flow
- `components/chat/SourcesPanel.tsx` — Renders citations panel
- `lib/api.ts` — Frontend API client (calls `/api/chat`)
- `server/index.js` — Express API server
- `server/clients/groq.js` — Groq Responses API client (MCP tools)
- `server/clients/pinecone.js` — Pinecone query client
- `server/clients/embeddings.js` — Pinecone Inference embeddings
- `server/rag/grounding.js` — RAG retrieval + prompt assembly
- `vite.config.ts` — Vite config (proxy `/api` -> `http://localhost:3001`)

## Runtime Flow (Chat)
1. UI sends user message to `/api/chat`.
2. Server embeds the query using Pinecone Inference (`llama-text-embed-v2`, 1024-dim).
3. Server queries Pinecone for top-K relevant chunks.
4. Server builds a grounded prompt with Pinecone snippets.
5. Server calls Groq Responses API with MCP server definitions.
6. Groq performs MCP tool discovery/calls as needed and returns final answer.
7. Server extracts citation tags and returns `{ text, citations }` to UI.
8. UI renders answer and citations in `SourcesPanel`.

## Environment (.env)
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `PINECONE_API_KEY`
- `PINECONE_INDEX_HOST`
- `PINECONE_NAMESPACE=ircc`
- `PINECONE_API_VERSION`
- `RETRIEVAL_TOP_K`
- `MCP_BASE_URL=https://mcp.a2aj.ca/mcp`
- `MCP_BASE_URL_SECONDARY=https://api.a2aj.ca/mcp`
- `MCP_API_KEY` (optional)
- `MCP_SERVER_LABEL`
- `MCP_SERVER_LABEL_SECONDARY`
- `MCP_SERVER_DESCRIPTION`
- `EMBEDDING_PROVIDER=pinecone`
- `EMBEDDING_MODEL=llama-text-embed-v2`
- `EMBEDDING_BASE_URL=https://api.pinecone.io`
- `EMBEDDING_DIM=1024`

## Notes
- Repo currently includes `dist/` and `node_modules/` (not typical for source control).
