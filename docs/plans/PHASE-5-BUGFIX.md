# Phase 5 — Critical Bug Fixes (5 Bugs)

**Durasi Estimasi:** 3–5 hari  
**Prioritas:** 🔴 CRITICAL — Beberapa bug ini adalah security vulnerabilities  
**Status:** 5 bugs identified, 0 fixed  

---

## 1. Landasan Riset (Academic Papers)

Bug fixes ini di-inform oleh riset terkait untuk memastikan fix yang diaplikasikan **benar secara teoritik**:

| # | Paper / Source | Relevansi ke Bug |
|---|---------------|-----------------|
| 1 | **ShiQ: Shifted-Q Algorithm** (arXiv 2024) | Bug #1 — Bellman equation Q-learning yang benar untuk LLM memory. ShiQ: `Q(s,a) = r + γ·maxQ(s',a')` harus scope global |
| 2 | **Memory-R1: RL for LLM Memory** (arXiv 2025) | Bug #1 — RL memory management: ADD/UPDATE/DELETE operations need correct Q-value propagation |
| 3 | **Analysis of Fusion Functions for Hybrid Retrieval** (arXiv) | Bug #2 — RRF threshold analysis: `score = Σ weight/(k+rank)`, threshold harus filter noise |
| 4 | **RAG-Fusion** (arXiv) | Bug #2 — RRF parameter tuning best practices for retrieval quality |
| 5 | **Embedding Drift / Silent Corruption** (HN/arXiv) | Bug #3 — Mixing hash vectors with semantic vectors corrupts cosine similarity space |
| 6 | **MQTT-SN PUF Authentication** (MDPI 2024) | Bug #4 — Timing side-channel attacks: HMAC comparison eliminates length leakage |
| 7 | **CWE-208: Observable Timing Discrepancy** (MITRE) | Bug #4 — Constant-time comparison is mandatory for auth tokens |
| 8 | **OWASP API Security Top 10** | Bug #5 — Broken Object Level Authorization: config endpoints need auth |

---

## 2. Bug Detail & Fix Plans

### 2.1 Bug #1 — MemRL nextMaxQ Wrong Bellman Scope

**File:** `src/memory/memrl.ts` ~lines 375-395  
**Paper basis:** ShiQ (arXiv 2024) — correct Bellman equation requires global max Q

**Problem:** `nextMaxQ` computed from batch siblings only (2-5 memories), not global max → biased underestimate → suboptimal memory ranking.

```
ShiQ Paper Principle:
  Q(s,a) = reward + γ · max_{a'} Q(s', a')
  
  "max" MUST be over ALL valid next states,
  not just the current mini-batch.
  
  Current bug: max over batch (2-5 items) ← WRONG
  Fix: max over all user memories (global) ← CORRECT
```

**Fix:** Replace per-batch peer lookup with global DB query:
```typescript
// OLD: const peerMaxQ = nodes.filter(same_user).map(q).max()
// NEW:
const successor = await prisma.memoryNode.findFirst({
  where: { userId: node.userId, id: { not: memoryId } },
  orderBy: { qValue: "desc" },
  select: { qValue: true, utilityScore: true },
})
const nextMaxQ = successor?.qValue ?? successor?.utilityScore ?? 0.5
```

**Impact:** ~10 lines. Adds 1 DB query per memory in feedback batch (acceptable — feedback is not latency-critical per Memory-R1).

---

### 2.2 Bug #2 — RRF Threshold Too Permissive

**File:** `src/memory/hybrid-retriever.ts` ~line 66  
**Paper basis:** Analysis of Fusion Functions (arXiv) — RRF score distribution analysis

**Problem:** `scoreThreshold: 0.005` is effectively a no-op. Mathematical proof:

```
RRF Score Formula: weight × (1 / (k + rank))

With k=60, weight_fts=0.4, weight_vec=0.6:

Rank 1 in both:   0.4/61 + 0.6/61 = 0.0164 (max possible)
Rank 20 in both:  0.4/80 + 0.6/80 = 0.0125
Rank 20 FTS only: 0.4/80 + 0     = 0.005  ← Current threshold
Rank 15 Vec only: 0     + 0.6/75 = 0.008  ← Better threshold

Recommended: 0.008 → filters single-source rank 16+ noise
(per RAG-Fusion: noise in retrieved context wastes tokens)
```

**Fix:** 1 line change: `scoreThreshold: 0.005 → 0.008`

---

### 2.3 Bug #3 — Hash Fallback Embedding Corruption

**File:** `src/memory/store.ts` ~lines 350-390  
**Paper basis:** Embedding Drift research — mixing hash vectors with semantic vectors corrupts cosine similarity

**Problem:** When embedding providers (Ollama/OpenAI) are down, `hashToVector()` produces fake embeddings stored alongside real ones → vector search returns garbage.

```
Embedding Space Corruption (from research):
  
  Real embedding: 768-dim semantic vector (cosine similarity = meaningful)
  Hash vector:    768-dim deterministic hash (cosine similarity = RANDOM)
  
  Mixed in same LanceDB table → search results = mix of
  semantic matches + hash garbage → degraded retrieval quality
```

**Fix Strategy (Reject, don't fake):**
```typescript
// OLD: return hashToVector(text)  // ← CORRUPTS
// NEW: throw new EmbeddingUnavailableError("No provider")

// Callers:
try { embedding = await store.embed(content) }
catch (err) {
  if (err instanceof EmbeddingUnavailableError) {
    // Store in Prisma only (FTS works), skip LanceDB
  }
}
```

**Impact:** ~25 lines across 2 files. FTS still works. Vector search degrades gracefully.

---

### 2.4 Bug #4 — Admin Token Timing Side-Channel

**File:** `src/gateway/server.ts` ~lines 173-190  
**Paper basis:** CWE-208 (MITRE), MQTT-SN PUF (MDPI 2024) — constant-time comparison mandatory

**Problem:** `timingSafeTokenEquals` takes different code paths for length mismatch vs match → attacker can determine ADMIN_TOKEN length.

```
CWE-208 Principle:
  Observable timing discrepancy reveals secret properties.
  
  Fix: HMAC both values → always 32-byte comparison.
  HMAC(key, candidate) vs HMAC(key, expected)
  → Same computation time regardless of input length
```

**Fix:** Replace with HMAC-based comparison:
```typescript
function timingSafeTokenEquals(candidate: string, expected: string): boolean {
  const key = Buffer.from(expected, "utf-8")
  const a = crypto.createHmac("sha256", key).update(candidate).digest()
  const b = crypto.createHmac("sha256", key).update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}
```

---

### 2.5 Bug #5 — Unauthenticated Config Write Endpoints

**File:** `src/gateway/server.ts` ~lines 882-930  
**Paper basis:** OWASP API Security Top 10 — Broken Object Level Authorization

**Problem:** `PUT/PATCH /api/config` and `POST /api/config/test-provider` have ZERO auth → any network client can overwrite configuration.

**Fix:** Add `requireConfigAuth()` middleware:
```typescript
async function requireConfigAuth(req, reply): Promise<boolean> {
  const adminToken = process.env.ADMIN_TOKEN
  if (!adminToken) {
    // First-time setup: allow if no config exists yet
    const config = await readEdithConfig().catch(() => null)
    if (!config || !hasAnyProviderKey(config)) return true
    reply.code(403).send({ error: "Set ADMIN_TOKEN to allow changes" })
    return false
  }
  const bearer = req.headers.authorization?.replace("Bearer ", "")
  if (!bearer || !timingSafeTokenEquals(bearer, adminToken)) {
    reply.code(401).send({ error: "Invalid admin token" })
    return false
  }
  return true
}
```

---

## 3. Implementation Roadmap

### Day 1: Security Fixes (Bugs #4, #5) — CRITICAL FIRST

| Task | File | Paper Basis |
|------|------|-------------|
| Fix timing side-channel | server.ts | CWE-208 / MQTT-SN PUF |
| Add config auth middleware | server.ts | OWASP API Top 10 |
| Apply auth to PUT/PATCH/POST | server.ts | OWASP |
| Tests: token comparison | __tests__/ | CWE-208 |
| Tests: config auth | __tests__/ | OWASP |

### Day 2: Memory Fixes (Bugs #1, #3)

| Task | File | Paper Basis |
|------|------|-------------|
| Fix MemRL Bellman scope | memrl.ts | ShiQ / Memory-R1 |
| Reject hash fallback | store.ts | Embedding drift research |
| Update embed() callers | store.ts | — |
| Tests: global Q | __tests__/ | ShiQ |
| Tests: embedding rejection | __tests__/ | — |

### Day 3: Retrieval Fix + Verification (Bug #2)

| Task | File | Paper Basis |
|------|------|-------------|
| Update RRF threshold | hybrid-retriever.ts | Fusion Functions analysis |
| Regression tests | __tests__/ | RAG-Fusion |
| Full test suite run | terminal | — |
| tsc check | terminal | — |

---

## 4. References

| # | Paper | Venue | Bug |
|---|-------|-------|-----|
| 1 | ShiQ: Shifted-Q Algorithm for LLMs | arXiv 2024 | #1 |
| 2 | Memory-R1: RL for LLM Memory Management | arXiv 2025 | #1 |
| 3 | Analysis of Fusion Functions for Hybrid Retrieval | arXiv | #2 |
| 4 | RAG-Fusion: New Take on RAG | arXiv | #2 |
| 5 | Embedding Drift / Silent Corruption in Vector DBs | Research | #3 |
| 6 | MQTT-SN PUF Authentication Scheme | MDPI 2024 | #4 |
| 7 | CWE-208: Observable Timing Discrepancy | MITRE | #4 |
| 8 | OWASP API Security Top 10 | OWASP | #5 |

---

## 5. File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `src/memory/memrl.ts` | Fix Bellman nextMaxQ query | ~10 |
| `src/memory/hybrid-retriever.ts` | Update scoreThreshold | 1 |
| `src/memory/store.ts` | Reject hash fallback, add error class | ~25 |
| `src/gateway/server.ts` | Fix timing comparison, add config auth | ~50 |
| `src/__tests__/memrl-bellman.test.ts` | NEW | ~30 |
| `src/__tests__/embedding-fallback.test.ts` | NEW | ~25 |
| `src/__tests__/config-auth.test.ts` | NEW | ~40 |
| **Total** | | **~181 lines** |
