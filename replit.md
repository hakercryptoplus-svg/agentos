# AgentOS — AI Agent Chat

A full-featured AI agent platform inspired by OpenClaw and Hermes Agent. Chat via web or Telegram, with persistent memory, skills, and tools.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/agent-chat run dev` — run the chat web app (port 19585)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + TailwindCSS + shadcn/ui
- AI: Claude (via custom endpoint) with SSE streaming
- Telegram: node-telegram-bot-api

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/index.ts` — DB schema (sessions, messages, memory, skills, telegram_logs)
- `artifacts/api-server/src/` — Express API server
  - `lib/ai.ts` — Claude AI streaming client
  - `lib/telegram.ts` — Telegram bot integration
  - `lib/tools.ts` — Agent tools (web_search, calculate, fetch_url, etc.)
  - `routes/sessions.ts` — Chat session & message routes (SSE streaming)
  - `routes/memory.ts` — Persistent memory CRUD
  - `routes/skills.ts` — Skills library CRUD
  - `routes/tools.ts` — Tool runner + agent stats
- `artifacts/agent-chat/src/` — React frontend
  - `pages/chat.tsx` — Main SSE chat interface
  - `pages/memory.tsx` — Memory management
  - `pages/skills.tsx` — Skills library
  - `pages/tools.tsx` — Tool runner
  - `pages/settings.tsx` — Agent stats & settings

## Architecture decisions

- SSE (Server-Sent Events) for streaming AI responses — simpler than WebSocket, natively supported in browsers
- Per-channel Telegram sessions — each Telegram chat gets its own session stored in DB
- Entity-shaped OpenAPI schemas (e.g. `SessionInput` not `CreateSessionBody`) to avoid Orval TS collision
- Telegram bot starts 2s after server startup to ensure DB connection is ready
- Memory is upserted by key — same key updates the existing entry

## Product

- **Chat (Web):** Full-screen streaming chat with session history sidebar
- **Memory:** View/add/delete persistent key-value memory (Hermes-style 3-layer memory)
- **Skills:** Markdown skill files the agent can use (Hermes self-writing skills)
- **Tools:** Run agent tools directly: web_search, calculate, fetch_url, get_datetime, system_info, echo
- **Settings:** Agent stats, Telegram bot status, session creation
- **Telegram:** Bot connected, responds to all messages with full conversation history per chat

## User preferences

- Arabic support: bot responds in the user's language
- Telegram bot token: 8718116507:AAFqO-5T3OTYt4jkjIWkkC-pJ2uFlnuvZ4U
- Telegram owner chat ID: 7281928709
- AI model: claude-opus-4-7 via custom endpoint

## Gotchas

- SSE streaming requires `X-Accel-Buffering: no` header for Nginx/proxy pass-through
- After spec change: always run `pnpm --filter @workspace/api-spec run codegen` before touching hooks
- Telegram polling conflicts with multiple server instances — only run one API server at a time

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
