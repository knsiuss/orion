# EDITH

> Personal AI companion — runs locally, multi-channel, learns from every interaction.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-green.svg)](https://nodejs.org/)

## What is EDITH?

EDITH is a self-hosted personal AI assistant that:

- Runs on your machine with your own API keys — no cloud dependency
- Connects to WhatsApp, Telegram, Discord, Slack, and more from one place
- Learns from every conversation using MemRL (Memory Reinforcement Learning)
- Reasons using LATS (Language Agent Tree Search) for complex tasks
- Adapts its personality and tone to each user and context
- Monitors your email, calendar, finances, and home automatically

## Prerequisites

- Node.js 22+
- pnpm 10+
- At least one LLM API key (Anthropic, OpenAI, Gemini, Groq, or Ollama)
- SQLite (bundled via Prisma — no setup needed)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/knsiuss/orion.git
cd orion
pnpm install

# 2. Interactive setup (recommended)
pnpm onboard

# 3. Start
pnpm dev               # text mode (CLI)
pnpm gateway           # gateway mode (WebSocket + HTTP)
pnpm all               # both
```

## Channel Setup

| Channel | Guide | Required Env Vars |
|---------|-------|-------------------|
| WhatsApp (Baileys) | [docs/channels/whatsapp.md](docs/channels/whatsapp.md) | `WHATSAPP_ENABLED=true` |
| WhatsApp (Cloud API) | [docs/channels/whatsapp.md](docs/channels/whatsapp.md) | `WHATSAPP_CLOUD_ACCESS_TOKEN` |
| Telegram | [docs/channels/telegram.md](docs/channels/telegram.md) | `TELEGRAM_BOT_TOKEN` |
| Discord | [docs/channels/discord.md](docs/channels/discord.md) | `DISCORD_BOT_TOKEN` |
| Slack | — | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` |
| Signal | — | `SIGNAL_PHONE_NUMBER`, `SIGNAL_CLI_PATH` |
| Gmail | — | `GMAIL_CLIENT_ID`, `GMAIL_REFRESH_TOKEN` |

## Architecture Overview

```
User Message (any channel)
      │
      ▼
┌─────────────────────────────────────────────┐
│              Message Pipeline               │
│  0a. DM Policy  →  0b. Pre-hooks           │
│  1.  Input Safety (CaMeL prompt filter)     │
│  2.  Memory Retrieval (LanceDB + MemRL)     │
│  3.  Persona Detection                      │
│  4.  System Prompt Assembly                 │
│  5.  LLM Generation (orchestrator)          │
│  6.  Response Critique & Refinement         │
│  7.  Output Safety Scan                     │
│  8.  Persistence (DB + vector store)        │
│  9.  Async Side Effects + Post-hooks        │
└─────────────────────────────────────────────┘
      │
      ▼
  Response (back to user's channel)
```

**Core Systems:**
- **Memory:** LanceDB vector store + MemRL Q-value scoring + causal graph
- **Reasoning:** LATS (Language Agent Tree Search) for complex multi-step tasks
- **Security:** CaMeL, DM policy, audit trail, prompt injection detection
- **Personalization:** Per-user personality engine, habit model, preference inference
- **Protocols:** Morning briefing, evening summary, SITREP on demand

## Environment Variables

Minimum required:

```env
ANTHROPIC_API_KEY=sk-ant-...   # or any other provider key
DEFAULT_USER_ID=your-name
```

Run `pnpm onboard` for interactive setup, or see `src/config.ts` for the full list.

## Development

```bash
pnpm test           # run all tests
pnpm typecheck      # TypeScript check
pnpm lint           # oxlint
pnpm doctor         # health check all subsystems
pnpm test:coverage  # coverage report
```

## Extensions

EDITH supports extensions for external services. Available extensions:

| Extension | Description |
|-----------|-------------|
| `@edith/ext-zalo` | Zalo OA messaging (Vietnamese users) |
| `@edith/ext-notion` | Notion workspace — search, read, write |
| `@edith/ext-github` | GitHub — repos, issues, PRs, commits |
| `@edith/ext-home-assistant` | Home Assistant smart home control |

Load extensions by adding them to `.edith/plugins/` or via the plugin SDK.

## Docker

```bash
docker build -t edith .
docker run -p 18789:18789 --env-file .env edith
```

## Project Structure

```
src/
  core/           Message pipeline, startup, event bus
  memory/         LanceDB store, MemRL, causal graph, profiler
  engines/        LLM orchestrator, LATS planner, model routing
  security/       CaMeL, audit, prompt filter, output scanner
  channels/       WhatsApp, Telegram, Discord, Slack, Email, ...
  gateway/        WebSocket + HTTP transport (Fastify)
  background/     Daemon, habit model, self-monitor
  hooks/          Pre/post message hook pipeline
  voice/          STT/TTS pipeline
  vision/         Image/video understanding
  agents/         Computer use (LATS planner)
  cli/            CLI, onboard wizard, doctor
extensions/
  zalo/           Zalo OA channel
  notion/         Notion workspace
  github/         GitHub integration
  home-assistant/ Home Assistant control
packages/
  plugin-sdk/     Extension SDK types + registry
```

## License

MIT
