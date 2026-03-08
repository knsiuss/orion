# EDITH — Roadmap to Production

> **Current Score: 42 / 100**
> Last updated: 2026-03-08
>
> Update this file setiap kali item di bawah selesai diperbaiki.
> Format: centang ✅, update score, tambah tanggal & catatan singkat.

---

## Scoring Formula

| Kategori | Weight | Max Points |
|----------|--------|-----------|
| Database & Persistence | 20% | 20 |
| Test Coverage | 15% | 15 |
| Channel Reliability | 15% | 15 |
| Security & Hardening | 15% | 15 |
| Observability & DevOps | 15% | 15 |
| Core Stability | 10% | 10 |
| Scalability | 10% | 10 |

---

## 🔴 CRITICAL (Blocker — harus selesai sebelum production)

### 1. Database: Ganti SQLite → PostgreSQL
- **Impact:** +10 pts
- **Status:** ❌ Not started
- **Why:** SQLite single-writer, tidak bisa horizontal scale, data corrupt jika multi-process
- **Steps:**
  - [ ] `pnpm add @prisma/adapter-pg pg`
  - [ ] Update `prisma/schema.prisma`: `provider = "postgresql"`
  - [ ] Set `DATABASE_URL` di production env
  - [ ] Run `prisma migrate deploy`
  - [ ] Test semua Prisma queries dengan PostgreSQL
- **Notes:** _— (isi setelah selesai)_

### 2. Session Store: Ganti in-memory Map → Redis
- **Impact:** +5 pts
- **Status:** ❌ Not started
- **Why:** Session hilang saat restart, tidak bisa multi-instance
- **Steps:**
  - [ ] `pnpm add ioredis`
  - [ ] Buat `src/sessions/redis-session-store.ts`
  - [ ] Wire ke `src/sessions/session-store.ts`
  - [ ] Fallback ke in-memory kalau Redis tidak tersedia
- **Notes:** _— (isi setelah selesai)_

### 3. Graceful Shutdown
- **Impact:** +3 pts
- **Status:** ❌ Not started
- **Why:** SIGTERM langsung kill, pesan yang sedang diproses hilang
- **Steps:**
  - [ ] Tangkap `SIGTERM` dan `SIGINT` di `src/main.ts`
  - [ ] Drain pending pipeline messages
  - [ ] Tutup semua channel connections
  - [ ] Close DB connection pool
  - [ ] Timeout 30s lalu force exit
- **Notes:** _— (isi setelah selesai)_

---

## 🟠 HIGH (Wajib sebelum public launch)

### 4. E2E Tests: Channel Integration
- **Impact:** +4 pts
- **Status:** ❌ Not started
- **Why:** iMessage/LINE/Matrix/Signal polling baru diimplementasi tapi belum pernah dicoba real
- **Steps:**
  - [ ] Integration test Telegram dengan bot token test
  - [ ] Integration test Matrix dengan public homeserver
  - [ ] Mock Twilio webhook untuk phone channel test
  - [ ] Integration test email dengan MailHog (local SMTP)
- **Notes:** _— (isi setelah selesai)_

### 5. Monitoring & Alerting
- **Impact:** +5 pts
- **Status:** ❌ Not started
- **Why:** Tidak ada visibility kalau ada yang error di production
- **Steps:**
  - [ ] Expose `/metrics` endpoint (Prometheus format)
  - [ ] Track: message_pipeline_duration_ms, llm_requests_total, error_rate
  - [ ] Set up alert: error rate > 5% → notifikasi
  - [ ] Health check endpoint sudah ada (`/health`) — pastikan dimonitor
  - [ ] Optional: integrate Sentry untuk error tracking
- **Notes:** _— (isi setelah selesai)_

### 6. Rate Limiting: Global & Per-User
- **Impact:** +2 pts
- **Status:** 🔶 Partial (channel rate limiter ada, tapi pipeline-level belum)
- **Why:** User bisa spam pipeline dan naik cost LLM
- **Steps:**
  - [ ] Rate limit di pipeline entry: max 20 msg/menit per user
  - [ ] Cost budget per user per hari (config-driven)
  - [ ] Queue overflow: reject dengan pesan yang jelas
- **Notes:** _— (isi setelah selesai)_

### 7. Environment & Secrets Management
- **Impact:** +2 pts
- **Status:** 🔶 Partial (`.env` file, tapi tidak ada rotation)
- **Why:** API keys di `.env` tidak rotate, tidak ada audit trail
- **Steps:**
  - [ ] Dokumentasi semua required env vars
  - [ ] Buat `.env.example` lengkap
  - [ ] Validate semua required vars saat startup (sudah ada Zod schema — pastikan throw jika missing)
  - [ ] Optional: integrate HashiCorp Vault / AWS Secrets Manager
- **Notes:** _— (isi setelah selesai)_

### 8. CI/CD Pipeline
- **Impact:** +3 pts
- **Status:** 🔶 Partial (GitHub Actions ada untuk code review, belum ada deploy)
- **Why:** Tidak ada automated deploy, test harus manual
- **Steps:**
  - [ ] GitHub Actions: run `pnpm test` + `pnpm typecheck` on every PR
  - [ ] Block merge jika test gagal
  - [ ] Auto-deploy ke staging on merge to `main`
  - [ ] Smoke test setelah deploy
- **Notes:** _— (isi setelah selesai)_

---

## 🟡 MEDIUM (Penting untuk stability)

### 9. Test Coverage: LLM Engines
- **Impact:** +2 pts
- **Status:** 🔄 In Progress (47 tests planned oleh agent)
- **Steps:**
  - [ ] Tunggu agent selesai
  - [ ] Verify test file created di `src/engines/__tests__/engines.test.ts`
  - [ ] Run `pnpm test` — pastikan hijau
- **Notes:** _— (isi setelah selesai)_

### 10. Test Coverage: Voice & Vision Pipeline
- **Impact:** +2 pts
- **Status:** ❌ Not started
- **Steps:**
  - [ ] Test `src/voice/bridge.ts` — mock Kokoro.js + WhisperCpp
  - [ ] Test `src/vision/bridge.ts` — mock Ollama moondream
  - [ ] Test emotion engine integration
- **Notes:** _— (isi setelah selesai)_

### 11. Test Coverage: Daemon & Background
- **Impact:** +1 pt
- **Status:** ❌ Not started
- **Steps:**
  - [ ] Test `src/background/daemon.ts` — mock triggers, fake timers
  - [ ] Test `src/background/triggers.ts` — time-based evaluation
  - [ ] Test proactive message generation
- **Notes:** _— (isi setelah selesai)_

### 12. Offline Mode: Kokoro.js TTS + WhisperCpp STT
- **Impact:** +2 pts
- **Status:** 🔶 Partial (packages di-install, belum integrated di bridge.ts)
- **Steps:**
  - [ ] Wire `kokoro-js` di `src/voice/bridge.ts`
  - [ ] Wire `nodejs-whisper` di `src/voice/bridge.ts`
  - [ ] Test fallback: cloud unavailable → local TTS/STT
  - [ ] Bench latency: local vs cloud
- **Notes:** _— (isi setelah selesai)_

### 13. Phone Channel: Real Twilio Test
- **Impact:** +1 pt
- **Status:** 🔶 Partial (audio codec implemented, belum dicoba real)
- **Steps:**
  - [ ] Setup ngrok/cloudflare tunnel untuk Twilio webhook
  - [ ] Test real phone call: dial → STT → pipeline → TTS response
  - [ ] Verify G.711 μ-law codec works dengan real Twilio audio
  - [ ] Add integration test dengan Twilio test credentials
- **Notes:** _— (isi setelah selesai)_

### 14. Pre-existing TypeScript Errors
- **Impact:** +2 pts
- **Status:** ❌ Not resolved
- **Affected modules:** `src/emotion/`, `src/hardware/`, `src/mission/`
- **Steps:**
  - [ ] Run `pnpm typecheck` dan list semua errors
  - [ ] Fix emotion/ errors
  - [ ] Fix hardware/ errors
  - [ ] Fix mission/ errors
  - [ ] Pastikan `pnpm typecheck` clean (0 errors)
- **Notes:** _— (isi setelah selesai)_

### 15. Load Testing
- **Impact:** +2 pts
- **Status:** ❌ Not started
- **Steps:**
  - [ ] Install `k6` atau `artillery`
  - [ ] Simulate 100 concurrent users → 1000 messages
  - [ ] Profile bottlenecks (DB queries, LLM latency, memory)
  - [ ] Set performance budget: p95 < 3s response time
- **Notes:** _— (isi setelah selesai)_

---

## 🟢 LOW (Nice to have)

### 16. Speaker ID (Phase 10 remaining)
- **Impact:** +1 pt
- **Status:** ❌ Not started
- **Steps:**
  - [ ] Implement `src/voice/speaker-id.ts`
  - [ ] Implement `python/speaker_id.py` (Resemblyzer)
  - [ ] Wire ke voice pipeline
- **Notes:** _— (isi setelah selesai)_

### 17. Phase 20: HUD Overlay
- **Impact:** +1 pt
- **Status:** ❌ Not started
- **Steps:**
  - [ ] Baca `docs/plans/PHASE-20-HUD-OVERLAY.md`
  - [ ] Implement `src/hud/` module
- **Notes:** _— (isi setelah selesai)_

### 18. Phase 25: Digital Twin / Simulation
- **Impact:** +1 pt
- **Status:** 🔶 Partial (simulation/ files exist tapi minimal)
- **Steps:**
  - [ ] Review existing `src/simulation/` files
  - [ ] Complete what's missing per plan doc
- **Notes:** _— (isi setelah selesai)_

### 19. Documentation: API & Deployment Guide
- **Impact:** +1 pt
- **Status:** ❌ Not started
- **Steps:**
  - [ ] `docs/DEPLOYMENT.md` — Docker setup, env vars, reverse proxy
  - [ ] `docs/API.md` — gateway endpoints, WebSocket protocol
  - [ ] Update README dengan quick-start yang akurat
- **Notes:** _— (isi setelah selesai)_

### 20. Dependency Audit
- **Impact:** +1 pt
- **Status:** ❌ Not started
- **Steps:**
  - [ ] `pnpm audit` — fix high/critical vulnerabilities
  - [ ] `pnpm run knip` — remove dead exports
  - [ ] Pin dependency versions untuk reproducible builds
- **Notes:** _— (isi setelah selesai)_

---

## Progress Tracker

| Date | Item | Score Before | Score After | Notes |
|------|------|-------------|------------|-------|
| 2026-03-08 | Initial assessment | — | 42 | Baseline |
| 2026-03-08 | +186 tests (pipeline, security, agents) | 42 | 44 | 865 tests total |
| 2026-03-08 | phone.ts audio pipeline | 44 | 45 | G.711 μ-law + WebSocket |
| 2026-03-08 | Outlook Calendar (Graph API) | 45 | 46 | Full fetch()-based implementation |
| 2026-03-08 | auto-reply → Prisma persistence | 46 | 47 | No more data loss on restart |
| 2026-03-08 | Channel receive paths | 47 | 48 | iMessage/LINE/Matrix/Signal polling |
| 2026-03-08 | Code quality: any types, JSDoc | 48 | 49 | browser.ts, webchat.ts, client.ts, 7 JSDoc files |

**Current Score: 49 / 100**

---

## What "100 / 100" Looks Like

- PostgreSQL, Redis session store, connection pooling
- 95%+ test coverage on critical paths
- All channels tested in real environments
- CI/CD with automated deploy + rollback
- Monitoring: error rate, latency, cost per user
- Load tested: 1000 concurrent users
- Zero TypeScript errors
- Security audit passed
- Documented API + deployment guide
- Graceful shutdown + zero-downtime deploys
