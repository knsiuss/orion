# Orion Global CLI (OpenClaw-style Wrapper)

Date: 2026-02-26

## Goal

Provide a single command (`orion`) that feels closer to OpenClaw:

- run from any directory
- link your Orion repo once
- use simple commands like `orion wa scan`

This is a **Phase 1 wrapper**, not a full repo-independent runtime yet.

## What it does (Phase 1)

- Stores a linked repo path in `~/.orion/cli.json`
- Proxies commands to `pnpm --dir <repo> ...`
- Removes the `pnpm setup` UX trap by exposing beginner-friendly commands:
  - `orion quickstart`
  - `orion wa scan`
  - `orion wa cloud`

## Install (local machine)

From your repo directory:

```bash
cd C:\Users\test\OneDrive\Desktop\orion\orion-ts
npm install -g .
```

Alternative (without global install), you can still run:

```bash
node bin/orion.js --help
```

## First-time setup

Link the repo once:

```bash
orion link C:\Users\test\OneDrive\Desktop\orion\orion-ts
```

Verify:

```bash
orion repo
```

## WhatsApp QR test (OpenClaw-style)

```bash
orion wa scan
orion all
```

Then scan QR from your phone:

- WhatsApp -> Linked Devices -> Link a Device
- scan the QR shown in terminal

## Useful commands

```bash
orion quickstart
orion doctor
orion gateway
orion wa scan
orion wa cloud
orion onboard -- --channel telegram --provider groq
```

## Current limitations (important)

Phase 1 is still **repo-backed**:

- `.env`, database, and channel auth state still live in the linked repo
- Orion does not yet store all runtime state in `~/.orion`
- `pnpm` must be available on your machine PATH

## Next phase (planned)

To match OpenClaw more closely, the next step is:

- move runtime config/state to `~/.orion`
- support `orion init` without needing a linked repo checkout
- bundle/run without shelling out to `pnpm`
