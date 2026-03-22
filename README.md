# Grudge Game Editor
Grudge Game Editor is a Puter-integrated scene/project editor for Grudge Engine with:
- Real Puter AI Agent Playground (no mock AI responses)
- Real ObjectStore/R2 asset queries
- GDevelop project import and scene normalization
- Engine runtime systems (project manager, scene manager, hierarchy, network manager)

## What was retooled
- Added **Agent Playground** using `puter.ai.chat()` with live tool-calling
- Added **Animations** and **Character Studio** tabs with crash-safe guards
- Added route bootstrap for `/animations`, `/character-studio`, `/agent-playground`
- Added core runtime module:
  - `js/grudge-engine-core.js`
  - project/scene/entity models
  - parent-child hierarchy operations
  - network manager abstraction
- Added Node runtime API server for environment/dependency-based integrations:
  - `server/index.js`
  - `/api/ai/chat` (real Puter AI, server-side token optional)
  - `/api/objectstore/*` proxy endpoints

## Project structure
- `index.html` — Main UI and tabs
- `js/grudge-auth.js` — Puter + Grudge auth
- `js/grudge-objectstore.js` — ObjectStore/R2 + static datasets
- `js/grudge-api.js` — Grudge backend API wrapper
- `js/gdevelop-parser.js` — GDevelop → normalized scene graph
- `js/grudge-engine-core.js` — Runtime core (project/scene/hierarchy/network)
- `js/grudge-agent-playground.js` — Real Puter AI tools + chat loop
- `js/grudge-connector.js` — App orchestrator
- `server/index.js` — Node backend for local/server deployment

## Environment
Copy `.env.example` to `.env` and set values as needed.

Important values:
- `PUTER_AUTH_TOKEN` (optional for server-side `/api/ai/chat`; browser-side AI still works)
- `OBJECTSTORE_WORKER_URL`
- `OBJECTSTORE_STATIC_URL`
- `GRUDGE_API_URL`

## Local development
```bash
npm install
npm run dev
```

Then open:
- `http://localhost:4173/`
- `http://localhost:4173/animations`
- `http://localhost:4173/character-studio`
- `http://localhost:4173/agent-playground`

## No-mock policy
Agent Playground and storage interactions are wired to real services:
- AI: Puter `ai.chat()`
- Assets: `objectstore.grudge-studio.com`
- Static game data: `molochdagod.github.io/ObjectStore/api/v1/*`

No fallback fake assistant content is used in the client AI flow.
