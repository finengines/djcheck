import * as fs from 'fs/promises'
import * as path from 'path'
import type { TrackAnalysis, AudioIssue, CDJModel, AudioFormat, IssueSeverity } from '../../shared/ipc-types'

// CDJ model capability matrix
export interface ModelCaps {
  maxSampleRate: number
  minSupportedSampleRates: number[]
  supportsFlac: boolean
  supportsAlac: boolean
  strictMp3: boolean
}

export const MODEL_CAPS: Record<CDJModel, ModelCaps> = {
  'cdj-2000': {
    maxSampleRate: 48000,
    minSupportedSampleRates: [44100, 48000],
    supportsFlac: false,
    supportsAlac: false,
    strictMp3: false,
  },
  'cdj-2000nxs': {
    maxSampleRate: 48000,
    minSupportedSampleRates: [44100, 48000],
    supportsFlac: false,
    supportsAlac: false,
    strictMp3: false,
  },
  'cdj-2000nxs2': {
    maxSampleRate: 96000,
    minSupportedSampleRates: [44100, 48000, 88200, 96000],
    supportsFlac: false,
    supportsAlac: true,
    strictMp3: false,
  },
  'cdj-3000': {
    maxSampleRate: 96000,
    minSupportedSampleRates: [44100, 48000, 88200, 96000],
    supportsFlac: true,
    supportsAlac: true,
    strictMp3: true,
  },
  'all': {
    // Most restrictive: target oldest hardware
    maxSampleRate: 48000,
    minSupportedSampleRates: [44100, 48000],
    supportsFlac: false,
    supportsAlac: false,
    strictMp3: true, // Use CDJ-3000 strictness
  },
}

// Valid MPEG sample rates (ISO 11172-3 / 13818-3)
const MPEG1_RATES = new Set([32000, 44100, 48000])
const MPEG2_RATES = new Set([16000, 22050, 24000])
const ALL_MPEG_RATES = new Set([...MPEG1_RATES, ...MPEG2_RATES])

// Low sample rates that CDJs reject
const LOW_SAMPLE_RATES = new Set([8000, 11025, 11000, 16000, 22050, 24000, 32000])

// Widely unsupported high sample rates
const HIGH_SAMPLE_RATES = new Set([88200, 96000, 176400, 192000])

function issue(
  code: AudioIssue['code'],
  id: string,
  description: string,
  canAutoFix: boolean,
  isLossless: boolean,
  severity: IssueSeverity = 'error'
): AudioIssue {
  return { code, id, description, severity, canAutoFix, isLossless }
}

export function detectFormat(filePath: string): AudioFormat {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const map: Record<string, AudioFormat> = {
    wav: 'wav', wave: 'wav',
    aif: 'aiff', aiff: 'aiff',
    mp3: 'mp3',
    m4a: 'aac',
    m4p: 'aac',
    aac: 'aac',
    flac: 'flac',
    ogg: 'ogg',
    oga: 'ogg',
  }
  return map[ext] ?? 'unknown'
}

// ─── WAV binary checks ───────────────────────────────────────────────────────

export interface WavHeaderInfo {
  valid: boolean
  formatTag: number
  channels: number
  sampleRate: number
  bitDepth: number
  isExtensible: boolean
  subFormatGuid: Buffer | null
  isExtensiblePcm: boolean // subformat is standard PCM — in-place patch safe
}

export function parseWavHeader(buf: Buffer): WavHeaderInfo {
  const invalid: WavHeaderInfo = {
    valid: false, formatTag: 0, channels: 0, sampleRate: 0,
    bitDepth: 0, isExtensible: false, subFormatGuid: null, isExtensiblePcm: false,
  }

  if (buf.length < 44) return invalid

  const riff = buf.slice(0, 4).toString('ascii')
  const wave = buf.slice(8, 12).toString('ascii')
  if (riff !== 'RIFF' || wave !== 'WAVE') return invalid

  const formatTag = buf.readUInt16LE(20)
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bitDepth = buf.readUInt16LE(34)

  const isExtensible = formatTag === 0xFFFE
  let subFormatGuid: Buffer | null = null
  let isExtensiblePcm = false

  if (isExtensible && buf.length >= 60) {
    // WAVE_FORMAT_EXTENSIBLE subformat GUID is at offset 44
    // Layout: WAVEFORMATEX(18) + cbSize(2) + validBits(2) + channelMask(4) = 26 bytes, then SubFormat(16)
    subFormatGuid = buf.slice(44, 60)
    // Standard PCM GUID: {00000001-0000-0010-8000-00aa00389b71}
    const pcmGuid = Buffer.from([
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
      0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
    ])
    isExtensiblePcm = subFormatGuid.equals(pcmGuid)
  }

  return { valid: true, formatTag, channels, sampleRate, bitDepth, isExtensible, subFormatGuid, isExtensiblePcm }
}

export function checkWav(
  header: WavHeaderInfo,
  caps: ModelCaps,
  issues: AudioIssue[]
): void {
  if (!header.valid) {
    issues.push(issue('E-8304', 'WAV_CORRUPT_HEADER',
      'WAV file has a corrupted RIFF/WAVE header — CDJ cannot decode this file.',
      true, false))
    return
  }

  if (header.formatTag === 0x0003) {
    issues.push(issue('E-8304', 'WAV_32BIT_FLOAT',
      '32-bit float WAV (format tag 0x0003) — no Pioneer CDJ supports float encoding. Must be re-encoded as 24-bit or 16-bit integer PCM.',
      true, false))
  } else if (header.isExtensible) {
    if (header.isExtensiblePcm) {
      issues.push(issue('E-8305', 'WAV_EXTENSIBLE_PCM',
        'WAVE_FORMAT_EXTENSIBLE header (0xFFFE) with PCM subformat — can be fixed instantly with a 2-byte header patch (no re-encoding).',
        true, true))
    } else {
      issues.push(issue('E-8305', 'WAV_EXTENSIBLE',
        'WAVE_FORMAT_EXTENSIBLE header (0xFFFE) — CDJs only accept standard PCM (0x0001). Requires re-encoding.',
        true, false))
    }
  } else if (header.formatTag !== 0x0001) {
    issues.push(issue('E-8304', 'WAV_UNSUPPORTED_FORMAT_TAG',
      `Unsupported WAV format tag 0x${header.formatTag.toString(16).padStart(4, '0')} — CDJs require standard PCM (0x0001).`,
      false, false))
  }

  if (header.channels > 2) {
    issues.push(issue('E-8305', 'WAV_MULTICHANNEL',
      `Multichannel WAV (${header.channels} channels) — CDJs require stereo (2 channels).`,
      true, false))
  } else if (header.channels === 1) {
    issues.push(issue('WARNING', 'WAV_MONO',
      'Mono WAV (1 channel) — CDJs expect stereo. Playback may work but behaviour varies by model.',
      true, false, 'warning'))
  }

  if (header.sampleRate > caps.maxSampleRate && HIGH_SAMPLE_RATES.has(header.sampleRate)) {
    issues.push(issue('E-8305', 'WAV_SAMPLE_RATE_HIGH',
      `Sample rate ${(header.sampleRate / 1000).toFixed(1)} kHz exceeds this CDJ model's maximum (${caps.maxSampleRate / 1000} kHz). Must be resampled.`,
      true, false))
  } else if (LOW_SAMPLE_RATES.has(header.sampleRate) && header.sampleRate < 44100) {
    issues.push(issue('E-8305', 'WAV_SAMPLE_RATE_LOW',
      `Low sample rate ${header.sampleRate / 1000} kHz — CDJs require at least 44.1 kHz. Must be resampled.`,
      true, false))
  }

  if (header.bitDepth === 8) {
    issues.push(issue('E-8305', 'WAV_BIT_DEPTH_8',
      '8-bit WAV — CDJs require 16-bit or 24-bit. Must be re-encoded.',
      true, false))
  } else if (header.bitDepth === 32 && header.formatTag === 0x0001) {
    issues.push(issue('E-8305', 'WAV_BIT_DEPTH_32INT',
      '32-bit integer WAV — CDJs require 16-bit or 24-bit. Must be re-encoded.',
      true, false))
  }
}

// ─── AIFF binary checks ──────────────────────────────────────────────────────

export interface AiffHeaderInfo {
  valid: boolean
  isAifc: boolean
  compressionType: string | null
  commOffset: number
  ssndOffset: number
  wrongChunkOrder: boolean
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
}

export function parseAiffHeader(buf: Buffer, len: number): AiffHeaderInfo {
  const invalid: AiffHeaderInfo = {
    valid: false, isAifc: false, compressionType: null,
    commOffset: -1, ssndOffset: -1, wrongChunkOrder: false,
    sampleRate: null, bitDepth: null, channels: null,
  }

  if (len < 12) return invalid

  const form = buf.slice(0, 4).toString('ascii')
  const type = buf.slice(8, 12).toString('ascii')

  if (form !== 'FORM') return invalid
  if (type !== 'AIFF' && type !== 'AIFC') return invalid

  const isAifc = type === 'AIFC'
  let commOffset = -1
  let ssndOffset = -1
  let compressionType: string | null = null
  let sampleRate: number | null = null
  let bitDepth: number | null = null
  let channels: number | null = null

  let offset = 12
  while (offset + 8 <= len) {
    const chunkId = buf.slice(offset, offset + 4).toString('ascii')
    const chunkSize = buf.readUInt32BE(offset + 4)

    if (chunkId === 'COMM') {
      commOffset = offset
      if (offset + 8 + 8 <= len) {
        channels = buf.readUInt16BE(offset + 8)
        bitDepth = buf.readUInt16BE(offset + 14)
        // Sample rate is an 80-bit IEEE 754 extended float at offset+16
        sampleRate = readIeee80(buf, offset + 16)
      }
      if (isAifc && offset + 8 + 22 <= len) {
        compressionType = buf.slice(offset + 26, offset + 30).toString('ascii')
      }
    } else if (chunkId === 'SSND') {
      ssndOffset = offset
    }

    const paddedSize = chunkSize + (chunkSize % 2)
    offset += 8 + paddedSize
    if (paddedSize === 0) break // safety
  }

  const wrongChunkOrder = commOffset !== -1 && ssndOffset !== -1 && ssndOffset < commOffset

  return {
    valid: true, isAifc, compressionType, commOffset, ssndOffset,
    wrongChunkOrder, sampleRate, bitDepth, channels,
  }
}

// 80-bit IEEE 754 extended float (used by AIFF for sample rate)
function readIeee80(buf: Buffer, offset: number): number {
  if (offset + 10 > buf.length) return 0
  const exponent = ((buf[offset] & 0x7f) << 8) | buf[offset + 1]
  const hi = buf.readUInt32BE(offset + 2)
  const lo = buf.readUInt32BE(offset + 6)
  if (exponent === 0 && hi === 0 && lo === 0) return 0
  const value = (hi * 0x100000000 + lo) * Math.pow(2, exponent - 16383 - 63)
  return Math.round(value)
}

export function checkAiff(
  header: AiffHeaderInfo,
  caps: ModelCaps,
  issues: AudioIssue[]
): void {
  if (!header.valid) {
    issues.push(issue('E-8302', 'AIFF_CORRUPT_HEADER',
      'AIFF/AIFC file has a corrupted FORM header — CDJ cannot decode this file.',
      false, false))
    return
  }

  if (header.wrongChunkOrder) {
    issues.push(issue('E-8302', 'AIFF_CHUNK_ORDER',
      'SSND chunk appears before COMM chunk — NXS-generation CDJs may fail or load slowly. COMM must come first.',
      true, true))
  }

  if (header.isAifc && header.compressionType) {
    const ct = header.compressionType.trim()
    const unsupportedCodecs = ['ALAW', 'alaw', 'ulaw', 'ULAW', 'ima4', 'IMA4', 'NONE', 'none']
    // NONE is technically uncompressed in old AIFC files but some CDJs reject AIFC containers
    const compressed = ['ALAW', 'alaw', 'ulaw', 'ULAW', 'ima4', 'IMA4']
    if (compressed.includes(ct)) {
      issues.push(issue('E-8304', 'AIFF_COMPRESSED',
        `Compressed AIFF-C codec "${ct}" (${ct === 'ALAW' || ct === 'alaw' ? 'A-law' : ct === 'ulaw' || ct === 'ULAW' ? 'µ-law' : 'IMA ADPCM'}) — CDJs require uncompressed PCM. Must be decoded and re-encoded.`,
        true, false))
    } else if (ct !== 'sowt' && ct !== 'twos' && ct !== 'fl32' && ct !== 'fl64' && ct !== 'NONE') {
      issues.push(issue('E-8304', 'AIFF_UNKNOWN_CODEC',
        `Unknown AIFF-C compression type "${ct}" — CDJ compatibility unknown. Re-encoding to standard AIFF recommended.`,
        true, false))
    }
  }

  if (header.sampleRate !== null) {
    if (header.sampleRate > caps.maxSampleRate && HIGH_SAMPLE_RATES.has(header.sampleRate)) {
      issues.push(issue('E-8305', 'AIFF_SAMPLE_RATE_HIGH',
        `Sample rate ${(header.sampleRate / 1000).toFixed(1)} kHz exceeds this CDJ model's maximum (${caps.maxSampleRate / 1000} kHz). Must be resampled.`,
        true, false))
    } else if (LOW_SAMPLE_RATES.has(header.sampleRate) && header.sampleRate < 44100) {
      issues.push(issue('E-8305', 'AIFF_SAMPLE_RATE_LOW',
        `Low sample rate ${header.sampleRate / 1000} kHz — CDJs require at least 44.1 kHz. Must be resampled.`,
        true, false))
    }
  }

  if (header.bitDepth !== null) {
    if (header.bitDepth === 8) {
      issues.push(issue('E-8305', 'AIFF_BIT_DEPTH_8',
        '8-bit AIFF — CDJs require 16-bit or 24-bit.',
        true, false))
    } else if (header.bitDepth === 32) {
      issues.push(issue('E-8305', 'AIFF_BIT_DEPTH_32',
        '32-bit AIFF — CDJs require 16-bit or 24-bit.',
        true, false))
    }
  }

  if (header.channels !== null) {
    if (header.channels > 2) {
      issues.push(issue('E-8305', 'AIFF_MULTICHANNEL',
        `Multichannel AIFF (${header.channels} channels) — CDJs require stereo (2 channels).`,
        true, false))
    } else if (header.channels === 1) {
      issues.push(issue('WARNING', 'AIFF_MONO',
        'Mono AIFF (1 channel) — CDJs expect stereo. Playback may work but behaviour varies by model.',
        true, false, 'warning'))
    }
  }
}

// ─── MP3 binary checks ───────────────────────────────────────────────────────

export interface Mp3HeaderInfo {
  frameOffset: number
  mpegVersion: number // 1 or 2
  layer: number // 1, 2, or 3
  sampleRate: number
  bitrate: number
  channelMode: number // 0=stereo, 1=joint stereo, 2=dual channel, 3=mono
  isVbr: boolean
  hasXingHeader: boolean
  hasCorruptFrames: boolean
}

// MPEG bitrate lookup [version][layer][index]
const MPEG_BITRATES: Record<number, Record<number, number[]>> = {
  1: { // MPEG-1
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  },
  2: { // MPEG-2
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  },
}

const MPEG_SAMPLE_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
}

export function parseMp3Header(buf: Buffer, len: number): Mp3HeaderInfo | null {
  // Skip ID3v2 tag if present
  let start = 0
  if (len >= 10 && buf.slice(0, 3).toString('ascii') === 'ID3') {
    const tagSize =
      ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7)  |  (buf[9] & 0x7f)
    start = 10 + tagSize
  }

  // Find first valid frame sync
  let frameOffset = -1
  for (let i = start; i < Math.min(len - 3, start + 8192); i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      // Validate it looks like a real frame header
      const h1 = buf[i + 1]
      const h2 = buf[i + 2]
      const versionBits = (h1 >> 3) & 0x3
      const layerBits = (h1 >> 1) & 0x3
      const bitrateBits = (h2 >> 4) & 0xf
      const srBits = (h2 >> 2) & 0x3
      if (versionBits !== 1 && layerBits !== 0 && bitrateBits !== 0 &&
          bitrateBits !== 0xf && srBits !== 3) {
        frameOffset = i
        break
      }
    }
  }

  if (frameOffset === -1) return null

  const h1 = buf[frameOffset + 1]
  const h2 = buf[frameOffset + 2]
  const h3 = buf[frameOffset + 3]

  const versionBits = (h1 >> 3) & 0x3
  const mpegVersion = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2
  const layerBits = (h1 >> 1) & 0x3
  const layer = layerBits === 1 ? 3 : layerBits === 2 ? 2 : 1
  const bitrateBits = (h2 >> 4) & 0xf
  const srBits = (h2 >> 2) & 0x3
  const padding = (h2 >> 1) & 0x1
  const channelMode = (h3 >> 6) & 0x3

  const srTable = MPEG_SAMPLE_RATES[mpegVersion] ?? MPEG_SAMPLE_RATES[1]
  const sampleRate = srBits < 3 ? srTable[srBits] : 0
  const brTable = MPEG_BITRATES[mpegVersion]?.[layer] ?? MPEG_BITRATES[1][3]
  const bitrate = (brTable[bitrateBits] ?? 0) * 1000

  // Calculate frame size for MPEG Layer 3
  const frameSize = sampleRate > 0 && bitrate > 0
    ? Math.floor(144 * bitrate / sampleRate) + padding
    : 0

  // Check for Xing / Info / VBRI header (variable bitrate markers)
  const xingSearch = buf.slice(frameOffset + 4, Math.min(frameOffset + 180, len))
  const xingStr = xingSearch.toString('ascii')
  const hasXingHeader = xingStr.includes('Xing') || xingStr.includes('Info') || xingStr.includes('VBRI')

  // Detect VBR by comparing first 10 frames' bitrate index
  const isVbr = detectMp3Vbr(buf, frameOffset, len, mpegVersion, layer)

  // Detect corrupt frames
  const hasCorruptFrames = detectMp3CorruptFrames(buf, frameOffset, len, mpegVersion, layer)

  return {
    frameOffset, mpegVersion, layer, sampleRate, bitrate,
    channelMode, isVbr, hasXingHeader, hasCorruptFrames,
  }
}

function calcFrameSize(mpegVersion: number, layer: number, bitrateIdx: number, srIdx: number, padding: number): number {
  const srTable = MPEG_SAMPLE_RATES[mpegVersion] ?? MPEG_SAMPLE_RATES[1]
  const brTable = MPEG_BITRATES[mpegVersion]?.[layer] ?? MPEG_BITRATES[1][3]
  const sr = srTable[srIdx] ?? 44100
  const br = (brTable[bitrateIdx] ?? 128) * 1000
  if (sr === 0 || br === 0) return 0
  return Math.floor(144 * br / sr) + padding
}

function detectMp3Vbr(buf: Buffer, startOffset: number, len: number, version: number, layer: number): boolean {
  const bitrateIndices: number[] = []
  let offset = startOffset
  for (let i = 0; i < 10 && offset + 4 < len; i++) {
    if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) break
    const bitrateIdx = (buf[offset + 2] >> 4) & 0xf
    const srIdx = (buf[offset + 2] >> 2) & 0x3
    const padding = (buf[offset + 2] >> 1) & 0x1
    bitrateIndices.push(bitrateIdx)
    const size = calcFrameSize(version, layer, bitrateIdx, srIdx, padding)
    if (size <= 4) break
    offset += size
  }
  if (bitrateIndices.length < 3) return false
  return new Set(bitrateIndices).size > 1
}

function detectMp3CorruptFrames(buf: Buffer, startOffset: number, len: number, version: number, layer: number): boolean {
  let offset = startOffset
  let corruptCount = 0
  let totalFrames = 0
  for (let i = 0; i < 50 && offset + 4 < len; i++) {
    if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) {
      corruptCount++
      offset++
      continue
    }
    const bitrateIdx = (buf[offset + 2] >> 4) & 0xf
    const srIdx = (buf[offset + 2] >> 2) & 0x3
    const padding = (buf[offset + 2] >> 1) & 0x1
    if (bitrateIdx === 0 || bitrateIdx === 0xf || srIdx === 3) {
      corruptCount++
    }
    const size = calcFrameSize(version, layer, bitrateIdx, srIdx, padding)
    if (size <= 4) { offset++; continue }
    offset += size
    totalFrames++
  }
  return totalFrames > 0 && corruptCount > 3
}

export function checkMp3(
  mp3: Mp3HeaderInfo,
  caps: ModelCaps,
  issues: AudioIssue[]
): void {
  if (mp3.layer !== 3) {
    issues.push(issue('E-8302', 'MP3_WRONG_LAYER',
      `File uses MPEG Audio Layer ${mp3.layer}, not Layer 3 (MP3). CDJs require Layer 3.`,
      false, false))
  }

  if (!ALL_MPEG_RATES.has(mp3.sampleRate) || mp3.sampleRate === 0) {
    issues.push(issue('E-8305', 'MP3_INVALID_SAMPLE_RATE',
      `Non-MPEG-compliant sample rate ${mp3.sampleRate > 0 ? mp3.sampleRate / 1000 + ' kHz' : '(invalid)'} — CDJs require standard MPEG rates (44.1/48/32 kHz for MPEG-1).`,
      true, false))
  } else if (caps.strictMp3 && !MPEG1_RATES.has(mp3.sampleRate)) {
    // CDJ-3000 requires MPEG-1 rates only
    issues.push(issue('E-8305', 'MP3_MPEG2_SAMPLE_RATE',
      `Sample rate ${mp3.sampleRate / 1000} kHz (MPEG-2) — CDJ-3000 requires MPEG-1 sample rates only (44.1/48/32 kHz). Must be re-encoded.`,
      true, false))
  }

  if (caps.strictMp3 && mp3.hasCorruptFrames) {
    issues.push(issue('E-8302', 'MP3_CORRUPT_FRAMES',
      'Non-ISO-compliant or corrupt MP3 frames detected — CDJ-3000 uses a strict decoder and will reject this file. Re-encode with LAME.',
      true, false))
  } else if (mp3.hasCorruptFrames) {
    issues.push(issue('WARNING', 'MP3_CORRUPT_FRAMES_WARN',
      'Potentially corrupt or non-standard MP3 frames detected. May cause playback issues on CDJ-3000.',
      true, false, 'warning'))
  }

  if (mp3.isVbr && !mp3.hasXingHeader) {
    issues.push(issue('E-8306', 'MP3_VBR_NO_XING',
      'VBR MP3 is missing a Xing/LAME header. CDJs and rekordbox calculate different track lengths without it — hot cue seek points may be wrong.',
      true, true))
  }
}

// ─── M4A (AAC / ALAC) checks ─────────────────────────────────────────────────

export function checkM4a(
  filePath: string,
  isAlac: boolean,
  caps: ModelCaps,
  issues: AudioIssue[]
): void {
  if (filePath.toLowerCase().endsWith('.m4p')) {
    issues.push(issue('E-8305', 'AAC_DRM',
      'DRM-protected AAC (.m4p) — iTunes FairPlay DRM prevents playback on all Pioneer CDJs. The file must be replaced with a DRM-free version.',
      false, false))
    return
  }

  if (isAlac && !caps.supportsAlac) {
    issues.push(issue('E-8305', 'ALAC_UNSUPPORTED',
      'Apple Lossless (ALAC) in .m4a container — not supported on this CDJ model. Must be converted to AIFF or WAV (lossless quality preserved).',
      true, true))
  }
}

// ─── FLAC checks ──────────────────────────────────────────────────────────────

export function checkFlac(
  sampleRate: number | null,
  bitDepth: number | null,
  caps: ModelCaps,
  issues: AudioIssue[]
): void {
  if (!caps.supportsFlac) {
    issues.push(issue('E-8305', 'FLAC_UNSUPPORTED',
      'FLAC is only supported on CDJ-3000 / CDJ-TOUR1 with firmware 1.20 or later. This CDJ model cannot play FLAC files. Must be converted to AIFF or WAV (lossless quality preserved).',
      true, true))
    return
  }

  // Even on CDJ-3000, FLAC is limited to 44.1/48 kHz
  if (sampleRate !== null && sampleRate > 48000) {
    issues.push(issue('E-8305', 'FLAC_SAMPLE_RATE_HIGH',
      `FLAC at ${(sampleRate / 1000).toFixed(1)} kHz — even CDJ-3000 only supports FLAC at 44.1/48 kHz. Must be resampled or converted.`,
      true, false))
  }

  if (bitDepth !== null && bitDepth !== 16 && bitDepth !== 24) {
    issues.push(issue('E-8305', 'FLAC_BIT_DEPTH',
      `${bitDepth}-bit FLAC — CDJs require 16-bit or 24-bit.`,
      true, false))
  }
}

// ─── General / filesystem checks ─────────────────────────────────────────────

export function checkGeneral(
  filePath: string,
  issues: AudioIssue[]
): void {
  if (filePath.length > 255) {
    issues.push(issue('E-8306', 'PATH_TOO_LONG',
      `File path is ${filePath.length} characters (limit: 255). Pioneer DJ LINK cannot resolve paths this long — the track will appear missing on CDJ.`,
      false, false))
  }

  // Non-ASCII filename check
  const fileName = path.basename(filePath)
  if (/[^\x00-\x7F]/.test(fileName)) {
    issues.push(issue('WARNING', 'UNICODE_FILENAME',
      `Filename contains non-ASCII characters: "${fileName}". CDJ display and sorting may be affected.`,
      false, false, 'warning'))
  }
}

// ─── Main analysis entry point ────────────────────────────────────────────────

export async function analyzeFile(
  filePath: string,
  targetModel: CDJModel,
  trackId: string
): Promise<TrackAnalysis> {
  const caps = MODEL_CAPS[targetModel]
  const fileName = path.basename(filePath)
  const format = detectFormat(filePath)
  const issues: AudioIssue[] = []

  let fileSize = 0
  try {
    const stat = await fs.stat(filePath)
    fileSize = stat.size
  } catch {
    return buildResult(trackId, filePath, fileName, 0, format, null, null, null, null, null, null, [
      issue('E-8302', 'FILE_NOT_FOUND', `Cannot access file: ${filePath}`, false, false)
    ], 'error')
  }

  // General checks (apply to all formats)
  checkGeneral(filePath, issues)

  // Format-specific checks via binary header inspection
  let sampleRate: number | null = null
  let bitDepth: number | null = null
  let channels: number | null = null
  let bitrate: number | null = null
  let duration: number | null = null
  let codec: string | null = null
  let hasArtwork = false
  let artworkFormat: string | null = null

  if (format === 'ogg') {
    issues.push(issue('UNSUPPORTED', 'OGG_UNSUPPORTED',
      'OGG Vorbis is not supported on any Pioneer CDJ/XDJ player. Must be converted.',
      true, false))
  } else if (format === 'unknown') {
    issues.push(issue('UNSUPPORTED', 'FORMAT_UNKNOWN',
      `Unrecognised file format. Pioneer CDJs support MP3, AIFF, WAV, AAC, FLAC (CDJ-3000 only), and ALAC (CDJ-2000NXS2+).`,
      false, false))
  }

  try {
    const buf = Buffer.alloc(65536)
    const fh = await fs.open(filePath, 'r')
    let bytesRead = 0
    try {
      const result = await fh.read(buf, 0, 65536, 0)
      bytesRead = result.bytesRead
    } finally {
      await fh.close()
    }

    if (format === 'wav') {
      const header = parseWavHeader(buf)
      sampleRate = header.sampleRate || null
      bitDepth = header.bitDepth || null
      channels = header.channels || null
      codec = header.valid ? 'PCM' : null
      checkWav(header, caps, issues)
    } else if (format === 'aiff') {
      const header = parseAiffHeader(buf, bytesRead)
      sampleRate = header.sampleRate
      bitDepth = header.bitDepth
      channels = header.channels
      codec = header.isAifc ? `AIFF-C/${header.compressionType ?? 'unknown'}` : 'PCM'
      checkAiff(header, caps, issues)
    } else if (format === 'mp3') {
      const mp3 = parseMp3Header(buf, bytesRead)
      if (mp3) {
        sampleRate = mp3.sampleRate || null
        bitrate = mp3.bitrate || null
        codec = `MPEG-${mp3.mpegVersion} Layer ${mp3.layer}`
        channels = mp3.channelMode === 3 ? 1 : 2
        checkMp3(mp3, caps, issues)
      } else {
        issues.push(issue('E-8302', 'MP3_NO_VALID_FRAME',
          'No valid MP3 frame sync found — file may be severely corrupted or is not an MP3.',
          false, false))
      }
    } else if (format === 'flac') {
      // FLAC: parse basic header
      if (buf.slice(0, 4).toString('ascii') === 'fLaC') {
        // Streaminfo block starts at offset 8 (after 4-byte marker + 4-byte block header)
        if (bytesRead >= 26) {
          const minBlockSize = buf.readUInt16BE(8)
          // sample rate: bits 80-99 of streaminfo (offset 18, upper 20 bits)
          const sr = ((buf[18] << 12) | (buf[19] << 4) | (buf[20] >> 4)) & 0xfffff
          const bd = ((buf[20] & 0x0e) >> 1) + 1
          const ch = ((buf[20] & 0xf0) >> 4) + 1
          sampleRate = sr || null
          bitDepth = bd || null
          channels = ch || null
          codec = 'FLAC'
          void minBlockSize // used for validation in full implementations
          checkFlac(sampleRate, bitDepth, caps, issues)
        }
      }
    } else if (format === 'aac') {
      codec = filePath.toLowerCase().endsWith('.m4p') ? 'AAC (DRM)' : 'AAC/ALAC'
      // Detect ALAC vs AAC by checking for 'alac' atom in the first 64KB
      const isAlac = buf.slice(0, bytesRead).toString('binary').includes('alac')
      if (isAlac) codec = 'ALAC'
      checkM4a(filePath, isAlac, caps, issues)
    }

    // Artwork check — scan for PNG magic bytes in first 64KB of metadata
    // (JPEG: FF D8 FF, PNG: 89 50 4E 47)
    const bufStr = buf.slice(0, bytesRead)
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff])
    const hasPng = bufStr.indexOf(pngMagic) !== -1
    const hasJpeg = bufStr.indexOf(jpegMagic) !== -1
    hasArtwork = hasPng || hasJpeg
    artworkFormat = hasPng ? 'png' : hasJpeg ? 'jpeg' : null

    if (hasPng) {
      issues.push(issue('WARNING', 'ARTWORK_PNG',
        'Embedded artwork is PNG — Pioneer CDJs prefer JPEG artwork. PNG may not display on all models.',
        true, false, 'warning'))
    }
  } catch (err) {
    issues.push(issue('E-8302', 'READ_ERROR',
      `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
      false, false))
  }

  return buildResult(
    trackId, filePath, fileName, fileSize, format,
    sampleRate, bitDepth, channels, bitrate, duration, codec,
    issues, 'done', hasArtwork, artworkFormat
  )
}

function buildResult(
  id: string,
  filePath: string,
  fileName: string,
  fileSize: number,
  format: AudioFormat,
  sampleRate: number | null,
  bitDepth: number | null,
  channels: number | null,
  bitrate: number | null,
  duration: number | null,
  codec: string | null,
  issues: AudioIssue[],
  status: TrackAnalysis['status'],
  hasArtwork = false,
  artworkFormat: string | null = null
): TrackAnalysis {
  return {
    id, filePath, fileName, fileSize, format,
    sampleRate, bitDepth, channels, bitrate, duration, codec,
    issues, status, hasArtwork, artworkFormat,
  }
}
