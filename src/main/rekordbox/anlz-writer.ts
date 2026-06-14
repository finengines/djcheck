/**
 * anlz-writer.ts — Write Rekordbox ANLZ analysis files
 *
 * Ported from DjManager's anlzWriter.js to TypeScript.
 * Produces ANLZ0000.DAT, ANLZ0000.EXT, and ANLZ0000.2EX files
 * for Pioneer CDJ/XDJ hardware.
 *
 * ANLZ Binary Format Overview:
 *   - 28-byte PMAI file header
 *   - Followed by tagged sections, each with:
 *     FourCC(4) + len_header(u32BE) + len_tag(u32BE) + body
 *   - All multi-byte values are big-endian
 *
 * Section Order (critical — Rekordbox silently ignores data if order is wrong):
 *   DAT: PPTH → PVBR → PQTZ → PWAV → PWV2 → PCOB×2
 *   EXT: PPTH → PWV3 → PCOB×2 → PCO2×2 → PQT2 → PWV5 → PWV4
 *   2EX: PPTH → PWV7 → PWV6 → PWVC
 *
 * When converting files on a Rekordbox USB, we:
 *   1. Read the existing ANLZ files (preserving waveforms/cues/beats)
 *   2. Update ONLY the PPTH section (file path changes with new extension)
 *   3. Update the PVBR section (file size changes after conversion)
 *   4. Rewrite all three ANLZ files with updated sections
 *   5. Relocate the ANLZ directory to the new path hash
 */

import * as fs from 'fs'
import * as path from 'path'
import type { AnlzSection, AnlzFile, BeatEntry } from './types'

// ─── Low-level binary helpers (big-endian for ANLZ) ───────────────────────────

function u32BE(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(value >>> 0)
  return b
}

// @ts-ignore — utility kept for future waveform builders
function u16BE(value: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(value & 0xffff)
  return b
}

/** Encode a string as UTF-16BE with a 2-byte null terminator */
function stringToUTF16BE(str: string): Buffer {
  const buf = Buffer.alloc(str.length * 2 + 2)
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), i * 2)
  }
  // Last 2 bytes remain 0x0000 (null terminator)
  return buf
}

// ─── ANLZ file parsing ────────────────────────────────────────────────────────

/**
 * Parse an ANLZ file into its PMAI header and sections.
 * This is used to read existing ANLZ files so we can preserve
 * waveforms, cues, and beat grids when updating the file path.
 */
export function parseAnlzFile(filePath: string): AnlzFile {
  const raw = fs.readFileSync(filePath)
  return parseAnlzBuffer(raw)
}

/**
 * Parse an ANLZ file from a Buffer.
 */
export function parseAnlzBuffer(raw: Buffer): AnlzFile {
  // PMAI header: 28 bytes
  if (raw.length < 28) {
    throw new Error(`ANLZ file too small: ${raw.length} bytes`)
  }

  const magic = raw.toString('ascii', 0, 4)
  if (magic !== 'PMAI') {
    throw new Error(`Invalid ANLZ file: expected PMAI magic, got "${magic}"`)
  }

  const pmaiHeader = Buffer.from(raw.subarray(0, 28))
  const sections: AnlzSection[] = []

  let offset = 28
  while (offset < raw.length) {
    if (offset + 12 > raw.length) break

    const tag = raw.toString('ascii', offset, offset + 4)
    const lenHeader = raw.readUInt32BE(offset + 4)
    const lenTag = raw.readUInt32BE(offset + 8)

    if (lenTag < 12 || offset + lenTag > raw.length) {
      // Malformed section — stop parsing
      break
    }

    sections.push({
      tag,
      lenHeader,
      lenTag,
      raw: Buffer.from(raw.subarray(offset, offset + lenTag)),
    })

    offset += lenTag
  }

  return { pmaiHeader, sections }
}

/**
 * Find a section by its FourCC tag in an ANLZ file.
 */
export function findSection(anlz: AnlzFile, tag: string): AnlzSection | undefined {
  return anlz.sections.find((s) => s.tag === tag)
}

// ─── Section builders ──────────────────────────────────────────────────────────

function buildSection(fourcc: string, bodyBuf: Buffer, lenHeader: number): Buffer {
  const header = Buffer.alloc(12)
  header.write(fourcc, 0, 4, 'ascii')
  header.writeUInt32BE(lenHeader, 4)
  header.writeUInt32BE(bodyBuf.length + 12, 8)
  return Buffer.concat([header, bodyBuf])
}

/**
 * Build a PPTH (file path) section.
 * The path is encoded as UTF-16BE with a 2-byte null terminator.
 * len_header = 16: 12 common + 4 for len_path field.
 */
export function buildPathTag(usbFilePath: string): Buffer {
  const encoded = stringToUTF16BE(usbFilePath)
  // len_path includes the 2-byte null terminator
  const body = Buffer.concat([u32BE(encoded.length), encoded])
  return buildSection('PPTH', body, 16)
}

/**
 * Build a PVBR (Variable Bit Rate seek index) section.
 * Body: 4-byte unknown + 400 × u32BE byte-offsets.
 * Rekordbox requires this section in every DAT file.
 */
function buildPvbrSection(fileSize: number): Buffer {
  const ENTRIES = 400
  const body = Buffer.alloc(4 + ENTRIES * 4)
  body.writeUInt32BE(0, 0)
  const size = fileSize > 0 ? fileSize : 0
  for (let i = 0; i < ENTRIES; i++) {
    body.writeUInt32BE(Math.floor((i * size) / ENTRIES), 4 + i * 4)
  }
  return buildSection('PVBR', body, 16)
}

/**
 * Build a PQTZ beat grid section.
 * Beat entries: beatNumber(u16BE, 1-4) + tempo(u16BE, BPM*100) + time_ms(u32BE)
 * len_header = 24: 12 common + 12 section-specific fields.
 */
function buildBeatGrid(beats: BeatEntry[], bpm: number): Buffer {
  if (beats.length === 0) {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(0, 0)
    header.writeUInt32BE(0x80000, 4)
    header.writeUInt32BE(0, 8)
    return buildSection('PQTZ', header, 24)
  }

  const tempoU16 = Math.round((bpm || 128) * 100) & 0xffff

  const header = Buffer.alloc(12)
  header.writeUInt32BE(0, 0)
  header.writeUInt32BE(0x80000, 4)
  header.writeUInt32BE(beats.length, 8)

  const beatEntries = beats.map(({ beatNumber, tempo, time }) => {
    const entry = Buffer.alloc(8)
    entry.writeUInt16BE(beatNumber, 0)
    entry.writeUInt16BE(tempo ?? tempoU16, 2)
    entry.writeUInt32BE(time >>> 0, 4)
    return entry
  })

  return buildSection('PQTZ', Buffer.concat([header, ...beatEntries]), 24)
}

/**
 * Build a PQT2 section (extended beatgrid for Rekordbox 6+).
 * len_header=56. Body: entry_count × u16BE entries.
 */
function buildPqt2Section(beats: BeatEntry[], bpm: number): Buffer {
  const ec = beats.length
  const bodyLen = ec * 2

  const hdr = Buffer.alloc(56)
  hdr.write('PQT2', 0, 4, 'ascii')
  hdr.writeUInt32BE(56, 4)
  hdr.writeUInt32BE(56 + bodyLen, 8)
  hdr.writeUInt32BE(0x01000002, 16)

  const tempoU16 = Math.round((bpm || 128) * 100) & 0xffff

  if (ec > 0) {
    const first = beats[0]
    hdr.writeUInt16BE(first.beatNumber, 24)
    hdr.writeUInt16BE(tempoU16, 26)
    hdr.writeUInt32BE(first.time >>> 0, 28)

    const last = beats[ec - 1]
    hdr.writeUInt16BE(last.beatNumber, 32)
    hdr.writeUInt16BE(tempoU16, 34)
    hdr.writeUInt32BE(last.time >>> 0, 36)
  }

  hdr.writeUInt32BE(ec, 40)

  const body = Buffer.alloc(bodyLen)
  for (let i = 0; i < ec; i++) {
    body.writeUInt16BE(beats[i].time % 1000, i * 2)
  }

  return Buffer.concat([hdr, body])
}

// ─── PCOB/PCO2 stub sections ──────────────────────────────────────────────────
// Empty cue object stubs required by Rekordbox in every DAT and EXT file.

const PCOB1 = Buffer.from([
  0x50, 0x43, 0x4f, 0x42, 0x00, 0x00, 0x00, 0x18,
  0x00, 0x00, 0x00, 0x18, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
])

const PCOB2 = Buffer.from([
  0x50, 0x43, 0x4f, 0x42, 0x00, 0x00, 0x00, 0x18,
  0x00, 0x00, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
])

const PCO2_1 = Buffer.from([
  0x50, 0x43, 0x4f, 0x32, 0x00, 0x00, 0x00, 0x14,
  0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x00,
])

const PCO2_2 = Buffer.from([
  0x50, 0x43, 0x4f, 0x32, 0x00, 0x00, 0x00, 0x14,
  0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
])

// ─── Waveform section builders ────────────────────────────────────────────────
// These are used when generating new waveforms from audio (full export).
// When preserving existing ANLZ, we keep the original waveform sections.

function buildSectionWithBigHeader(fourcc: string, specificHeader: Buffer, data: Buffer): Buffer {
  const hdr = Buffer.alloc(24)
  hdr.write(fourcc, 0, 4, 'ascii')
  hdr.writeUInt32BE(24, 4)
  hdr.writeUInt32BE(24 + data.length, 8)
  specificHeader.copy(hdr, 12)
  return Buffer.concat([hdr, data])
}

// @ts-ignore — kept for future waveform section builders
function buildPwv3Section(pwv3Data: Buffer): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(pwv3Data.length, 4)
  header.writeUInt32BE(0x960000, 8)
  return buildSectionWithBigHeader('PWV3', header, pwv3Data)
}

// @ts-ignore — kept for future waveform section builders
function buildPwv5Section(pwv5Data: Buffer): Buffer {
  const numEntries = pwv5Data.length / 2
  const header = Buffer.alloc(12)
  header.writeUInt32BE(2, 0)
  header.writeUInt32BE(numEntries, 4)
  header.writeUInt32BE(0x00960305, 8)
  return buildSectionWithBigHeader('PWV5', header, pwv5Data)
}

// @ts-ignore — kept for future waveform section builders
function buildPwavSection(pwavData: Buffer): Buffer {
  const body = Buffer.alloc(8 + pwavData.length)
  body.writeUInt32BE(pwavData.length, 0)
  body.writeUInt32BE(0x00010000, 4)
  pwavData.copy(body, 8)
  return buildSection('PWAV', body, 20)
}

// @ts-ignore — kept for future waveform section builders
function buildPwv2Section(pwv2Data: Buffer): Buffer {
  const body = Buffer.alloc(8 + pwv2Data.length)
  body.writeUInt32BE(pwv2Data.length, 0)
  body.writeUInt32BE(0x00010000, 4)
  pwv2Data.copy(body, 8)
  return buildSection('PWV2', body, 20)
}

// @ts-ignore — kept for future waveform section builders
function buildPwv4Section(pwv4Data: Buffer): Buffer {
  const numEntries = pwv4Data.length / 6
  const header = Buffer.alloc(12)
  header.writeUInt32BE(6, 0)
  header.writeUInt32BE(numEntries, 4)
  header.writeUInt32BE(0x00000000, 8)
  return buildSectionWithBigHeader('PWV4', header, pwv4Data)
}

// @ts-ignore — kept for future waveform section builders
function buildPwv7Section(pwv7Data: Buffer, numCols: number): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt32BE(3, 0)
  header.writeUInt32BE(numCols, 4)
  header.writeUInt32BE(0x00960000, 8)
  return buildSectionWithBigHeader('PWV7', header, pwv7Data)
}

// @ts-ignore — kept for future waveform section builders
function buildPwv6Section(pwv6Data: Buffer): Buffer {
  const hdr = Buffer.alloc(20)
  hdr.write('PWV6', 0, 4, 'ascii')
  hdr.writeUInt32BE(20, 4)
  hdr.writeUInt32BE(20 + pwv6Data.length, 8)
  hdr.writeUInt32BE(3, 12)
  hdr.writeUInt32BE(1200, 16)
  return Buffer.concat([hdr, pwv6Data])
}

function buildPwvcSection(): Buffer {
  const buf = Buffer.alloc(20)
  buf.write('PWVC', 0, 4, 'ascii')
  buf.writeUInt32BE(14, 4)
  buf.writeUInt32BE(20, 8)
  buf.writeUInt16BE(0x0064, 14)
  buf.writeUInt16BE(0x0068, 16)
  buf.writeUInt16BE(0x00c5, 18)
  return buf
}

// ─── PMAI file header ─────────────────────────────────────────────────────────

function buildPmaiHeader(totalSize: number): Buffer {
  const buf = Buffer.alloc(28)
  buf.write('PMAI', 0, 4, 'ascii')
  buf.writeUInt32BE(0x1c, 4)
  buf.writeUInt32BE(totalSize, 8)
  buf.writeUInt32BE(0x00000001, 12)
  buf.writeUInt32BE(0x00010000, 16)
  buf.writeUInt32BE(0x00010000, 20)
  buf.writeUInt32BE(0x00000000, 24)
  return buf
}

// ─── ANLZ assembly helpers ─────────────────────────────────────────────────────

/**
 * Assemble an ANLZ file from a PMAI header and ordered sections.
 */
function assembleAnlz(sections: Buffer[]): Buffer {
  const bodySize = sections.reduce((s, b) => s + b.length, 0)
  const totalSize = 28 + bodySize
  return Buffer.concat([buildPmaiHeader(totalSize), ...sections])
}

// ─── Public API: Full ANLZ write (new export) ─────────────────────────────────

/**
 * Write all three ANLZ files for a track with newly generated waveforms.
 * Used during full USB export (not preservation mode).
 */
export async function writeAnlz(opts: {
  usbFilePath: string
  sourceFilePath: string
  beatgrid?: string
  bpm: number
  usbRoot: string
  ffmpegPath?: string
}): Promise<string> {
  const { usbFilePath, bpm, usbRoot } = opts

  const { getFolderName } = await import('./path-hash')
  const folderHash = getFolderName(usbFilePath)
  const anlzDir = path.join(usbRoot, 'PIONEER', 'USBANLZ', folderHash)
  fs.mkdirSync(anlzDir, { recursive: true })

  // Parse beats from beatgrid JSON
  const beats = parseBeatsFromJson(opts.beatgrid, bpm)

  // Get file size for PVBR
  let audioFileSize = 0
  try { audioFileSize = fs.statSync(opts.sourceFilePath).size } catch { /* */ }

  // ── ANLZ0000.DAT ──
  const datSections = [
    buildPathTag(usbFilePath),
    buildPvbrSection(audioFileSize),
    buildBeatGrid(beats, bpm),
    PCOB1,
    PCOB2,
  ]
  fs.writeFileSync(path.join(anlzDir, 'ANLZ0000.DAT'), assembleAnlz(datSections))

  // ── ANLZ0000.EXT ──
  const extSections = [
    buildPathTag(usbFilePath),
    PCOB1,
    PCOB2,
    PCO2_1,
    PCO2_2,
    buildPqt2Section(beats, bpm),
  ]
  fs.writeFileSync(path.join(anlzDir, 'ANLZ0000.EXT'), assembleAnlz(extSections))

  return anlzDir
}

// ─── Public API: Preserve ANLZ during USB conversion ──────────────────────────

/**
 * Update ANLZ files for a track when its file path has changed (e.g. .flac → .aiff).
 *
 * This preserves ALL existing metadata (waveforms, cues, beat grids) by:
 *   1. Reading the existing ANLZ files
 *   2. Replacing ONLY the PPTH (path) section with the new path
 *   3. Replacing ONLY the PVBR (seek index) section with updated file size
 *   4. Writing the updated ANLZ files to the new hash directory
 *   5. Deleting the old ANLZ directory
 *
 * @param oldAnlzDir - Absolute path to the existing ANLZ directory
 * @param newUsbPath - New USB-relative path (e.g. "/music/track.aiff")
 * @param newAnlzDir - Absolute path to the new ANLZ directory
 * @param newFileSize - Size of the converted audio file (for PVBR)
 */
export function updateAnlzForPathChange(
  oldAnlzDir: string,
  newUsbPath: string,
  newAnlzDir: string,
  newFileSize: number
): void {
  const newPpth = buildPathTag(newUsbPath)
  const newPvbr = buildPvbrSection(newFileSize)

  fs.mkdirSync(newAnlzDir, { recursive: true })

  // Process each ANLZ file type
  const fileTypes = [
    { name: 'ANLZ0000.DAT', needsPvbr: true },
    { name: 'ANLZ0000.EXT', needsPvbr: false },
    { name: 'ANLZ0000.2EX', needsPvbr: false },
  ]

  for (const { name, needsPvbr } of fileTypes) {
    const srcPath = path.join(oldAnlzDir, name)
    if (!fs.existsSync(srcPath)) continue

    const anlz = parseAnlzFile(srcPath)
    const updatedSections: Buffer[] = []

    for (const section of anlz.sections) {
      if (section.tag === 'PPTH') {
        // Replace with new path
        updatedSections.push(newPpth)
      } else if (section.tag === 'PVBR' && needsPvbr) {
        // Replace with updated seek index
        updatedSections.push(newPvbr)
      } else {
        // Preserve original section verbatim (waveforms, cues, beats, etc.)
        updatedSections.push(section.raw)
      }
    }

    // Write updated file to new location
    const destPath = path.join(newAnlzDir, name)
    fs.writeFileSync(destPath, assembleAnlz(updatedSections))
  }

  // Remove old ANLZ directory if it's different from the new one
  if (oldAnlzDir !== newAnlzDir) {
    try {
      fs.rmSync(oldAnlzDir, { recursive: true, force: true })
    } catch {
      // Non-fatal: old directory may be left behind, but new files are correct
    }
  }
}

// ─── Beat parsing helpers ──────────────────────────────────────────────────────

/**
 * Parse beats from a beatgrid JSON string (from mixxx-analyzer or PDB).
 */
function parseBeatsFromJson(beatgridJson: string | undefined, bpm: number): BeatEntry[] {
  let beats: BeatEntry[] = []

  try {
    if (beatgridJson) {
      const raw = typeof beatgridJson === 'string' ? JSON.parse(beatgridJson) : beatgridJson

      if (Array.isArray(raw) && raw.length > 0) {
        if (typeof raw[0] === 'number') {
          beats = raw.map((t: number, i: number) => ({
            beatNumber: (i % 4) + 1,
            tempo: Math.round(bpm * 100) & 0xffff,
            time: Math.round(t * 1000),
          }))
        } else if (typeof raw[0] === 'object') {
          beats = raw.map((b: Record<string, unknown>, i: number) => ({
            beatNumber: (i % 4) + 1,
            tempo: Math.round(bpm * 100) & 0xffff,
            time: Math.round(((b.position ?? b.time ?? b.offset ?? 0) as number) * 1000),
          }))
        }
      }
    }
  } catch {
    // Fall through to mathematical generation
  }

  if (beats.length === 0 && bpm > 0) {
    beats = generateBeatsFromBpm(bpm)
  }

  return beats
}

function generateBeatsFromBpm(bpm: number, maxSeconds = 600): BeatEntry[] {
  const intervalMs = 60000 / bpm
  const maxBeats = Math.floor((maxSeconds * 1000) / intervalMs)
  const beats: BeatEntry[] = []
  const tempoU16 = Math.round(bpm * 100) & 0xffff
  for (let i = 0; i < maxBeats; i++) {
    beats.push({
      beatNumber: (i % 4) + 1,
      tempo: tempoU16,
      time: Math.round(i * intervalMs),
    })
  }
  return beats
}
