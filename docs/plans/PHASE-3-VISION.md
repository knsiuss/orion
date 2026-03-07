# Phase 3 — Vision Intelligence (Screen Understanding + Multimodal)

**Durasi Estimasi:** 2 minggu  
**Prioritas:** 🟠 HIGH — Kunci untuk GUI automation yang cerdas  
**Status Saat Ini:** Screenshot ✅ | OCR (Tesseract) ✅ | describeImage ❌ (placeholder) | UI Grounding ❌  

---

## 1. Landasan Riset (Academic Papers)

Phase ini dibangun berdasarkan **6 paper utama** di bidang multimodal vision dan UI grounding:

| # | Paper | arXiv / Venue | Kontribusi ke EDITH |
|---|-------|--------------|---------------------|
| 1 | **OmniParser** | arXiv:2408.00203 | Pure vision-based UI parsing: screenshot → structured elements. EDITH adopt: *icon detection + caption model* untuk `findElement()` |
| 2 | **OmniParser V2** | Microsoft Research 2024 | Improved small-element detection + faster inference. EDITH adopt: *ScreenSpot Pro grounding benchmark* methodology |
| 3 | **ScreenAgent** | IJCAI 2024 | VLM agent: Plan → Action → Reflection pada real screen. EDITH adopt: *screenshot → describe → check* loop |
| 4 | **OSWorld** | arXiv:2404.07972 | 369 OS-level tasks di real VM. EDITH adopt: *captureAndAnalyze patterns* dan *evaluation scripts* |
| 5 | **Set-of-Mark (SoM)** | arXiv:2310.11441 | Visual prompting: overlay numbered marks pada UI elements. EDITH adopt: *element numbering* untuk LLM grounding |
| 6 | **GPT-4V System Card** | OpenAI (2023) | Multimodal safety: image understanding limits. EDITH adopt: *image size/format validation* best practices |

### Core Principles dari Research

```
┌─────────────────────────────────────────────────────────────┐
│         First Principles dari Vision Research Papers          │
│                                                               │
│  1. PURE VISION (OmniParser)                                 │
│     Screenshot-only input → no HTML/DOM required              │
│     → Accessibility API first, LLM vision fallback           │
│                                                               │
│  2. GROUNDING ACCURACY (ScreenSpot/SoM)                      │
│     Element detection must return precise coordinates         │
│     → Combine accessibility bounds + visual verification     │
│                                                               │
│  3. PIPELINE SEPARATION (ScreenAgent)                        │
│     Plan → Capture → Analyze → Act → Reflect                │
│     → Each stage independently testable + cacheable          │
│                                                               │
│  4. MULTI-PROVIDER RESILIENCE (OSWorld)                      │
│     Gemini → OpenAI → Anthropic fallback chain               │
│     → Provider-agnostic multimodal interface                 │
│                                                               │
│  5. SAFETY BOUNDS (GPT-4V Card)                              │
│     Max 20MB image, resize >2048px, validate MIME types      │
│     → Rate limit vision calls to prevent cost explosion      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Arsitektur Sistem

### 2.1 Vision Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Vision Intelligence Pipeline                   │
│                                                                   │
│  Input Sources:                                                   │
│  ┌─────────┐  ┌─────────────┐  ┌──────────────┐                │
│  │ Screen   │  │ Mobile      │  │ File/URL     │                │
│  │ Capture  │  │ Camera/     │  │ Image        │                │
│  │ (desktop)│  │ Screenshot  │  │ (shared)     │                │
│  └────┬─────┘  └──────┬──────┘  └──────┬───────┘                │
│       └───────────────┼───────────────┘                          │
│                       ▼                                           │
│  ┌────────────────────────────────────────────────┐              │
│  │  Image Router (GPT-4V Safety Principles)       │              │
│  │  • Size check (max 20MB)                       │              │
│  │  • Format validation (PNG/JPEG/WebP/GIF)       │              │
│  │  • Resolution normalization (max 2048px edge)   │              │
│  │  • Base64 encoding for API transport            │              │
│  └──────────────────┬─────────────────────────────┘              │
│                     │                                             │
│     ┌───────────────┼───────────────┐                            │
│     ▼               ▼               ▼                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐                   │
│  │ OCR      │  │ Multimod │  │ UI Element   │                   │
│  │ Path     │  │ LLM Path │  │ Detection    │                   │
│  │(Tesseract│  │(Gemini/  │  │(OmniParser   │                   │
│  │ local)   │  │ GPT-4V/  │  │ approach)    │                   │
│  │          │  │ Claude)  │  │              │                   │
│  │ Text     │  │ Describe │  │ Accessibility│                   │
│  │ Extract  │  │ + Ground │  │ + LLM        │                   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘                   │
│       └──────────────┼───────────────┘                            │
│                      ▼                                            │
│  ┌────────────────────────────────────────────────┐              │
│  │  Vision Result Aggregator (ScreenAgent pattern) │              │
│  │  {                                              │              │
│  │    ocrText: "File Edit View ...",               │              │
│  │    description: "VS Code with TypeScript...",   │              │
│  │    elements: [ {type:"button", text:"Run"} ],   │              │
│  │    screenState: { activeWindow, resolution },   │              │
│  │    confidence: 0.92                             │              │
│  │  }                                              │              │
│  └──────────────────┬─────────────────────────────┘              │
│                     ▼                                             │
│  ┌────────────────────────────────────────┐                      │
│  │  Visual Memory (MemGPT-inspired)       │                      │
│  │  Store as MemoryNode:                  │                      │
│  │  - category: "visual_context"          │                      │
│  │  - embedding: dari description text    │                      │
│  │  - metadata: { screenshot hash }       │                      │
│  │  - ttlDays: 7 (auto-expire)           │                      │
│  └────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Multimodal LLM Integration (via Orchestrator)

**Paper basis:** OSWorld evaluation — provider-agnostic multimodal routing.

```
┌───────────────────────────────────────────────────────┐
│              Engine Orchestrator (existing)             │
│              Route: gemini → openai → anthropic        │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Gemini 2.0 Flash (Best value — OmniParser V2)   │ │
│  │  POST generativelanguage.googleapis.com/v1beta/   │ │
│  │  { contents: [{ parts: [                          │ │
│  │      { text: "Describe..." },                     │ │
│  │      { inlineData: { mimeType, data: base64 }}    │ │
│  │  ]}]}                                             │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  OpenAI GPT-4o (Fallback — ScreenSpot evaluated)  │ │
│  │  { messages: [{ role: "user", content: [          │ │
│  │      { type: "text", text: "Describe..." },       │ │
│  │      { type: "image_url", image_url: { url }}     │ │
│  │  ]}]}                                             │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Anthropic Claude Sonnet (Fallback)               │ │
│  │  { content: [                                     │ │
│  │      { type: "image", source: { base64, type }}   │ │
│  │      { type: "text", text: "Describe..." }        │ │
│  │  ]}                                               │ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

### 2.3 Mobile Vision Architecture (Android/iOS)

```
┌────────────────────────────────────────────┐
│         MOBILE (React Native Expo)          │
│  ┌─────────────────────────────────────┐   │
│  │ expo-camera / expo-image-picker      │   │
│  │  → Resize to max 1024px             │   │
│  │  → JPEG quality 85%                 │   │
│  │  → Base64 encode                     │   │
│  └─────────────────────────────────────┘   │
│         │ WebSocket                        │
│         ▼                                   │
│  { type: "vision_analyze",                 │
│    image: "<base64>",                      │
│    question: "What's this?",               │
│    mode: "describe" | "ocr" | "find" }     │
└────────────────────────────────────────────┘
         │ WebSocket
         ▼
┌────────────────────────────────────────────┐
│          SERVER (EDITH Gateway)              │
│  vision_analyze → VisionCortex              │
│    → describeImage / extractText / findEl   │
│  Result → vision_result                     │
└────────────────────────────────────────────┘
```

---

## 3. Komponen yang Harus Dibangun

### 3.1 describeImage — Real Implementation

**File:** `EDITH-ts/src/os-agent/vision-cortex.ts` → `describeImage()`  
**Paper basis:** ScreenAgent (visual understanding) + OmniParser (caption model)

```typescript
async describeImage(imageBuffer: Buffer, question?: string): Promise<string> {
  const base64 = imageBuffer.toString("base64")
  const mimeType = this.detectMimeType(imageBuffer)
  const prompt = question ?? "Describe what you see in this image in detail."
  
  const { getOrchestrator } = await import("../engines/orchestrator.js")
  const result = await getOrchestrator().generate("multimodal", {
    prompt,
    context: [{ role: "user", content: [
      { type: "text", text: prompt },
      { type: "image", data: base64, mimeType }
    ]}],
    maxTokens: 1024,
  })
  return result.text
}
```

### 3.2 UI Grounding — findElement() (OmniParser approach)

**File:** `vision-cortex.ts` → NEW `findElement()`  
**Paper basis:** OmniParser (detection + caption), SoM (numbered marks), ScreenSpot (grounding benchmark)

```
Combined Strategy (OmniParser-inspired):
  1. Try accessibility API first (< 200ms) — reliable, structured
  2. If no match → visual grounding via LLM (~2s) — flexible
  3. Cache results for repeated queries
```

### 3.3 Visual Memory Integration (MemGPT-inspired)

**File:** `vision-cortex.ts` → NEW `storeVisualContext()`  
**Paper basis:** MemGPT (hierarchical memory) — store visual context for future recall

```typescript
async storeVisualContext(snapshot: {
  description: string; ocrText: string; activeWindow: string; timestamp: number
}): Promise<void> {
  await memoryService.storeMemory({
    userId: "owner",
    content: `[Visual Context] ${snapshot.activeWindow}: ${snapshot.description}`,
    category: "visual_context",
    importance: 0.3,     // Low unless explicitly referenced
    ttlDays: 7,          // Auto-expire
  })
}
```

### 3.4 Orchestrator Multimodal Extension

**Files:** `engines/adapters/{gemini,openai,anthropic}.ts`  
Each provider needs image payload formatting (different formats per API).

### 3.5 Gateway vision_analyze Handler

**File:** `src/gateway/server.ts` — WebSocket handler for mobile vision requests.

---

## 4. Dependency Tree

```
Production (Desktop): tesseract ✅ | orchestrator ✅ (needs extension) | no new npm deps
Production (Mobile):  expo-camera, expo-image-picker, expo-file-system
Dev: (none new)
```

---

## 5. Implementation Roadmap

### Week 1: describeImage + Orchestrator Extension

| Task | File | Paper Basis |
|------|------|-------------|
| Audit orchestrator multimodal support | orchestrator.ts | OSWorld: provider routing |
| Gemini image payload | gemini adapter | OmniParser V2: best value |
| OpenAI image payload | openai adapter | ScreenSpot: evaluated |
| Anthropic image payload | anthropic adapter | OSWorld: fallback chain |
| Implement real `describeImage()` | vision-cortex.ts | ScreenAgent: describe |
| Add `findElement()` method | vision-cortex.ts | OmniParser: detect+caption |
| Image size/format validation | vision-cortex.ts | GPT-4V Card: safety bounds |

### Week 2: Visual Memory + Mobile + Polish

| Task | File | Paper Basis |
|------|------|-------------|
| Visual memory integration | vision-cortex.ts | MemGPT: context store |
| Gateway vision_analyze handler | server.ts | — |
| Mobile: VisionButton component | apps/mobile/ | — |
| Unit tests for describeImage | __tests__/ | ScreenAgent: pipeline test |
| Unit tests for findElement | __tests__/ | OmniParser: accuracy |
| Integration test: mobile → server | __tests__/ | — |

---

## 6. Testing Strategy (Paper-Grounded)

**Unit Tests (10 tests — ScreenAgent pipeline separation):**

| # | Test | Paper Basis |
|---|------|-------------|
| 1 | describeImage calls orchestrator with correct multimodal payload | ScreenAgent |
| 2 | describeImage handles orchestrator failure gracefully | OSWorld |
| 3 | findElement via accessibility API returns matching element | OmniParser |
| 4 | findElement falls back to LLM when accessibility fails | OmniParser combined |
| 5 | Image format detection (PNG/JPEG/WebP) | GPT-4V Card |
| 6 | Image resize for oversized inputs (>2048px) | GPT-4V Card |
| 7 | storeVisualContext creates memory node | MemGPT |
| 8 | Gateway vision_analyze routing (ocr/describe/find) | — |
| 9 | Mobile VisionButton sends correct WS message | — |
| 10 | Mobile displays vision_result correctly | — |

**Integration Tests (3 tests):**

| # | Test | Paper Basis |
|---|------|-------------|
| 1 | Screenshot → describeImage → meaningful description | ScreenAgent full loop |
| 2 | Mobile camera → WS → server vision → response | — |
| 3 | Visual memory store → retrieve via conversation context | MemGPT |

---

## 7. Risiko & Mitigasi

| Risiko | Paper-Informed Mitigasi |
|--------|------------------------|
| Multimodal LLM quota/cost | Rate limit: max 1 vision call per 10s (OSWorld evaluation approach) |
| Gemini image size limit (20MB) | Auto-resize to max 2048px (GPT-4V Card recommendation) |
| Tesseract accuracy poor | Multimodal LLM fallback (OmniParser dual-approach) |
| UI grounding coordinates wrong | Accessibility + LLM validation (OmniParser combined strategy) |
| Mobile image upload slow on 3G | Aggressive compression 85% JPEG (standard mobile practice) |

---

## 8. References

| # | Paper | ID | Relevansi |
|---|-------|----|-----------|
| 1 | OmniParser for Pure Vision Based GUI Agent | arXiv:2408.00203 | UI element detection + caption |
| 2 | OmniParser V2 | Microsoft Research | ScreenSpot Pro SOTA grounding |
| 3 | ScreenAgent: VLM-Driven Computer Control | IJCAI 2024 | Plan→Action→Reflection pipeline |
| 4 | OSWorld: Benchmarking Multimodal Agents | arXiv:2404.07972 | Multi-app task evaluation |
| 5 | Set-of-Mark Visual Prompting for GPT-4V | arXiv:2310.11441 | Numbered mark grounding |
| 6 | GPT-4V System Card | OpenAI 2023 | Image safety bounds |
| 7 | MemGPT: LLMs as Operating Systems | arXiv:2310.08560 | Visual memory tier |

---

## 9. File Changes Summary

| File | Action | Lines Est. |
|------|--------|-----------|
| `src/os-agent/vision-cortex.ts` | Rewrite describeImage, add findElement, visual memory | +200 |
| `src/engines/orchestrator.ts` | Add multimodal payload formatting per provider | +60 |
| `src/engines/adapters/gemini.ts` | Image payload support | +30 |
| `src/engines/adapters/openai.ts` | Image payload support | +30 |
| `src/engines/adapters/anthropic.ts` | Image payload support | +30 |
| `src/gateway/server.ts` | Add vision_analyze WS handler | +40 |
| `apps/mobile/components/VisionButton.tsx` | NEW: Camera + analyze UI | +180 |
| `src/os-agent/__tests__/vision-cortex.test.ts` | Extended tests | +100 |
| **Total** | | **~670 lines** |
