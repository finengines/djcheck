# DJCheck

**Scan your music library for Pioneer CDJ compatibility issues — and fix them automatically.**

DJCheck is a desktop app that analyses your audio files (WAV, AIFF, MP3, FLAC, AAC) and checks whether they'll play correctly on Pioneer CDJ players. It detects a wide range of compatibility issues and can auto-fix them with one click — no re-encoding required for many common problems.

## Features

- **Instant compatibility scanning** — drag & drop files or folders, get results in seconds
- **Multiple CDJ models** — checks against CDJ-2000, CDJ-2000NXS, CDJ-2000NXS2, CDJ-3000, or "All CDJs" for maximum compatibility
- **One-click auto-fix** — converts files to CDJ-compatible formats using ffmpeg with metadata preservation
- **Lossless header patches** — WAV extensible header issues fixed with a 2-byte patch (no re-encoding!)
- **MP3 passthrough** — MP3 sources stay as MP3, never wastefully transcoded to lossless
- **Folder tree preservation** — output maintains your original folder structure
- **Rekordbox XML support** — import your rekordbox library to preserve hot cues and loops
- **Batch processing** — scan and fix hundreds of tracks at once
- **Dark theme** — designed for late-night studio sessions

## Supported CDJ Models

| Model | Max Sample Rate | FLAC | ALAC | Notes |
|-------|----------------|------|------|-------|
| CDJ-2000 / CDJ-900 / CDJ-850 / CDJ-400 / CDJ-350 | 48 kHz | ✗ | ✗ | Most restrictive |
| CDJ-2000NXS / XDJ-1000 | 48 kHz | ✗ | ✗ | |
| CDJ-2000NXS2 / XDJ-1000MK2 | 96 kHz | ✗ | ✓ | ALAC supported |
| CDJ-3000 / CDJ-3000X | 96 kHz | ✓ | ✓ | FLAC from fw 1.20+ |
| All CDJs (widest compatibility) | 48 kHz | ✗ | ✗ | Most restrictive rules |

## Compatibility Checks

DJCheck performs the following checks on your audio files:

### WAV
| Check | Code | Severity | Auto-fix | Description |
|-------|------|----------|----------|-------------|
| WAVE_FORMAT_EXTENSIBLE (PCM subformat) | E-8305 | Error | ✓ lossless | 2-byte header patch — instant fix, no re-encoding |
| WAVE_FORMAT_EXTENSIBLE (other subformat) | E-8305 | Error | ✓ | Requires re-encoding |
| 32-bit float encoding | E-8304 | Error | ✓ | No CDJ supports float — must re-encode |
| 32-bit integer encoding | E-8305 | Error | ✓ | CDJs require 16 or 24-bit |
| 8-bit encoding | E-8305 | Error | ✓ | CDJs require 16 or 24-bit |
| RF64 format (>4 GB) | E-8304 | Error | ✗ | No CDJ supports RF64 |
| Broadcast WAV (BWF/bext chunk) | WARNING | Warning | ✓ | May cause issues on older CDJ-2000 |
| Sample rate too high | E-8305 | Error | ✓ | Model-dependent max |
| Sample rate too low | E-8305 | Error | ✓ | CDJs require ≥44.1 kHz |
| Multichannel (>2 channels) | E-8305 | Error | ✓ | CDJs require stereo |
| Mono (1 channel) | WARNING | Warning | ✓ | May work but behaviour varies |
| Corrupt header | E-8304 | Error | ✓ | |
| Unsupported format tag | E-8304 | Error | ✗ | |
| File too large (>2 GB) | WARNING | Warning | ✗ | FAT32 USB limit is 4 GB |

### AIFF
| Check | Code | Severity | Auto-fix | Description |
|-------|------|----------|----------|-------------|
| Wrong chunk order (SSND before COMM) | E-8302 | Error | ✓ lossless | COMM must come first for NXS CDJs |
| AIFC container (NONE/sowt/twos) | WARNING | Warning | ✓ | Some CDJs reject AIFC entirely |
| Compressed codec (ALAW/µ-law/IMA ADPCM) | E-8304 | Error | ✓ | CDJs require uncompressed PCM |
| Unknown AIFF-C codec | E-8304 | Error | ✓ | |
| Sample rate too high/low | E-8305 | Error | ✓ | |
| 8-bit / 32-bit depth | E-8305 | Error | ✓ | |
| Multichannel / Mono | E-8305 / WARNING | Error/Warning | ✓ | |
| File too large (>2 GB) | WARNING | Warning | ✗ | |

### MP3
| Check | Code | Severity | Auto-fix | Description |
|-------|------|----------|----------|-------------|
| Not Layer 3 | E-8302 | Error | ✗ | |
| Invalid / MPEG-2 sample rate | E-8305 | Error | ✓ | CDJ-3000 requires MPEG-1 rates |
| Corrupt or non-ISO frames | E-8302 / WARNING | Error/Warning | ✓ | |
| VBR without Xing/LAME header | E-8306 | Error | ✓ lossless | Fixes seek/cue accuracy |
| ID3v2.4 tags | WARNING | Warning | ✓ | CDJ-3000/rekordbox prefer v2.3 |
| ID3v1 only (no ID3v2) | WARNING | Warning | ✗ | Limited metadata support |

### FLAC / AAC / ALAC / OGG
| Check | Code | Severity | Auto-fix | Description |
|-------|------|----------|----------|-------------|
| FLAC unsupported (non-CDJ-3000) | E-8305 | Error | ✓ | Convert to AIFF/WAV |
| FLAC high sample rate | E-8305 | Error | ✓ | CDJ-3000 FLAC limited to 44.1/48 kHz |
| ALAC unsupported (pre-NXS2) | E-8305 | Error | ✓ | |
| DRM-protected AAC (.m4p) | E-8305 | Error | ✗ | |
| OGG Vorbis | UNSUPPORTED | Error | ✓ | No CDJ support |

### General
| Check | Code | Severity | Description |
|-------|------|----------|-------------|
| Path too long (>255 chars) | E-8306 | Error | DJ LINK path limit |
| Non-ASCII filename | WARNING | Warning | Display/sorting may be affected |
| PNG artwork | WARNING | Warning | CDJs prefer JPEG artwork |

## Installation

### Download

Download the latest release from the [Releases](https://github.com/finengines/djcheck/releases) page.

- **macOS**: Download the `.dmg` file. Drag DJCheck to Applications.
- **Windows**: Download the `.exe` installer.
- **Linux**: Download the `.AppImage` file. Make it executable: `chmod +x DJCheck-*.AppImage`

### Prerequisites

- **ffmpeg**: Required for audio conversion. DJCheck includes ffmpeg-static, so no separate installation is needed.

## Usage

1. **Open DJCheck** — the app will show an onboarding screen on first launch
2. **Select your CDJ model** — choose the model you'll be playing on, or "All CDJs" for maximum compatibility
3. **Drop files or folders** — drag audio files onto the window, or use File → Open Files / Open Folder
4. **Review results** — each track shows its compatibility status with detailed issue descriptions
5. **Fix issues** — select tracks with errors and click "Fix" to auto-convert them
6. **Choose output** — save to a subfolder, custom folder, or replace originals

### Output Formats

- **AIFF 24-bit** — recommended. Lossless, full metadata/artwork support, universal CDJ compatibility
- **AIFF 16-bit** — lossless with dithering. Widest compatibility.
- **WAV 24-bit** — lossless, but no artwork display on CDJs
- **WAV 16-bit** — lossless with dithering. Universal.
- **MP3 320kbps** — lossy, smallest files. ID3v2.3 tags.

**Note**: MP3 source files always stay as MP3 regardless of your output format selection.

## Development

### Tech Stack

- **Electron** — cross-platform desktop app framework
- **React** — renderer UI
- **TypeScript** — type-safe codebase
- **Vite** — fast bundling (via electron-vite)
- **Tailwind CSS** — utility-first styling
- **Zustand + Immer** — state management
- **fluent-ffmpeg** — audio conversion
- **music-metadata** — metadata parsing
- **electron-store** — persistent settings
- **Vitest** — unit testing

### Setup

```bash
# Clone the repo
git clone https://github.com/finengines/djcheck.git
cd djcheck

# Install dependencies
npm install

# Start in development mode
npm run dev

# Run tests
npx vitest run

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

### Building

```bash
# Build for production
npm run build

# Platform-specific builds
npm run build:mac    # macOS (dmg, x64 + arm64)
npm run build:win    # Windows (nsis, x64)
npm run build:linux  # Linux (AppImage, x64)
```

### Project Structure

```
src/
├── main/              # Electron main process
│   ├── audio/         # Audio analysis & conversion
│   │   ├── analyzer.ts    # Format detection & compatibility checks
│   │   ├── converter.ts   # ffmpeg conversion logic
│   │   └── rekordbox.ts   # rekordbox.xml parsing
│   ├── ipc/           # IPC handlers
│   ├── setup/         # Preflight checks
│   └── index.ts       # Main entry point
├── preload/           # Context bridge (secure API)
├── renderer/          # React UI
│   ├── components/    # UI components
│   ├── pages/         # Page-level components
│   ├── store/         # Zustand state management
│   └── styles/        # Global CSS
└── shared/            # Types shared between processes
    └── ipc-types.ts   # IPC channels & type definitions
```

### Architecture

DJCheck follows Electron's security best practices:

- **Context isolation** enabled — renderer has no direct Node.js access
- **No nodeIntegration** — all Node.js APIs go through the preload context bridge
- **IPC channels** — typed communication between main and renderer processes

The analysis pipeline:
1. Files are dropped/selected in the renderer
2. File paths sent to main process via IPC
3. Main process reads binary headers (first 64 KB) of each file
4. Format-specific parsers extract metadata and detect issues
5. Results streamed back to renderer as each file completes
6. User reviews issues and optionally triggers conversion
7. Conversion uses ffmpeg with carefully constructed arguments per issue type

## Contributing

Contributions are welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run tests before committing (`npx vitest run`)
4. Commit with descriptive messages
5. Open a pull request

### Adding New Compatibility Checks

1. Add detection logic to the appropriate parsing function in `src/main/audio/analyzer.ts`
2. Add the check to the corresponding `check*` function
3. Use existing error codes (E-8302, E-8304, E-8305, E-8306, WARNING, UNSUPPORTED)
4. Add unit tests in `test/unit/analyzer.test.ts`
5. If auto-fixable, add conversion logic to `src/main/audio/converter.ts`

## License

MIT

## Acknowledgments

- Built with [electron-vite](https://electron-vite.org/)
- Audio conversion via [ffmpeg](https://ffmpeg.org/)
- Inspired by the community discussion around [Pioneer DJ file format issues](https://github.com/joeselway/Pioneer-DJ-File-Formats)
