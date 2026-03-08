# Phase 5 - Re-Audit Bugfix Closure

> "Tony Stark mode" here means failure analysis first, patch second.
> The goal was not to preserve stale assumptions from the original plan. The goal
> was to re-audit what still mattered, close the integrity gaps, and keep EDITH
> honest on minimum-spec hardware.

**Status:** Implemented  
**Milestone Scope:** Phase 5 only, not full-repo hygiene  
**Phase 4 IoT:** intentionally paused until real hardware exists  
**Target Reality:** EDITH must fail soft on low-resource hosts instead of faking capability

## Closure Summary

Phase 5 is now closed against the bugfix milestone that mattered in practice:

1. `MemRL nextMaxQ` no longer uses local batch siblings as the primary Bellman successor.
2. `HybridRetriever` now uses a stricter default RRF threshold.
3. embedding failure no longer injects hash vectors into LanceDB.
4. admin token comparison now uses digest-based constant-time comparison.
5. config bootstrap without auth is now blocked once persisted secret-bearing state exists.

The working rule was simple:

- if a semantic capability is unavailable, degrade to a truthful keyword path;
- if a config endpoint can change security posture, it must not stay casually reachable;
- if a learning update uses Bellman logic, it must respect the actual next-state search space.

## What Changed

### Bug 1 - MemRL Bellman Scope

**Previous state:** partially mitigated, still wrong in edge cases.  
**Final state:** fixed.

`src/memory/memrl.ts` now resolves `nextMaxQ` from the best global per-user candidates instead of preferring the local feedback batch. The implementation fetches the top candidate set once per user and excludes the memory currently being updated before applying the Bellman step.

Why this matters:

- Bellman backup needs a valid next-state max, not "whatever was in this update batch".
- local sibling max biases `Q` downward whenever the best successor is outside the batch.
- on small-device installs with fewer memories, that bias becomes more visible, not less.

### Bug 2 - Hybrid Retrieval Threshold

**Previous state:** open.  
**Final state:** fixed.

`src/memory/hybrid-retriever.ts` now uses `scoreThreshold: 0.008` by default instead of `0.005`.

This raises the floor for weak single-source matches and reduces low-value retrieval noise before it reaches prompt assembly.

### Bug 3 - Hash Fallback Embedding

**Previous state:** open and integrity-damaging.  
**Final state:** fixed.

The old hash-vector fallback has been removed from the semantic path.

Key changes:

- `src/memory/store.ts` adds `EmbeddingUnavailableError`.
- `embed()` now returns a real provider embedding or throws.
- `save()` now stores through the keyword/SQLite path when semantic embedding is unavailable.
- `search()` now degrades to keyword-only retrieval instead of returning hash vectors or empty noise.
- `src/memory/memory-node-fts.ts` now owns managed `MemoryNodeFTS` setup, rebuild, and trigger sync.

This is the most important integrity fix in Phase 5. A broken embedding provider should reduce capability, not corrupt the vector index.

### Bug 4 - Timing-Safe Admin Token Compare

**Previous state:** partially mitigated.  
**Final state:** hardened.

`src/gateway/server.ts` no longer relies on the older padded raw-buffer compare. Admin-token checks now hash both values through a fixed HMAC digest path and then compare fixed-size digests with `crypto.timingSafeEqual()`.

This keeps the comparison path constant-size and removes the old length-sensitive raw compare behavior.

### Bug 5 - Config Bootstrap Auth Policy

**Previous state:** partially mitigated, still too permissive.  
**Final state:** hardened.

Authless config bootstrap is now allowed only when all of the following are true:

- request comes from loopback,
- there is no bearer token in the request,
- `ADMIN_TOKEN` is not configured,
- persisted config does not already contain secret-bearing state.

`src/config/edith-config.ts` now exports `getConfigBootstrapState()`, and `src/gateway/server.ts` uses it as the single bootstrap gate for `/api/config*`.

Secret-bearing state is detected from persisted config paths such as:

- `env.*` entries with secret-like keys,
- channel token/secret/password fields,
- `voice.stt.providers.deepgram.apiKey`,
- `voice.wake.providers.picovoice.accessKey`,
- IoT token/password fields,
- skill/provider API keys.

## Public Behavior That Is Now Official

### Retrieval

- If embedding providers are unavailable, EDITH degrades to keyword-only memory retrieval.
- EDITH no longer writes pseudo-random fallback vectors into LanceDB.

### Config Auth

- `GET /api/config`
- `PUT /api/config`
- `PATCH /api/config`
- `POST /api/config/test-provider`
- `POST /api/config/prepare-wake-model`

These endpoints only allow authless bootstrap on a pristine loopback host with no configured admin token and no persisted secret-bearing state.

## Verification Gates

The Phase 5 closeout gates used for this milestone were:

- `pnpm vitest run src/memory/__tests__/memrl.test.ts src/memory/__tests__/hybrid-retriever.test.ts src/memory/__tests__/store.test.ts src/gateway/__tests__/server.test.ts`
- `pnpm vitest run src/memory/__tests__/hybrid-retriever.integration.test.ts src/memory/__tests__/memrl-helpers.test.ts`

Latest result:

- targeted Phase 5 suite: `29` tests passed
- adjacent memory regression suite: `27` tests passed

## Operational Readiness

Phase 5 is ready for use for the intended milestone:

- memory learning is using the right Bellman scope,
- semantic failure no longer poisons the vector index,
- keyword degradation is explicit and operational,
- config bootstrap is no longer casually open after secret state exists.

## Known Out-Of-Scope Exceptions

These are real repo issues, but they do not block Phase 5 closure:

- `src/engines/openai.ts`
- `src/os-agent/vision-cortex.ts`
- several existing `src/os-agent/__tests__/*` typing errors
- existing JSON-import/type issues outside the memory/gateway bugfix scope

`pnpm typecheck` is still red because of those areas, not because of the Phase 5 bugfix changes above.

## Reference Basis

The engineering reasoning for this phase follows the same external guidance that motivated the original audit:

- Bellman-scope correctness for RL-style updates
- reciprocal-rank fusion thresholding for hybrid retrieval
- vector-space integrity over "fake fallback" embeddings
- constant-time secret comparison guidance from CWE-208 / OWASP-style practice
- strict bootstrap/auth boundaries for configuration surfaces

The implementation standard used here was simple: EDITH is allowed to degrade capability, but it is not allowed to fake correctness.
