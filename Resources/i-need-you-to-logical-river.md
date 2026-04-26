# DJCheck — Implementation Plan

## Context

Fin wants a local, open-source desktop alternative to BoothReady — a service that analyzes DJ audio files for Pioneer CDJ/XDJ compatibility issues and auto-fixes them. The cloud service is slow on large libraries; a local app will run orders of magnitude faster. The app needs to implement every check BoothReady documents, preserve rekordbox hot cues/loops when converting files, and have a beautiful UI following the DESIGN.md design system.

Key user decisions:
- **Output**: Separate output folder (user picks once per session)
- **Lossless output format**: User choice per conversion — WAV, AIFF, or MP3 320kbps — with clear info text on each option; 24-bit vs 16-bit selectable too (16-bit with TPDF dither for widest compatibility, 24-bit for quality)
- **CDJ targets**: Individual model selection + "All CDJs" universal compatibility mode (most restrictive rules across all models)
- **Rekordbox XML**: Core feature — import XML to preserve hot cues/loops when paths change after conversion

---

## Framework Decision: Electron + React + TypeScript

**Why Electron over Tauri**: Node.js ffmpeg ecosystem (ffmpeg-static, fluent-ffmpeg, music-metadata) is mature and reliable. Easier for the DJ/open-source community to contribute to than Rust. Cross-platform: Mac (arm64 + x64), Windows, Linux. ffmpeg-static bundles pre-compiled binaries — zero external installs needed.

**Build tool**: `electron-vite` (fast HMR, handles 3-process Electron architecture cleanly)

---

## Tech Stack

| Layer | Package |
|---|---|
| App framework | Electron 31+ |
| Build | electron-vite 5, Vite |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS v4 (via @tailwindcss/vite) |
| Audio metadata | music-metadata v11 (ESM-only, runs in main process) |
| Audio conversion | ffmpeg-static + fluent-ffmpeg |
| ffprobe | @ffprobe-installer/ffprobe |
| XML parsing | fast-xml-parser |
| State | Zustand + Immer |
| Persistence | electron-store |
| Packaging | electron-builder |
| Testing | Vitest + @testing-library/react |

---

## Complete Feature List (from BoothReady + web research)

### Error codes detected

**E-8302 (Player Error)**
- Corrupt MP3 frames (non-ISO 11172-3 compliant) — CDJ-3000 strictest
- Non-standard AIFF chunk order (SSND before COMM)
- Severely corrupted file headers (RIFF/FORM magic bytes invalid)

**E-8304 (Decode Error)**
- 32-bit Float WAV (format tag 0x0003)
- Corrupted WAV header (bad RIFF/WAVE magic)
- WAVE_FORMAT_EXTENSIBLE WAV (tag 0xFFFE)
- Compressed AIFF-C (ALAW, µLaw, IMA ADPCM)
- Non-MPEG-compliant MP3 sample rate

**E-8305 (Data Format Error)**
- WAVE_FORMAT_EXTENSIBLE (0xFFFE) — common in Bandcamp downloads, DAW exports
- 32-bit Float WAV
- Multichannel WAV (>2 channels)
- 96 kHz / 88.2 kHz WAV (not supported by CDJ-2000/NXS/XDJ-1000)
- Low sample rate WAV (22.05, 11, 8 kHz)
- 96 kHz / 88.2 kHz AIFF (same restriction)
- Compressed AIFF-C
- FLAC on unsupported CDJs (only CDJ-3000 fw 1.20+ / CDJ-TOUR1 support FLAC)
- ALAC (.m4a Apple Lossless) on CDJ-2000/NXS
- DRM-protected AAC (.m4p) — flagged, no auto-fix possible
- Non-standard MP3 sample rate

**E-8306 (No File / Seek Error)**
- VBR MP3 missing Xing header
- File path exceeds 255 characters

### CDJ model compatibility matrix

| Model | Max sample rate | FLAC | ALAC | Strict MP3 |
|---|---|---|---|---|
| CDJ-2000, CDJ-900, CDJ-850, CDJ-400, CDJ-350 | 48 kHz | No | No | No |
| CDJ-2000NXS, XDJ-1000 | 48 kHz | No | No | No |
| CDJ-2000NXS2, XDJ-1000MK2 | 96 kHz | No | Yes | No |
| CDJ-3000, CDJ-3000X | 96 kHz | Yes (fw 1.20+) | Yes | Yes |
| **All CDJs** mode | 48 kHz | No | No | Yes (use CDJ-3000 rules) |

### Additional checks found via web research (not in BoothReady)

- **OGG Vorbis** — completely unsupported on all Pioneer CDJs. Detect `.ogg` files and flag (no auto-fix).
- **Mono audio** (1 channel WAV/AIFF) — flag as warning; CDJs expect stereo. Many tracks are fine but some CDJ models behave unpredictably.
- **PNG album artwork in tags** — Pioneer CDJs expect JPEG artwork embedded in ID3/AIFF tags. PNG artwork causes display failures. Auto-fix: transcode embedded art to JPEG on output.
- **Non-ASCII / Unicode filenames** — CDJs display but may sort/navigate incorrectly with non-ASCII characters. Flag as warning (not error).
- **XDJ-1000MK2 88.2/96 kHz**: Research suggests the XDJ-1000MK2 may NOT support 88.2/96kHz unlike CDJ-2000NXS2. Update model matrix, add note to verify against Pioneer spec sheet and show uncertainty in UI.
- **rekordbox v7.2.12 bug** — a known pulled version that causes USB exports to fail on CDJ hardware. Detect from rekordbox.xml version metadata and warn user.
- **Device Library Plus conflict** — rekordbox 7.x exports Device Library Plus format (for OPUS-QUAD/OMNIS-DUO) alongside standard export; older CDJs may not read it correctly. Flag in rekordbox XML analysis.
- **Hot cue count limit** — export mode supports max 8 hot cues (A–H); warn if rekordbox XML shows a track with more than 8 hot cue POSITION_MARKs.

### WAV_EXTENSIBLE lossless in-place patch (WavFixer approach)

For `WAV_EXTENSIBLE` (0xFFFE) where the subformat GUID maps to standard integer PCM, the fix can be a **2-byte in-place header patch** (offset 20–21: `0xFE 0xFF` → `0x01 0x00`) rather than a full ffmpeg re-encode. This is instant, byte-for-byte identical audio data, and is what tools like WavFixer/WavPatcher/pioneer-wav-fixer do. The converter should check the EXTENSIBLE subformat GUID at bytes 40–55:
- If subformat = `{00000001-0000-0010-8000-00aa00389b71}` (standard PCM GUID): do the in-place patch
- Otherwise (float, etc.): fall back to ffmpeg re-encode

### Auto-fix operations

| Issue ID | Fix | Lossless? | Dither? |
|---|---|---|---|
| WAV_EXTENSIBLE | In-place format tag patch (0xFFFE→0x0001) if PCM subformat, else ffmpeg | Yes (if PCM) | No |
| WAV_32BIT_FLOAT | Encode to 24-bit PCM (or 16-bit w/ dither) | No | Yes if →16-bit |
| WAV_SAMPLE_RATE_HIGH | Resample to 44.1 kHz | No | No |
| WAV_SAMPLE_RATE_LOW | Resample to 44.1 kHz | No | No |
| WAV_BIT_DEPTH_8 | Encode to 16-bit | No | No |
| WAV_CORRUPT_HEADER | Re-encode with clean header | No | No |
| MULTICHANNEL | Downmix to stereo | No | No |
| AIFF_CHUNK_ORDER | Rewrite container (COMM before SSND) | Yes | No |
| AIFF_COMPRESSED | Decode + re-encode as uncompressed PCM | No | No |
| AIFF_SAMPLE_RATE_HIGH | Resample to 44.1 kHz | No | No |
| MP3_CORRUPT_FRAMES | Re-encode via libmp3lame | No | No |
| MP3_NONSTANDARD_SAMPLE_RATE | Re-encode to 44.1 kHz | No | No |
| VBR_NO_XING | Re-encode with lame (forces Xing header) | No | No |
| FLAC_UNSUPPORTED | Convert to AIFF/WAV 24-bit (user choice) | Format change | If →16-bit |
| ALAC_UNSUPPORTED | Convert to AIFF/WAV 24-bit (user choice) | Format change | If →16-bit |
| AAC_DRM | Flag only — no fix possible | N/A | N/A |
| PATH_TOO_LONG | Flag only — user must rename | N/A | N/A |
| OGG_UNSUPPORTED | Flag only — no Pioneer CDJ supports OGG | N/A | N/A |
| MONO_AUDIO | Flag as warning — downmix to stereo optional | No | No |
| PNG_ARTWORK | Transcode embedded artwork PNG → JPEG on output | No | N/A |
| UNICODE_FILENAME | Flag as warning only (display/sort issues, not playback) | N/A | N/A |

### Dithering strategy (answer to user's question)
When reducing bit depth (32→24 or 24→16), apply **TPDF (Triangular Probability Density Function) dither** via ffmpeg's `-af dither` filter. This is the industry standard — it replaces quantization distortion with benign broadband noise that sits below the noise floor. It does NOT cause CDJ compatibility issues. Truncation without dithering produces audible artefacts on sustained tones; dithering is strictly better. The UI will display a note explaining this for non-technical users.

---

## Project Structure

```
djcheck/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
├── src/
│   ├── shared/
│   │   └── ipc-types.ts              ← IPC channel names + all TypeScript types
│   ├── main/
│   │   ├── index.ts                  ← Electron main entry, BrowserWindow, app events
│   │   ├── setup/
│   │   │   └── preflight.ts          ← First-run ffmpeg binary check
│   │   ├── audio/
│   │   │   ├── ffmpeg-setup.ts       ← asar-unpacked binary path resolution
│   │   │   ├── analyzer.ts           ← Core binary header inspection + music-metadata
│   │   │   ├── converter.ts          ← ffmpeg arg construction + conversion runner
│   │   │   └── rekordbox.ts          ← rekordbox XML parse + path update
│   │   └── ipc/
│   │       ├── analyze.ts            ← analyzeFiles IPC handler (parallel, cancellable)
│   │       ├── convert.ts            ← convertTracks IPC handler
│   │       └── dialogs.ts            ← folder/file picker dialogs
│   ├── preload/
│   │   └── index.ts                  ← contextBridge API (typed, minimal surface)
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── App.tsx               ← Route: Onboarding | Main
│           ├── store/
│           │   └── index.ts          ← Zustand store (tracks, conversion state, settings)
│           ├── components/
│           │   ├── TitleBar.tsx      ← Frameless window drag handle + window controls
│           │   ├── Sidebar.tsx
│           │   ├── PlayerSelector.tsx ← CDJ model chips + "All CDJs" option
│           │   ├── DropZone.tsx      ← Drag & drop overlay
│           │   ├── Toolbar.tsx       ← Search, filter chips, action buttons
│           │   ├── TrackList.tsx     ← react-window virtualized list
│           │   ├── TrackRow.tsx      ← Per-track row with issues, status, fix button
│           │   ├── IssueTag.tsx      ← Colour-coded pill with error code + description
│           │   ├── ConversionOptions.tsx ← Format picker (WAV/AIFF/MP3), bit depth, dither
│           │   ├── ConversionProgress.tsx ← Sticky bottom bar during processing
│           │   ├── RekordboxPanel.tsx ← XML import + update status
│           │   └── ui/
│           │       ├── Button.tsx
│           │       ├── Card.tsx
│           │       └── Badge.tsx
│           ├── pages/
│           │   ├── Onboarding.tsx    ← First-run CDJ model selector
│           │   └── Home.tsx          ← Main app layout
│           └── styles/
│               └── globals.css       ← Cal Sans font, Inter, design token CSS vars
├── test/
│   ├── fixtures/                     ← Small crafted audio files for each issue type
│   └── unit/                         ← Vitest unit tests for analyzer + converter logic
└── build/
    └── entitlements.mac.plist        ← macOS hardened runtime entitlements
```

---

## Design System Implementation (from DESIGN.md)

**Fonts**: Cal Sans (headings ≥24px only, weight 600, tight letter-spacing), Inter (body). Self-host both in `renderer/src/styles/`.

**Color tokens** (CSS vars):
```css
--color-bg: #242424;        /* near-black, main backgrounds */
--color-surface: #2e2e2e;   /* card surfaces */
--color-border: #3a3a3a;    /* subtle separators */
--color-text: #ffffff;
--color-muted: #898989;
--color-accent: #0099ff;    /* links only */
--color-success: #22c55e;   /* clean tracks */
--color-warning: #f59e0b;   /* fixable issues */
--color-error: #ef4444;     /* non-fixable / DRM */
```

**Shadows**: Multi-layered shadow stack from DESIGN.md for all cards (never plain borders):
```css
box-shadow:
  0 0 0 1px rgba(255,255,255,0.06),
  0 4px 6px -1px rgba(0,0,0,0.4),
  0 2px 4px -2px rgba(0,0,0,0.3),
  inset 0 1px 0 rgba(255,255,255,0.06);
```

**Buttons**: Dark primary (#242424 bg, white text, 6-8px radius, inset top highlight for 3D effect). Pill variant (border-radius: 9999px) for CDJ model selector chips and filter chips.

**Layout**: Frameless window, custom title bar, sidebar (240px) + main area flex layout.

**TrackList rows**: 72px height, virtualized via `react-window` `FixedSizeList` — handles 10,000+ tracks.

---

## IPC Architecture

Strict typed channel contract in `src/shared/ipc-types.ts` used by both main and preload. Preload exposes a minimal `window.djcheck` API via `contextBridge`. All audio processing (analysis + conversion) runs in the Electron main process; renderer sends commands and receives streaming progress events.

Analysis runs with concurrency limit of 4 parallel files (configurable) to avoid disk I/O saturation. Both analysis and conversion support cancellation via a cancel channel.

---

## Critical ffmpeg Packaging Note

`ffmpeg-static` binaries MUST be unpacked from `app.asar` or they cannot be executed by the OS. `electron-builder.yml` must include:
```yaml
asarUnpack:
  - "node_modules/ffmpeg-static/**"
  - "node_modules/@ffprobe-installer/**"
```
At runtime, `ffmpeg-setup.ts` remaps paths to `app.asar.unpacked/` when `app.isPackaged` is true.

**ffmpeg WAV output gotcha**: ffmpeg always writes `WAVE_FORMAT_EXTENSIBLE` for 24-bit WAV by default. All WAV outputs must include `-rf64 never` to force standard PCM (0x0001) — otherwise we'd create the very issue we're trying to fix.

**music-metadata ESM**: v11 is ESM-only. Loaded in main process via dynamic `import()` wrapper — never imported in renderer.

---

## Conversion Output Format Options (UI)

Presented to user in ConversionOptions panel before each conversion run:

| Option | Description shown in app |
|---|---|
| **AIFF 24-bit** | Lossless quality. Full metadata + artwork. Works on every CDJ from CDJ-900 onwards. Recommended for lossless sources. |
| **AIFF 16-bit** | Lossless quality with dithering applied. Universal compatibility including oldest hardware. Slightly smaller files. |
| **WAV 24-bit** | Lossless quality. Maximum compatibility but no native metadata/artwork on CDJs. |
| **WAV 16-bit** | Same as WAV 24-bit with dithering. Universal. |
| **MP3 320kbps** | Lossy compression. ~10× smaller than lossless. Indistinguishable in club environments. ID3v2.3 tags. CBR for CDJ compatibility. |

For "All CDJs" target mode, the UI recommends AIFF 16-bit with a tooltip explaining why.

---

## Rekordbox XML Integration

1. User imports `rekordbox.xml` (exported from rekordbox: File → Export Collection in xml format)
2. App parses XML using `fast-xml-parser`, builds `filePath → TRACK_element` map
3. Hot cues, loops, memory cues live in `POSITION_MARK` child elements of each `TRACK` — they are preserved untouched
4. App checks the rekordbox version string in XML header — warns if it detects 7.2.12 (known broken USB export bug)
5. After conversion, app rewrites `Location` attributes with new file paths, saves as `rekordbox_djcheck.xml`
6. User imports `rekordbox_djcheck.xml` back into rekordbox (File → Import Playlist → rekordbox xml)
7. App shows step-by-step instructions for this reimport process in a modal
8. Warn if any track has >8 hot cue POSITION_MARKs (export mode limit — user needs to know they'll lose cues 9-16)

---

## First-Run Experience

1. Splash screen (brief, invisible to most users) runs preflight: verifies ffmpeg binary is executable
2. If `onboardingComplete` is false in electron-store: show Onboarding page
3. Onboarding: animated cards for each CDJ model ("Which setup do you typically play on?") — CDJ-3000, CDJ-2000NXS2, CDJ-2000NXS, Older CDJs, All of the above
4. Selection saved to electron-store, onboarding never shown again
5. If preflight fails (very unlikely with bundled ffmpeg): error dialog with GitHub Issues link

---

## Build Sequence

**Stage 1 — Scaffold + core analysis** (WAV + AIFF binary inspection, basic UI, DropZone, TrackList, PlayerSelector)

**Stage 2 — Full format coverage** (MP3 frame inspection, M4A/ALAC/FLAC checks, all IssueTag types, "All CDJs" mode)

**Stage 3 — Conversion pipeline** (ffmpeg arg builder for all issue types, ConversionOptions UI, progress streaming, output folder logic, dithering)

**Stage 4 — Metadata + Rekordbox** (music-metadata tag passthrough, AIFF/ID3 tag writing, XML parse + rewrite, reimport guide modal)

**Stage 5 — Polish + packaging** (Onboarding, frameless window, electron-builder, asar unpack, auto-updater, DMG/NSIS/AppImage)

**Stage 6 — Tests** (vitest unit tests for all check functions with binary fixture files, integration tests)

---

## Critical Files

- `src/shared/ipc-types.ts` — must be created first; all types flow from here
- `src/main/audio/ffmpeg-setup.ts` — asar path resolution; must be correct or app is broken in production
- `src/main/audio/analyzer.ts` — core binary inspection (WAV format tag, AIFF chunk order, MP3 frame sync, Xing header)
- `src/main/audio/converter.ts` — ffmpeg command builder; must include `-rf64 never` on all WAV outputs
- `src/renderer/src/store/index.ts` — Zustand store drives all UI state
- `electron.vite.config.ts` — build config with `externalizeDepsPlugin` for main/preload
- `electron-builder.yml` — `asarUnpack` for ffmpeg binaries is non-negotiable

---

## Verification

1. `npm run dev` — hot-reloading dev server with Electron window
2. Drop a 32-bit float WAV → should show WAV_EXTENSIBLE or WAV_32BIT_FLOAT issue
3. Drop a FLAC → with CDJ-2000NXS target, should show FLAC_UNSUPPORTED
4. Fix FLAC → output folder should contain correctly formatted AIFF with all original tags
5. Import rekordbox.xml → after conversion, `rekordbox_djcheck.xml` should have updated paths but preserved POSITION_MARK elements
6. `npm run test` — vitest unit tests for each binary inspection check
7. `npm run package:mac` — build DMG; verify ffmpeg works from the packaged app (not just dev)
