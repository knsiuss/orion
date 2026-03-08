---
name: stark-architect
description: "Build EDITH and EDITH features with Stark-style systems thinking: thin entrypoints, one canonical pipeline, explicit config, and tests."
version: 1.0.0
alwaysActive: false
invokeKey: stark
os: [windows, linux, macos]
---

# Stark Architect

Use this skill when working on EDITH as a real agent platform, not a toy demo.
Operate with Stark-style standards: high agency, sharp tradeoffs, and no hand-wavy magic.

## Core Posture

- Think in systems, not snippets.
- Keep `src/main.ts` thin and push real behavior into focused modules.
- Preserve `src/core/message-pipeline.ts` as the one canonical path for user messages.
- Prefer config, schemas, and feature flags over hard-coded branching.
- Treat long-running loops, side effects, and external integrations as operational surfaces that need logging, limits, and shutdown behavior.

## Repo Truths

- `workspace/*.md` are runtime contracts for identity and behavior, not casual documentation.
- `src/core/*` owns startup, prompt assembly, persona, commands, and pipeline flow.
- `src/engines/*` should hide provider quirks behind stable interfaces.
- `src/memory/*` is a first-class subsystem; retrieval, persistence, and feedback loops must stay coherent.
- `src/gateway/*` and `src/channels/*` are transport edges; do not let product logic drift into adapters.
- `src/os-agent/*`, `src/vision/*`, and `src/voice/*` are high-risk surfaces; gate them behind config and fail soft.
- `docs/*` should track operator-visible behavior, setup, and architectural changes.

## Working Rules

- Start at the narrowest module that actually owns the behavior.
- Extend existing abstractions before creating a parallel path.
- Keep async side effects best-effort and observable.
- Preserve Windows-safe path and command behavior.
- Prefer explicit Zod-backed config over loose environment assumptions.
- Match the local code style and add targeted Vitest coverage near changed behavior.

## Shipping Checklist

1. Decide the real home for the change: `core`, `memory`, `engines`, `gateway`, `channels`, `skills`, or `os-agent`.
2. Add config or guardrails if rollout risk exists.
3. Add logs or metrics for new background or external behavior.
4. Update docs if setup, runtime behavior, or operator workflow changed.
5. Verify the smallest useful set of checks before stopping.

## Avoid

- Duplicating message handling outside `src/core/message-pipeline.ts`.
- Smuggling policy into random adapters or helpers.
- Hard-coding provider assumptions into shared interfaces.
- Editing identity/bootstrap files to fake behavior that should live in code.
- Shipping background loops without rate control, failure handling, and shutdown semantics.

## Verification

- `pnpm test -- <target>`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm dev`
- `pnpm dev -- --mode gateway`
- `pnpm edith` when touching OS-agent, perception, vision, or voice

## Tone

Be direct, technical, and skeptical of vague ideas.
Prefer a working subsystem over a cinematic promise.
