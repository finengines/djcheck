# DJ Track Preparation Toolkit — Research Document

> What do DJs actually struggle with? What tools exist? What could DJCheck become?

---

## Executive Summary

DJCheck currently solves **CDJ compatibility checking & fixing**. But DJs face a much broader set of track preparation pain points. This research identifies the highest-value features we could add to turn DJCheck into a **track preparation toolkit** — a one-stop shop for getting tracks gig-ready.

**Excluded from scope:** BPM detection, key detection, harmonic mixing (Mixed In Key owns this space and does it excellently).

---

## Pain Points Ranked by Frequency & Severity

### 1. 🔊 Loudness Normalization (PRIORITY: HIGH)
**The #1 complaint across all DJ forums.**

**The problem:**
- Tracks come from different sources (Beatport, Bandcamp, ripped, promo) with wildly different loudness levels
- DJs constantly reach for gain/trim knobs between tracks
- Older tracks (pre-loudness wars) are significantly quieter than modern masters
- Peak normalization doesn't solve it — a track with a loud transient but quiet average will still sound quieter
- Long quiet intros cause RMS-based normalizers to over-adjust

**Current solutions & their limitations:**
| Tool | Price | Limitation |
|------|-------|------------|
| **Platinum Notes** (Mixed In Key) | $98 | Controversial — some say it's "snake oil." Applies compression/limiting that can alter the original sound. Closed source. |
| **GainSync** | €15 | Smart (LUFS + structure analysis to detect drops), but Windows-only, closed source, solo developer |
| **MP3Gain** | Free | Only works on MP3, uses ReplayGain (album gain), doesn't understand track structure |
| **StraightSet** (Platone Studio) | ~€30 | Preserves dynamics but new/unknown |
| **Serato Auto Gain** | Built-in | Writes gain to ID3 but only works within Serato |
| **Wavelab Pro Batch Normalizer** | $100+ | Overkill for DJs, expensive |
| **Audacity** | Free | Manual, no batch processing |

**What GainSync does right (our benchmark):**
- Analyzes track **structure** to find drops/loudest sections
- Uses **LUFS** (not peak, not RMS) — matches human perception
- Normalizes so that the **drops hit equally loud** across tracks
- Supports WAV, MP3, FLAC, OGG
- Can normalize directly on USB drives
- Preserves metadata

**What we could build:**
- LUFS-based loudness analysis (ffmpeg has `loudnorm` filter)
- Structure-aware normalization: detect the loudest ~30 seconds (the "drop"), normalize based on that
- Batch processing across entire folders
- Target LUFS adjustable (e.g., -9 LUFS for club, -14 LUFS for streaming sets)
- Non-destructive option: write ReplayGain tags instead of modifying audio
- Preview before/after
- Already have ffmpeg pipeline — this extends naturally

**Feasibility: HIGH** — ffmpeg's `loudnorm` filter does LUFS measurement natively. We just need smart segment detection for the "drop-based" normalization.

---

### 2. 🏷️ Metadata & Tag Cleanup (PRIORITY: HIGH)
**Extremely common complaint, especially for DJs with large libraries.**

**The problem:**
- Tracks from different sources have inconsistent/missing tags
- Artist name formats vary ("Artist feat. Vocalist" vs "Artist ft. Vocalist" vs "Artist (feat. Vocalist)")
- Missing or embedded artwork (PNG artwork doesn't display on some CDJs — only JPEG)
- Capitalisation inconsistencies ("track name" vs "Track Name" vs "TRACK NAME")
- Genre tags are inconsistent or missing
- Year/release date missing
- Comments field used differently by every source

**Current solutions:**
| Tool | Price | Notes |
|------|-------|-------|
| **Mp3tag** | Free (Win) | The gold standard. Batch editing, web sources for metadata. But Windows-only (Mac via Wine). |
| **Meta** (Nightbirdsevolve) | $20 | Mac-native. Good but niche. |
| **OneTagger** | Free | Multi-platform, auto-tagging from multiple sources. Good for DJs. |
| **Lexicon DJ** | $17/mo | Does metadata + library management but subscription-based and heavy. |
| **beets** | Free | Open source CLI, powerful but very technical. |
| **Picard** (MusicBrainz) | Free | Great for albums, less DJ-focused. |

**What we could build:**
- **Tag cleanup rules engine:**
  - Fix capitalisation (Title Case, Sentence case)
  - Standardise artist name format
  - Strip/fix featuring artist formatting
  - Remove junk characters, fix encoding issues
  - Genre normalisation ("Hip-Hop" → "Hip Hop", "House " → "House")
- **Artwork management:**
  - Detect missing artwork
  - Detect PNG artwork (CDJ compatibility issue we already flag)
  - Batch convert PNG → JPEG artwork
  - Resize oversized artwork (some CDJs choke on >500KB artwork)
- **Filename ↔ tag sync:**
  - Rename files from tags: `Artist - Title.mp3`
  - Or populate tags from filename
- **Duplicate detection:**
  - Find same track in different formats/qualities
  - Identify the highest quality version
  - Flag duplicates across library

**Feasibility: MEDIUM-HIGH** — We already parse tags. `music-metadata` (already a dependency) handles reading/writing. Artwork manipulation needs `sharp` or similar.

---

### 3. ✂️ Intro/Outro Trimming & Silence Removal (PRIORITY: MEDIUM-HIGH)
**Frequently requested, especially for DJs who prep USB sticks.**

**The problem:**
- Many tracks have 2-8 seconds of silence at the start or end
- CDJ auto-cue handles this on playback, but:
  - Some older CDJs don't auto-cue well
  - Silence wastes USB space and scroll time when browsing
  - Some tracks have quiet intros that get skipped by auto-cue
- DJs want consistent "ready to mix" intros/outros

**Current solutions:**
| Tool | Notes |
|------|-------|
| **MPTrim** | Windows-only, old, batch support |
| **Audacity** | Manual only |
| **VirtualDJ** | Has auto-cue but doesn't edit files |
| **DJ.Studio** | Can trim but it's a full DAW-like app, subscription |

**What we could build:**
- **Batch silence detection & trimming:**
  - Detect leading/trailing silence (configurable threshold, e.g., -60dB)
  - Trim with configurable padding (e.g., keep 200ms of silence for clean start)
  - Add fade-in/fade-out at trim points to avoid clicks
- **Long intro shortener** (more advanced):
  - Detect the first downbeat
  - Option to trim to first downbeat for quick mixing
- Non-destructive option: just report the silence duration so DJs know

**Feasibility: MEDIUM** — ffmpeg can detect silence (`silencedetect` filter) and trim (`atrim` filter). Need careful handling to avoid cutting into actual audio.

---

### 4. 🎵 File Format Conversion & Quality Assurance (DONE — this is DJCheck's core)
Already implemented. Just noting for completeness.

---

### 5. 📁 Library Health & Cleanup (PRIORITY: MEDIUM)
**Pain point for DJs with growing libraries.**

**The problem:**
- Corrupt files that play fine on laptop but fail on CDJs
- Missing files (moved/deleted outside DJ software)
- Broken file paths after reorganising folders
- Low-quality files mixed in with high-quality ones
- Duplicate tracks eating storage

**What we could build:**
- **Library health report:**
  - Scan for corrupt/unreadable files
  - Detect low bitrate files (<192kbps MP3)
  - Find files with missing or incomplete tags
  - Identify orphaned files (not in any playlist)
- **Storage analysis:**
  - Show format breakdown (% MP3 vs FLAC vs WAV etc.)
  - Find largest files
  - Calculate total library size
- **Duplicate finder:**
  - Audio fingerprinting (or simpler: match on artist+title+duration)
  - Show quality comparison between duplicates
  - Recommend which to keep

**Feasibility: MEDIUM** — Most of this is metadata analysis. Audio fingerprinting would require additional libraries.

---

### 6. 🔧 Rekordbox/Library XML Repair (PRIORITY: MEDIUM)
**Niche but very painful when it happens.**

**The problem:**
- Rekordbox XML databases corrupt frequently
- Engine DJ databases get corrupted on USB removal
- Switching between DJ software loses cue points, playlists, etc.
- Moving files breaks path references

**Current solutions:**
| Tool | Notes |
|------|-------|
| **Lexicon DJ** | Cross-platform library sync ($17/mo subscription) |
| **rekordbox-library-fixer** | Open source, Rekordbox XML only |
| **rekordbox** built-in | Limited recovery options |

**What we could build:**
- **XML repair tool:**
  - Validate Rekordbox XML structure
  - Fix broken file paths (find-and-replace based)
  - Remove entries pointing to missing files
  - Repair corrupted XML syntax
- **Cross-library export:**
  - Export our analysis results in Rekordbox XML format
  - Import Rekordbox XML and cross-reference with our analysis

**Feasibility: MEDIUM** — We already parse Rekordbox XML. Repair is mostly path-fixing and validation.

---

### 7. 🎧 Waveform Preview Generation (PRIORITY: LOW-MEDIUM)
**Nice to have for USB-only DJs.**

**The problem:**
- Some standalone players show waveforms only after analysis on the device
- Analysing on-device is slow, especially for large libraries
- Pre-generated waveforms load instantly

**What we could build:**
- Generate overview waveform data files (Serato uses `.overview` files, Rekordbox uses its own format)
- This is probably too format-specific to be broadly useful

**Feasibility: LOW** — Format-specific, limited value vs complexity.

---

### 8. 🔀 Stem Separation (PRIORITY: LOW — future consideration)
**Cool but complex.**

**The problem:**
- DJs want acapellas/instrumentals for mashups
- Currently requires separate software (Spleeter, StemRoller, DJ.Studio)

**Open source options:**
- **Spleeter** (Deezer) — Python, open source, good quality
- **Demucs** (Meta) — Better quality than Spleeter, also open source
- **StemRoller** — Electron app wrapping Demucs

**Why LOW priority:**
- Computationally heavy (GPU recommended)
- Not strictly "track preparation" — more creative tool
- Good standalone tools already exist
- Would bloat the app significantly

**Feasibility: LOW for now** — Could be a separate mode/module in the future.

---

## Recommended Implementation Order

### Phase 1: Loudness Normalization (THE PLATINUM NOTES KILLER)
This is the biggest gap in the open source DJ tooling market. GainSync proves demand at €15 — we could offer it free and open source.

**Technical approach:**
1. Use ffmpeg's `loudnorm` filter for LUFS measurement (two-pass: measure, then normalize)
2. Implement structure-aware detection: scan for the loudest sustained section (the "drop")
3. Normalize based on drop loudness, not whole-track average
4. Support batch processing with progress
5. Target LUFS presets: Club (-9), Streaming (-14), Custom
6. Output format: same as input, or convert (leveraging existing converter)
7. ReplayGain tag writing as non-destructive alternative

**UI:**
- New section in the sidebar or a separate "Tools" tab
- Drag folder → analyse loudness → see LUFS per track → normalize

### Phase 2: Metadata Cleanup
**Technical approach:**
1. Batch tag reading/writing with `music-metadata`
2. Rules engine for capitalisation, artist format, genre normalisation
3. Artwork: detect format, convert PNG→JPEG, resize
4. Duplicate detection via artist+title+duration matching

**UI:**
- Tag editor panel (like Mp3tag but simpler, built into DJCheck)
- One-click cleanup rules

### Phase 3: Silence Trimming
**Technical approach:**
1. ffmpeg `silencedetect` for analysis
2. ffmpeg `atrim` + `afade` for trimming with fade
3. Batch mode

### Phase 4: Library Health Report
- Extend existing analysis with quality metrics
- Storage breakdown view
- Duplicate finder

---

## Existing Tools Landscape (Competitive Analysis)

| Tool | Price | What it does | What it's missing |
|------|-------|-------------|-------------------|
| **DJCheck** | Free/OSS | CDJ compatibility checking | Everything else on this list |
| **Platinum Notes** | $98 | Loudness, EQ, limiting | Closed source, controversial quality, no compatibility checking |
| **GainSync** | €15 | LUFS loudness normalization | Windows only, no other features |
| **Lexicon DJ** | $17/mo | Library management, sync, metadata | Subscription model, not local-first |
| **Mp3tag** | Free | Tag editing | Windows only, not DJ-specific |
| **OneTagger** | Free | Auto-tagging | No loudness, no compatibility |
| **DJDuplicateCleaner** | $10 | Duplicate removal | Single-purpose |
| **DJ.Studio** | $20+/mo | Mix preparation, stems | Subscription, heavy, not batch |

**Our opportunity:** Nobody offers an **open source, cross-platform, local-first** tool that combines:
1. ✅ CDJ compatibility checking (we have this)
2. Loudness normalization (Platinum Notes alternative)
3. Metadata cleanup
4. Silence trimming
5. Library health

This would be the **"FFmpeg of DJ track preparation."**

---

## Technical Notes

### LUFS Measurement with FFmpeg
```bash
# First pass: measure
ffmpeg -i track.mp3 -af loudnorm=I=-9:TP=-1:LRA=11:print_format=json -f null -

# Second pass: apply (using measured values)
ffmpeg -i track.mp3 -af loudnorm=I=-9:TP=-1:LRA=11:measured_I=-12.3:measured_LRA=8.2:measured_TP=-0.5:measured_thresh=-22.4:offset=3.2:linear=true -c:a libmp3lame -b:a 320k output.mp3
```

### Silence Detection with FFmpeg
```bash
ffmpeg -i track.mp3 -af silencedetect=noise=-50dB:d=0.5 -f null -
```

### Drop Detection Algorithm (Conceptual)
1. Compute LUFS in sliding windows (e.g., 5-second windows, 1-second hop)
2. Find the window with highest LUFS → this is the "drop"
3. Normalize so that this section hits the target LUFS
4. This ensures all drops hit equally hard regardless of intro/outro dynamics

### Metadata Writing
We already use `music-metadata` for reading. It supports writing too:
```typescript
import { parseFile, selectCover } from 'music-metadata'
// Reading already works
// Writing: need to check if music-metadata supports writing for our formats
```

---

## Open Questions for Fin

1. **Loudness approach:** Drop-based normalization (like GainSync) or whole-track LUFS? Or both as options?
2. **Non-destructive mode:** Should we offer ReplayGain tag writing (no audio modification) as an option alongside actual file modification?
3. **Metadata:** How deep do we go? Just cleanup rules, or full tag editing UI?
4. **Stems:** Worth investigating for a future version, or skip entirely?
5. **UI structure:** Separate "tools" area in the app, or integrate into the existing analysis flow?
6. **Library management:** Do we want to become a Lexicon competitor, or stay focused on file-level tools?

---

*Research compiled: 2026-04-27*
*Branch: feature/track-prep-toolkit*
