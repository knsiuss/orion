# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions correspond to major development phases.

---

## [Unreleased]

### Added
- `@file` JSDoc headers added to all 324 TypeScript source files (100% coverage)
- `docs/openapi.yaml` — OpenAPI 3.1 spec covering all REST + WebSocket gateway endpoints
- `CHANGELOG.md` — this file

---

## [2.1.0] — 2026-03-09

### Added
- **Architecture**: circular dependency checker (`dpdm`) in CI; 7 circular deps reduced to 0
- **Architecture**: monorepo workspace lockfile consistency checks (pnpm workspace)
- **Security**: runtime secret rotation with `secret-store.ts`; `security.secrets_rotated` event emitted
- **Security**: Software Bill of Materials (SBOM) generation in CI via `cyclonedx-npm`
- **Security**: enhanced `dependabot.yml` with weekly audits for npm, pip, Docker, GitHub Actions
- **Tests**: 10 new test files covering gateway, hooks, markdown, observability, predictive, protocols, routing, security
- **Tests**: global coverage config in `vitest.config.ts`; thresholds 70/70/60/70%
- **Performance**: k6 load test — P95 < 3 s, 99% delivery, validated at 50 concurrent users

### Fixed
- Command injection in `code-runner.ts` tool
- Redis session race condition in concurrent writes
- Prisma cascade delete schema issue
- Memory leak in `whatsapp.ts` event listener accumulation
- Output scanner overly-broad regex causing false positives
- `as any` casts replaced with proper TypeScript types throughout codebase
- Non-null assertions removed; proper null guards added

### Changed
- `tsconfig.json`: `strict: true` enforced across all source files

---

## [2.0.0] — 2026-03-09 (TypeScript rewrite / EDITH v2)

### Added

#### Core Infrastructure (Phases OC0–OC12)
- Full TypeScript/ESM rewrite of the previous Python "Orion" codebase
- `pnpm` monorepo with `packages/plugin-sdk` and `extensions/` workspace
- Prisma ORM with SQLite (dev) → PostgreSQL (prod) via `driverAdapters`
- `src/core/message-pipeline.ts` — canonical single-entry-point pipeline
- `src/core/bootstrap.ts` — workspace identity loading (SOUL.md, AGENTS.md, etc.)
- `src/core/system-prompt-builder.ts` — dynamic system prompt assembly
- `src/core/persona.ts` — time-of-day and context-aware persona selection
- `src/engines/orchestrator.ts` — adaptive multi-provider LLM routing with circuit breaking
- `src/memory/store.ts` — LanceDB vector store, embedding, and `buildContext()`
- Multi-tenant workspace resolver and device pairing system
- Fastify HTTP/WebSocket gateway with CSRF, CORS, and rate limiting

#### Channels (Phase 8)
- Telegram, Discord, WhatsApp, WebChat, Email, SMS, Phone channels
- `ChannelManager` with outbox, circuit breaker, and per-channel health monitoring
- WhatsApp Cloud API mode with HMAC webhook signature verification
- iMessage, Matrix (bridged), Signal (relay), LINE, Teams stubs

#### Voice Pipeline (Phase 1)
- `src/voice/bridge.ts` — VoiceBridge (Whisper STT + Kokoro TTS via Python sidecar)
- Wake word detection with configurable model
- Always-on voice mode and Fish Audio TTS provider
- Voice handoff for multi-turn voice conversations

#### Vision (Phase 3)
- `src/vision/` — multimodal image analysis via LLM engine
- `python/vision/processor.py` — Python sidecar for local/heavy vision tasks
- Screenshot capture and analysis tool for computer-use agents

#### Memory Architecture (Phase 6)
- `src/memory/memrl.ts` — MemRL Q-learning with IEU triplets and Bellman updates
- `src/memory/hybrid-retriever.ts` — FTS5 + LanceDB vector hybrid search (RRF)
- `src/memory/causal-graph.ts` — causal knowledge graph with node/edge deduplication
- `src/memory/episodic.ts` — structured episodic memory for long-horizon recall
- `src/memory/himes.ts` — HiMeS coordinator fusing all memory layers
- `src/memory/promem.ts` — proactive memory surfacing
- `src/memory/rag.ts` — document ingestion pipeline for knowledge base

#### Security (Phase 5 + Phase 28)
- `src/security/prompt-filter.ts` — injection detection and policy enforcement
- `src/security/camel-guard.ts` — CaMeL taint tracking with capability tokens
- `src/security/audit.ts` — structured audit trail persisted to `AuditRecord` table
- `src/security/skill-scanner.ts` — manifest validation for loaded skills
- DM access policy — open / allowlist / blocklist / admin-only modes
- Safe regex execution preventing ReDoS
- External content sandboxing

#### Computer Use / Agents (Phase 7)
- `src/agents/lats-planner.ts` — LATS (Language Agent Tree Search) planner
- `src/agents/tools/` — browser, file, code-runner, HTTP, email, notes tools
- `src/agents/legion/` — multi-agent orchestration with CRDT shared state
- Loop detector to abort runaway tool sequences

#### Background Intelligence (Phase 6)
- `src/background/daemon.ts` — proactive background loop
- `src/background/habit-model.ts` — routine detection from timestamp patterns
- `src/background/quiet-hours.ts` — adaptive quiet hours

#### Multi-Account / Routing (Phase 30)
- Round-robin key rotation with per-key quota tracking
- Capability-based request router (reasoning, code, fast, multimodal, local)
- Per-user model preference persistence

#### LLM Engine Expansion (Phase 31)
- Added: DeepSeek, Mistral, Together AI, Fireworks, Cohere, GitHub Copilot engines
- Total providers: Anthropic, Groq, Gemini, OpenAI, OpenRouter, Ollama + 6 new

#### Skills Library (Phase 33)
- 55+ built-in skills across 7 categories (productivity, lifestyle, finance, tech, social, learning, health)
- Hot-reload skill loader with file-system watcher
- `src/skills/marketplace.ts` for community skill discovery

#### Extensions (Phase 32)
- `pnpm workspace` with separate `packages/plugin-sdk`
- Extensions: GitHub, Notion, Home Assistant, Zalo
- `PluginManifestV2` with typed hook system

#### Daemon Service (Phase 34)
- `launchd` (macOS), `systemd` (Linux), Task Scheduler (Windows) integration
- CLI commands: `edith daemon start|stop|status|install|uninstall`

#### Ambient Intelligence (Phase 37)
- Weather monitor (Open-Meteo API, no key required)
- News curator with source filtering
- Market monitor (stock/crypto quotes)
- Ambient scheduler — rate-limited proactive delivery

#### Communication Intelligence (Phase 38)
- Message screener — urgency/sentiment triage
- Meeting prep briefings
- Draft assistant for email/message composition
- Follow-up tracker with reminder scheduling

#### Predictive Engine (Phase 39)
- Intent predictor from session context
- Suggestion engine with priority queue
- Pre-fetcher for anticipated queries
- `PredictionCache` Prisma model

#### Voice Upgrade (Phase 40)
- Wake word detector with configurable model
- Always-on mode (continuous listening)

#### Finance Tracker (Phase 41)
- Expense tracker with category tagging
- Crypto portfolio viewer
- Subscription audit
- `ExpenseRecord` Prisma model

#### API Compatibility (Phase 42–43)
- OpenAI-compatible `/v1/chat/completions` and `/v1/embeddings` endpoints
- MCP (Model Context Protocol) server mode — `ask_edith` and `search_memory` tools
- stdio transport for IDE/toolchain integration

#### Protocols (Phase 36)
- Morning briefing with weather, calendar, and news summary
- Evening SITREP and briefing scheduler

#### Personalization (Phase 10)
- `src/core/personality-engine.ts` — per-user tone presets (jarvis/friday/cortana/hal)
- `src/memory/user-preference.ts` — CIPHER preference inference with adaptive sliders
- Per-user formality, verbosity, humor, proactivity sliders
- `src/memory/feedback-store.ts` — explicit + implicit preference signals

#### Mobile (Phase 16)
- `POST /api/mobile/register-token` — Expo push notification token registration
- `GET /api/sync/delta` — battery-efficient background sync
- `apps/mobile/` — React Native / Expo app

#### Desktop (Phase 17)
- `apps/desktop/` — Electron app with secure preload bridge

#### Observability
- Prometheus metrics endpoint (`/metrics`) with circuit breaker state transitions
- Sentry error tracking integration (optional)
- Error rate, cost budget, and memory alerting
- Daily log rotation with configurable retention

#### Deployment
- Multi-stage Dockerfile for VPS/server
- `docker-compose.yml` with PostgreSQL service
- `tsup.config.ts` for production ESM bundle
- Fly.io deploy pipeline with smoke test
- CI: GitHub Actions with security audit, SBOM, coverage upload

### Changed
- Gateway refactored from 42 KB monolithic `server.ts` → modular `gateway/routes/` directory
- PostgreSQL support via Prisma `driverAdapters` (SQLite retained for development)
- Redis session store as primary; in-memory as fallback
- TypeScript `strict: true` everywhere

### Fixed
- SIGTERM graceful shutdown with WAL checkpoint and outbox flush
- Session persistence (save on shutdown, restore on startup)
- Plugin-SDK type exports
- `mergeChannelOrder` — O(1) Set-based merge
- Various type safety issues from strict TypeScript migration

---

## [1.0.0] — 2026-02-21 (Python "Orion" — original prototype)

### Added
- Initial Python-based AI assistant "Orion"
- `orchestrator.py` — multi-provider LLM routing (OpenAI, Claude, Gemini, Ollama)
- `rag.py` — RAG pipeline with PostgreSQL + pgvector / Chroma fallback
- `memory.py` — dual PostgreSQL + vector store memory
- Permission sandbox with YAML configuration
- Telegram delivery channel
- Voice pipeline (`delivery/voice.py`) with cloning
- Vision pipeline (`vision/processor.py`, `vision/stream.py`)
- Browser automation agent with Playwright
- Background daemon (`background/process.py`) with `OrionDaemon`
- Trigger engine for scheduled and event-based proactive messages
- LangGraph agent nodes (search, code, supervisor, memory, summarize)
- Intelligence module for complex multi-step reasoning

---

[Unreleased]: https://github.com/edith-project/edith/compare/HEAD...HEAD
[2.1.0]: https://github.com/edith-project/edith/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/edith-project/edith/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/edith-project/edith/releases/tag/v1.0.0
