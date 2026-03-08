# EDITH v2 — Full Implementation Prompt for Claude Code

> Paste semua ini ke Claude Code. Dia akan ngerjain semua dari Phase 28 sampai selesai.
> Pakai skill: `superpowers:executing-plans`

---

## MASTER PROMPT (paste ke Claude Code):

```
You are implementing the EDITH v2 upgrade roadmap. Read the full plan first:
- C:\Users\test\OneDrive\Desktop\EDITH\docs\plans\EDITH-MASTERPLAN.md
- C:\Users\test\OneDrive\Desktop\EDITH\docs\plans\2026-03-08-EDITH-PLAN.md

Then implement EVERY phase in order. For each phase:
1. Create all files listed
2. Run: pnpm typecheck (must pass before next phase)
3. Run: pnpm test (must not break existing 1049 tests)
4. Run: git add -A
5. Run: git commit -m "feat: Phase XX — [description]"
6. Run: git push origin main

Start from Phase 28. Do NOT skip any phase. Do NOT ask for confirmation between phases — just keep going until all phases are done.

Working directory: C:\Users\test\OneDrive\Desktop\EDITH

Rules:
- Every new .ts file needs: JSDoc header, createLogger(), strict types, .js imports
- Every new feature needs: at minimum a basic test in __tests__/
- Run pnpm typecheck after EVERY phase — fix errors before continuing
- Commit and push after EVERY phase
- If a file already exists, check its content first before overwriting
- Add new env vars to src/config.ts Zod schema
- Add new Prisma models to prisma/schema.prisma then run: pnpm prisma migrate dev --name <phase-name>

Phase order (dependency-safe):
28 → 31 → 29 → 30 → 34 → 35 → 32 → 33 → 36 → 37 → 38 → 39 → 40 → 41 → 42 → 43 → 44 → 45

GO. Start with Phase 28 now.
```

---

## Kalau Claude Code berhenti di tengah jalan, lanjut dengan:

```
Continue from where you left off. Check git log to see which phase was last committed, then continue with the next phase. Same rules: typecheck → test → commit → push after every phase. Keep going until all phases complete.
```

---

## Kalau ada error TypeScript yang susah di-fix:

```
Skip the typecheck error in [file] for now by adding // @ts-ignore above the line, commit, push, then continue to next phase. We'll fix types in a cleanup pass.
```

---

## Untuk cek progress besok pagi:

```bash
cd C:\Users\test\OneDrive\Desktop\EDITH
git log --oneline -20
pnpm typecheck
pnpm test
```

---

*Generated: 2026-03-09 01:xx WIB*
*Tidur dulu, besok EDITH v2 udah jalan 🚀*
