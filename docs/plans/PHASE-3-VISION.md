# Phase 3 - Vision Intelligence

> "JARVIS, don't give me a demo. Give me a system I can trust inside the suit."

**Status:** Phase 3 foundation in progress  
**System target:** EDITH runs on a host with **1 GB RAM minimum**  
**Setup contract:** **all user-facing setup goes through onboarding** and persists to `edith.json`

## Cara Tony Stark Mikir

Tony tidak mulai dari model. Tony mulai dari constraints:

1. `EDITH harus tahu state layar dengan cepat.`
2. `EDITH tidak boleh mati hanya karena dijalankan pada host minimum 1 GB RAM.`
3. `Semua yang penting harus bisa di-setup dari onboarding, bukan edit file manual.`

Dari situ, keputusan Phase 3 jadi sederhana:

- gunakan **Accessibility API** sebagai jalur utama UI grounding;
- gunakan **Tesseract** untuk OCR lokal;
- gunakan **multimodal cloud hanya saat benar-benar dibutuhkan**;
- jadikan **gateway** sebagai runtime vision yang canonical;
- buat profil default `minimum-spec`, bukan profil demo yang boros.

Inference dari constraint di atas: jalur default OmniParser/local-VLM tidak cocok untuk baseline minimum EDITH. Itu tetap jadi jalur advanced, bukan fondasi.

## First Principles

Phase 3 bukan "image captioning". Phase 3 adalah pipeline:

`capture -> sanitize -> OCR -> UI grounding -> optional multimodal reasoning -> action context`

Kalau satu stage gagal, sistem harus turun kelas dengan anggun:

- Accessibility miss -> tetap ada OCR
- Multimodal miss -> tetap ada OCR + screen state
- Host kecil -> tetap jalan di profil `minimum-spec`

Itu pola berpikir JARVIS/armor: **graceful degradation**, bukan all-or-nothing.

`1 GB RAM` di dokumen ini berarti **minimum requirement untuk seluruh sistem EDITH**, bukan budget memori khusus modul vision.

## Referensi Luar Yang Jadi Pedoman

Referensi utama yang dipakai untuk arah implementasi:

- [Microsoft UI Automation Overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview)
- [Tesseract User Manual](https://tesseract-ocr.github.io/tessdoc/)
- [Gemini image understanding docs](https://ai.google.dev/gemini-api/docs/image-understanding)
- [OmniParser official repository](https://github.com/microsoft/OmniParser)
- [OSWorld benchmark paper](https://arxiv.org/abs/2404.07972)
- [Set-of-Mark prompting paper](https://arxiv.org/abs/2310.11441)

Bagaimana referensi ini diterjemahkan ke EDITH:

- Microsoft UI Automation memberi jalur grounding tercepat dan termurah untuk desktop host.
- Tesseract memberi OCR lokal yang masih realistis untuk mesin kecil.
- Gemini/OpenAI/Anthropic tetap relevan untuk description dan fallback grounding, tapi harus dipanggil on-demand.
- OmniParser diperlakukan sebagai inspirasi layering, bukan default runtime baseline.
- OSWorld dan SoM menguatkan bahwa visual agent yang sehat butuh fallback, rate limit, dan grounding yang disiplin.

## Kontrak Arsitektur Saat Ini

### 1. Canonical runtime

- `gateway` adalah sumber kebenaran untuk vision.
- `desktop` dan `mobile` hanya client setup + request surface.
- `OS-Agent` dipakai saat vision perlu screen awareness host-side, bukan sebagai pipeline terpisah.

### 2. Kontrak config

Top-level `vision` di `edith.json` sekarang jadi source of truth:

```json
{
  "vision": {
    "enabled": true,
    "profile": "minimum-spec",
    "ocrEngine": "tesseract",
    "elementDetection": "accessibility",
    "multimodalEngine": "auto",
    "monitorIntervalMs": 8000,
    "rateLimitMs": 12000,
    "maxImageBytesMb": 8,
    "maxImageEdgePx": 1280
  }
}
```

Legacy `osAgent.vision` tetap dibaca sebagai fallback kompatibilitas, tapi arah resmi Phase 3 adalah top-level `vision`.

### 3. Profil runtime

#### `minimum-spec` (default)

- OCR: `tesseract`
- grounding: `accessibility`
- multimodal: `auto`
- image budget: `8 MB`
- image edge: `1280 px`
- multimodal rate limit: `12 s`
- monitor interval: `8 s`

Ini adalah posture vision yang aman ketika **seluruh EDITH** dijalankan pada host minimum 1 GB RAM.

#### `balanced`

- OCR: `tesseract`
- grounding: `accessibility`
- multimodal: `auto`
- image budget: `20 MB`
- image edge: `2048 px`
- multimodal rate limit: `10 s`
- monitor interval: `4 s`

Balanced dipakai kalau host lebih lapang, tapi jalur logikanya tetap sama.

## Yang Sudah Diimplementasikan

### Runtime

- top-level `vision` schema ditambahkan ke `edith.json`
- resolver runtime vision membaca top-level `vision` lebih dulu, lalu fallback ke `osAgent.vision`
- startup OS-Agent sekarang ikut menyala saat `vision.enabled = true`
- gateway `vision_analyze` sekarang memakai config runtime, bukan nilai hardcoded
- `VisionCortex` sekarang:
  - menghormati `profile`, `rateLimitMs`, `maxImageBytesMb`, dan `maxImageEdgePx`
  - memilih engine multimodal sesuai `multimodalEngine` saat tersedia
  - fallback ke routing orchestrator bila engine pilihan tidak tersedia/gagal
  - fallback ke accessibility saat detector advanced belum aktif
  - fallback ke Tesseract saat `cloud` OCR belum diimplementasikan

### Onboarding

- desktop onboarding sekarang menyimpan top-level `vision`
- mobile onboarding sekarang menyimpan top-level `vision`
- default onboarding path memakai profil `minimum-spec`
- semua setup vision lewat onboarding, tidak perlu edit manual `edith.json` untuk jalur baseline

## Onboarding Contract

User harus bisa menyelesaikan setup Phase 3 tanpa buka editor config:

1. pilih provider utama,
2. aktifkan `Vision`,
3. pilih profil `Minimum Spec` atau `Balanced`,
4. pilih multimodal engine,
5. simpan config.

Catatan penting:

- `auto` berarti gunakan provider multimodal terbaik yang memang sudah terkonfigurasi.
- Untuk screenshot description dan grounding multimodal, provider yang realistis saat ini adalah `Gemini`, `OpenAI`, atau `Anthropic`.
- Kalau user hanya mengonfigurasi provider non-multimodal, vision tetap punya OCR dan screen state, tetapi description multimodal bisa turun kelas.

## Kenapa Bukan OmniParser Sebagai Default?

Karena itu keputusan demo, bukan keputusan armor.

OmniParser bagus sebagai referensi arsitektur dan jalur advanced. Tetapi untuk baseline minimum EDITH:

- dependency lebih berat,
- memory footprint lebih agresif,
- operasional lebih rumit,
- onboarding jadi jauh lebih kompleks.

Jadi keputusan Phase 3 foundation:

- **adopt idenya**
- **jangan pakai sebagai default baseline**

Itu sejalan dengan first-principles requirement: sistem harus tetap hidup di host kecil.

## Public Runtime Surface

### WebSocket

`vision_analyze`

- `data`: base64 image
- `mimeType`: MIME type image
- `visionMode`: `describe | ocr | find`
- `content`: optional prompt atau query element

`vision_result`

- `mode`
- `result`
- `requestId`

### Config API

- `GET /api/config`
- `PATCH /api/config`
- `PUT /api/config`

Semua onboarding flow harus menulis top-level `vision` lewat API/IPC tersebut.

## Operational Truth

Kalau bicara jujur, Phase 3 saat ini adalah:

- **core implementation landed**
- **operationally ready on the current architecture**

Yang sudah siap dipakai:

- screenshot OCR
- screenshot description via gateway multimodal path
- accessibility-first element grounding
- grounding verifier untuk candidate LLM
- reflect loop setelah aksi GUI
- optional advanced detector path untuk host yang lebih besar
- richer visual memory retrieval lintas semantic + episodic memory
- top-level config + onboarding flow
- low-memory profile

Yang masih optional future work, bukan blocker Phase 3 ini:

1. native detector backend yang lebih berat kalau nanti mau lebih akurat dari multimodal parser path
2. verifier policy tuning per-application kalau nanti ingin precision lebih agresif
3. ranking visual memory yang lebih semantik lagi kalau memory corpus sudah jauh lebih besar

## Acceptance Gates Untuk Foundation Ini

- onboarding desktop bisa menyimpan top-level `vision`
- onboarding mobile bisa menyimpan top-level `vision`
- gateway `vision_analyze` membaca config runtime yang sama
- `minimum-spec` jadi default profile
- OS-Agent ikut start saat `vision.enabled = true`
- `VisionCortex` menghormati budget image + rate limit dari config
- balanced host bisa menjalankan advanced detector path opsional
- GUI action bisa di-reflect dan disimpan sebagai visual memory
- visual memory recall bisa menggabungkan semantic + episodic trace

## Keputusan Yang Dikunci

- baseline hardware target tetap **1 GB RAM untuk sistem EDITH secara keseluruhan**
- setup tetap **onboarding-first**
- runtime vision tetap **gateway-first**
- default grounding tetap **Accessibility API first**
- default OCR tetap **Tesseract**
- multimodal tetap **on-demand**, bukan loop permanen

Kalau Tony Stark yang approve dokumen ini, standar yang dia cari cuma satu:

`apakah ini cukup ringan untuk hidup terus, cukup disiplin untuk dipercaya, dan cukup modular untuk di-upgrade nanti?`

Untuk foundation Phase 3, jawabannya sekarang: **ya**.
