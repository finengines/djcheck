import { describe, it, expect } from 'vitest'
import {
  parseWavHeader,
  checkWav,
  parseAiffHeader,
  checkAiff,
  parseMp3Header,
  checkMp3,
  checkFlac,
  checkM4a,
  detectFormat,
  MODEL_CAPS,
} from '../../src/main/audio/analyzer'
import type { AudioIssue } from '../../src/shared/ipc-types'

// ─── Helpers to build synthetic binary buffers ────────────────────────────────

function makeWavBuffer(opts: {
  formatTag?: number
  channels?: number
  sampleRate?: number
  bitDepth?: number
  extraBytes?: number
}): Buffer {
  const {
    formatTag = 0x0001,
    channels = 2,
    sampleRate = 44100,
    bitDepth = 24,
    extraBytes = 0,
  } = opts

  const buf = Buffer.alloc(44 + extraBytes, 0)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // chunk size
  buf.writeUInt16LE(formatTag, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28) // byte rate
  buf.writeUInt16LE(channels * (bitDepth / 8), 32) // block align
  buf.writeUInt16LE(bitDepth, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(0, 40)
  return buf
}

function makeWavExtensibleBuffer(isFloatSubformat = false): Buffer {
  // EXTENSIBLE WAV with either PCM or float subformat GUID
  const buf = Buffer.alloc(80, 0)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(72, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(40, 16) // cbSize=22 extension
  buf.writeUInt16LE(0xFFFE, 20) // EXTENSIBLE
  buf.writeUInt16LE(2, 22) // stereo
  buf.writeUInt32LE(44100, 24)
  buf.writeUInt32LE(44100 * 2 * 3, 28)
  buf.writeUInt16LE(6, 32)
  buf.writeUInt16LE(24, 34)
  buf.writeUInt16LE(22, 36) // cbSize
  buf.writeUInt16LE(24, 38) // validBitsPerSample
  buf.writeUInt32LE(3, 40) // dwChannelMask (FL+FR)
  // SubFormat GUID at offset 44 (absolute)
  // WAVEFORMATEX(18) + cbSize(2) + validBits(2) + channelMask(4) = 26 bytes, then SubFormat(16)
  if (isFloatSubformat) {
    // Float GUID: {00000003-0000-0010-8000-00aa00389b71}
    buf[44] = 0x03; buf[45] = 0x00
    buf[46] = 0x00; buf[47] = 0x00
    buf[48] = 0x00; buf[49] = 0x00
    buf[50] = 0x10; buf[51] = 0x00
    buf[52] = 0x80; buf[53] = 0x00
    buf[54] = 0x00; buf[55] = 0xaa
    buf[56] = 0x00; buf[57] = 0x38
    buf[58] = 0x9b; buf[59] = 0x71
  } else {
    // Standard PCM GUID: {00000001-0000-0010-8000-00aa00389b71}
    buf[44] = 0x01; buf[45] = 0x00
    buf[46] = 0x00; buf[47] = 0x00
    buf[48] = 0x00; buf[49] = 0x00
    buf[50] = 0x10; buf[51] = 0x00
    buf[52] = 0x80; buf[53] = 0x00
    buf[54] = 0x00; buf[55] = 0xaa
    buf[56] = 0x00; buf[57] = 0x38
    buf[58] = 0x9b; buf[59] = 0x71
  }
  return buf
}

function makeAiffBuffer(opts: {
  isAifc?: boolean
  compressionType?: string
  commFirst?: boolean    // if false: SSND before COMM (wrong order)
  sampleRate?: number
  bitDepth?: number
  channels?: number
}): Buffer {
  const {
    isAifc = false,
    compressionType = 'NONE',
    commFirst = true,
    sampleRate = 44100,
    bitDepth = 24,
    channels = 2,
  } = opts

  const buf = Buffer.alloc(512, 0)
  buf.write('FORM', 0, 'ascii')
  buf.writeUInt32BE(0, 4)
  buf.write(isAifc ? 'AIFC' : 'AIFF', 8, 'ascii')

  const commData = buildCommChunk(channels, sampleRate, bitDepth, isAifc, compressionType)
  const ssndData = buildSsndChunk()

  let offset = 12
  if (commFirst) {
    commData.copy(buf, offset); offset += commData.length
    ssndData.copy(buf, offset)
  } else {
    ssndData.copy(buf, offset); offset += ssndData.length
    commData.copy(buf, offset)
  }

  return buf
}

function buildCommChunk(ch: number, sr: number, bd: number, isAifc: boolean, comprType: string): Buffer {
  const size = isAifc ? 26 : 18
  const b = Buffer.alloc(8 + size, 0)
  b.write('COMM', 0, 'ascii')
  b.writeUInt32BE(size, 4)
  b.writeUInt16BE(ch, 8)
  b.writeUInt32BE(0, 10) // num sample frames
  b.writeUInt16BE(bd, 14)
  writeIeee80(b, 16, sr)
  if (isAifc) {
    b.write(comprType.padEnd(4).slice(0, 4), 26, 'ascii')
  }
  return b
}

function writeIeee80(buf: Buffer, offset: number, value: number): void {
  if (value === 0) return
  // IEEE 754 80-bit extended: bias = 16383, 64-bit explicit significand
  let exp = 16383
  let mant = value
  while (mant >= 2) { mant /= 2; exp++ }
  while (mant < 1 && mant > 0) { mant *= 2; exp-- }
  // hi = upper 32 bits of the 64-bit significand (mant * 2^63 >> 32 = mant * 2^31)
  const hi = Math.floor(mant * 0x80000000)
  buf.writeUInt16BE(exp, offset)
  buf.writeUInt32BE(hi, offset + 2)
  buf.writeUInt32BE(0, offset + 6)
}

function buildSsndChunk(): Buffer {
  const b = Buffer.alloc(16, 0)
  b.write('SSND', 0, 'ascii')
  b.writeUInt32BE(8, 4)
  return b
}

function makeMp3Buffer(opts: {
  mpegVersion?: 1 | 2
  bitrateIdx?: number
  srIdx?: number
  channelMode?: number
  includeXing?: boolean
  insertId3?: boolean
  corruptFrames?: boolean
}): Buffer {
  const {
    mpegVersion = 1,
    bitrateIdx = 9,  // 128kbps for MPEG-1
    srIdx = 0,       // 44100 Hz
    channelMode = 0, // stereo
    includeXing = false,
    insertId3 = false,
    corruptFrames = false,
  } = opts

  const buf = Buffer.alloc(4096, 0)
  let offset = 0

  if (insertId3) {
    buf.write('ID3', 0, 'ascii')
    buf[3] = 3; buf[4] = 0; buf[5] = 0
    // synchsafe size = 0 (empty tag)
    buf[6] = 0; buf[7] = 0; buf[8] = 0; buf[9] = 0
    offset = 10
  }

  // Build MPEG version bits: 1=0b11, 2=0b10
  const vBits = mpegVersion === 1 ? 0b11 : 0b10
  // Layer 3 = 0b01
  const frameHeader = (0xFF << 24) | (0xE0 << 16) | (vBits << 19) | (0b01 << 17) |
    (bitrateIdx << 12) | (srIdx << 10) | (channelMode << 6)

  buf.writeUInt32BE(frameHeader >>> 0, offset)

  if (includeXing) {
    buf.write('Xing', offset + 36, 'ascii')
  }

  if (corruptFrames) {
    // Insert garbage bytes at various frame positions
    for (let i = 0; i < 20; i++) {
      buf[offset + 200 + i] = 0xDE
    }
  }

  return buf
}

// ─── WAV tests ────────────────────────────────────────────────────────────────

describe('WAV header parsing', () => {
  it('parses clean 24-bit 44.1kHz stereo PCM WAV', () => {
    const buf = makeWavBuffer({ formatTag: 0x0001, channels: 2, sampleRate: 44100, bitDepth: 24 })
    const h = parseWavHeader(buf)
    expect(h.valid).toBe(true)
    expect(h.formatTag).toBe(0x0001)
    expect(h.channels).toBe(2)
    expect(h.sampleRate).toBe(44100)
    expect(h.bitDepth).toBe(24)
    expect(h.isExtensible).toBe(false)
  })

  it('detects WAVE_FORMAT_EXTENSIBLE (0xFFFE)', () => {
    const buf = makeWavBuffer({ formatTag: 0xFFFE })
    const h = parseWavHeader(buf)
    expect(h.valid).toBe(true)
    expect(h.isExtensible).toBe(true)
  })

  it('detects 32-bit float format tag (0x0003)', () => {
    const buf = makeWavBuffer({ formatTag: 0x0003 })
    const h = parseWavHeader(buf)
    expect(h.formatTag).toBe(0x0003)
  })

  it('identifies PCM subformat GUID for lossless patch', () => {
    const buf = makeWavExtensibleBuffer(false) // PCM subformat
    const h = parseWavHeader(buf)
    expect(h.isExtensible).toBe(true)
    expect(h.isExtensiblePcm).toBe(true)
  })

  it('correctly identifies non-PCM subformat (float GUID)', () => {
    const buf = makeWavExtensibleBuffer(true) // float subformat
    const h = parseWavHeader(buf)
    expect(h.isExtensible).toBe(true)
    expect(h.isExtensiblePcm).toBe(false)
  })

  it('returns invalid for corrupt header', () => {
    const buf = Buffer.from('NOPE12345678901234567890123456789012345678901234')
    const h = parseWavHeader(buf)
    expect(h.valid).toBe(false)
  })
})

describe('WAV compatibility checks', () => {
  const caps = MODEL_CAPS['cdj-2000nxs2']
  const oldCaps = MODEL_CAPS['cdj-2000']

  it('reports no issues for clean 24-bit 44.1kHz stereo WAV', () => {
    const buf = makeWavBuffer({ formatTag: 0x0001, channels: 2, sampleRate: 44100, bitDepth: 24 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues).toHaveLength(0)
  })

  it('reports WAV_EXTENSIBLE_PCM for EXTENSIBLE with PCM subformat', () => {
    const buf = makeWavExtensibleBuffer(false)
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    const ids = issues.map(i => i.id)
    expect(ids).toContain('WAV_EXTENSIBLE_PCM')
    // Should be marked as lossless fix
    expect(issues.find(i => i.id === 'WAV_EXTENSIBLE_PCM')?.isLossless).toBe(true)
  })

  it('reports WAV_32BIT_FLOAT for format tag 0x0003', () => {
    const buf = makeWavBuffer({ formatTag: 0x0003 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_32BIT_FLOAT')
  })

  it('reports WAV_SAMPLE_RATE_HIGH for 96kHz on cdj-2000', () => {
    const buf = makeWavBuffer({ sampleRate: 96000 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, oldCaps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_SAMPLE_RATE_HIGH')
  })

  it('does NOT flag 96kHz for cdj-2000nxs2 (supports up to 96kHz)', () => {
    const buf = makeWavBuffer({ sampleRate: 96000 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).not.toContain('WAV_SAMPLE_RATE_HIGH')
  })

  it('reports WAV_SAMPLE_RATE_LOW for 22050Hz', () => {
    const buf = makeWavBuffer({ sampleRate: 22050 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_SAMPLE_RATE_LOW')
  })

  it('reports WAV_MULTICHANNEL for 6-channel WAV', () => {
    const buf = makeWavBuffer({ channels: 6 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_MULTICHANNEL')
  })

  it('reports WAV_MONO as warning (not error) for mono WAV', () => {
    const buf = makeWavBuffer({ channels: 1 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    const mono = issues.find(i => i.id === 'WAV_MONO')
    expect(mono).toBeTruthy()
    expect(mono?.severity).toBe('warning')
  })

  it('reports WAV_BIT_DEPTH_8 for 8-bit WAV', () => {
    const buf = makeWavBuffer({ bitDepth: 8 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_BIT_DEPTH_8')
  })

  it('reports WAV_CORRUPT_HEADER for invalid magic bytes', () => {
    const buf = Buffer.from('NOPE12345678901234567890123456789012345678901234')
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_CORRUPT_HEADER')
  })
})

// ─── AIFF tests ───────────────────────────────────────────────────────────────

describe('AIFF header parsing', () => {
  it('parses clean AIFF with COMM before SSND', () => {
    const buf = makeAiffBuffer({ commFirst: true })
    const h = parseAiffHeader(buf, buf.length)
    expect(h.valid).toBe(true)
    expect(h.wrongChunkOrder).toBe(false)
    expect(h.isAifc).toBe(false)
  })

  it('detects wrong chunk order (SSND before COMM)', () => {
    const buf = makeAiffBuffer({ commFirst: false })
    const h = parseAiffHeader(buf, buf.length)
    expect(h.valid).toBe(true)
    expect(h.wrongChunkOrder).toBe(true)
  })

  it('detects AIFC with ALAW compression', () => {
    const buf = makeAiffBuffer({ isAifc: true, compressionType: 'ALAW' })
    const h = parseAiffHeader(buf, buf.length)
    expect(h.valid).toBe(true)
    expect(h.isAifc).toBe(true)
    expect(h.compressionType?.trim()).toBe('ALAW')
  })

  it('parses sample rate correctly', () => {
    const buf = makeAiffBuffer({ sampleRate: 44100 })
    const h = parseAiffHeader(buf, buf.length)
    expect(h.sampleRate).toBe(44100)
  })

  it('parses bit depth correctly', () => {
    const buf = makeAiffBuffer({ bitDepth: 24 })
    const h = parseAiffHeader(buf, buf.length)
    expect(h.bitDepth).toBe(24)
  })

  it('returns invalid for corrupt header', () => {
    const buf = Buffer.from('JUNK00000000XXXX')
    const h = parseAiffHeader(buf, buf.length)
    expect(h.valid).toBe(false)
  })
})

describe('AIFF compatibility checks', () => {
  const caps = MODEL_CAPS['cdj-2000']

  it('reports no issues for clean AIFF 44.1kHz 24-bit stereo', () => {
    const buf = makeAiffBuffer({ commFirst: true, sampleRate: 44100, bitDepth: 24, channels: 2 })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('reports AIFF_CHUNK_ORDER when SSND precedes COMM', () => {
    const buf = makeAiffBuffer({ commFirst: false })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('AIFF_CHUNK_ORDER')
    expect(issues.find(i => i.id === 'AIFF_CHUNK_ORDER')?.isLossless).toBe(true)
  })

  it('reports AIFF_COMPRESSED for ALAW codec', () => {
    const buf = makeAiffBuffer({ isAifc: true, compressionType: 'ALAW' })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('AIFF_COMPRESSED')
  })

  it('reports AIFF_COMPRESSED for ulaw codec', () => {
    const buf = makeAiffBuffer({ isAifc: true, compressionType: 'ulaw' })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('AIFF_COMPRESSED')
  })

  it('reports AIFF_SAMPLE_RATE_HIGH for 96kHz on cdj-2000', () => {
    const buf = makeAiffBuffer({ sampleRate: 96000 })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, MODEL_CAPS['cdj-2000'], issues)
    expect(issues.map(i => i.id)).toContain('AIFF_SAMPLE_RATE_HIGH')
  })

  it('reports AIFF_BIT_DEPTH_8 for 8-bit AIFF', () => {
    const buf = makeAiffBuffer({ bitDepth: 8 })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('AIFF_BIT_DEPTH_8')
  })

  it('reports AIFF_MULTICHANNEL for 6-channel AIFF', () => {
    const buf = makeAiffBuffer({ channels: 6 })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('AIFF_MULTICHANNEL')
  })
})

// ─── MP3 tests ────────────────────────────────────────────────────────────────

describe('MP3 header parsing', () => {
  it('parses valid MPEG-1 Layer 3 frame header', () => {
    const buf = makeMp3Buffer({ mpegVersion: 1, bitrateIdx: 9, srIdx: 0 })
    const h = parseMp3Header(buf, buf.length)
    expect(h).not.toBeNull()
    expect(h!.mpegVersion).toBe(1)
    expect(h!.layer).toBe(3)
    expect(h!.sampleRate).toBe(44100)
  })

  it('detects Xing header presence', () => {
    const buf = makeMp3Buffer({ includeXing: true })
    const h = parseMp3Header(buf, buf.length)
    expect(h!.hasXingHeader).toBe(true)
  })

  it('correctly identifies no Xing header', () => {
    const buf = makeMp3Buffer({ includeXing: false })
    const h = parseMp3Header(buf, buf.length)
    expect(h!.hasXingHeader).toBe(false)
  })

  it('skips ID3v2 tag prefix when finding frame sync', () => {
    const buf = makeMp3Buffer({ insertId3: true })
    const h = parseMp3Header(buf, buf.length)
    expect(h).not.toBeNull()
  })

  it('returns null for buffer with no valid frame sync', () => {
    const buf = Buffer.alloc(100, 0x00)
    const h = parseMp3Header(buf, buf.length)
    expect(h).toBeNull()
  })
})

describe('MP3 compatibility checks', () => {
  const caps = MODEL_CAPS['cdj-2000nxs2']
  const strictCaps = MODEL_CAPS['cdj-3000']

  it('reports no issues for clean 128kbps 44.1kHz CBR MP3', () => {
    const buf = makeMp3Buffer({ mpegVersion: 1, bitrateIdx: 9, srIdx: 0, includeXing: true })
    const h = parseMp3Header(buf, buf.length)!
    const issues: AudioIssue[] = []
    checkMp3(h, caps, issues)
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('reports MP3_VBR_NO_XING for VBR without Xing header', () => {
    // Create a VBR-looking buffer by having no Xing header
    // Our VBR detection looks at multiple frames; for this test mock isVbr=true
    const buf = makeMp3Buffer({ includeXing: false })
    const h = parseMp3Header(buf, buf.length)!
    // Force isVbr=true for testing purposes
    h.isVbr = true
    h.hasXingHeader = false
    const issues: AudioIssue[] = []
    checkMp3(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('MP3_VBR_NO_XING')
    expect(issues.find(i => i.id === 'MP3_VBR_NO_XING')?.isLossless).toBe(true)
  })

  it('does NOT flag VBR when Xing header present', () => {
    const buf = makeMp3Buffer({ includeXing: true })
    const h = parseMp3Header(buf, buf.length)!
    h.isVbr = true
    h.hasXingHeader = true
    const issues: AudioIssue[] = []
    checkMp3(h, caps, issues)
    expect(issues.map(i => i.id)).not.toContain('MP3_VBR_NO_XING')
  })

  it('reports MP3_CORRUPT_FRAMES as error on strict CDJ-3000 model', () => {
    const buf = makeMp3Buffer({})
    const h = parseMp3Header(buf, buf.length)!
    h.hasCorruptFrames = true
    const issues: AudioIssue[] = []
    checkMp3(h, strictCaps, issues)
    expect(issues.map(i => i.id)).toContain('MP3_CORRUPT_FRAMES')
    expect(issues.find(i => i.id === 'MP3_CORRUPT_FRAMES')?.severity).toBe('error')
  })

  it('reports MP3_CORRUPT_FRAMES as warning only on non-strict models', () => {
    const buf = makeMp3Buffer({})
    const h = parseMp3Header(buf, buf.length)!
    h.hasCorruptFrames = true
    const issues: AudioIssue[] = []
    checkMp3(h, caps, issues) // cdj-2000nxs2 is not strict
    const entry = issues.find(i => i.id === 'MP3_CORRUPT_FRAMES_WARN')
    expect(entry).toBeTruthy()
    expect(entry?.severity).toBe('warning')
  })
})

// ─── FLAC tests ───────────────────────────────────────────────────────────────

describe('FLAC compatibility checks', () => {
  it('flags FLAC_UNSUPPORTED on cdj-2000nxs2 (no FLAC support)', () => {
    const issues: AudioIssue[] = []
    checkFlac(44100, 24, MODEL_CAPS['cdj-2000nxs2'], issues)
    expect(issues.map(i => i.id)).toContain('FLAC_UNSUPPORTED')
    expect(issues.find(i => i.id === 'FLAC_UNSUPPORTED')?.isLossless).toBe(true)
  })

  it('flags FLAC_UNSUPPORTED on cdj-2000 (no FLAC support)', () => {
    const issues: AudioIssue[] = []
    checkFlac(44100, 24, MODEL_CAPS['cdj-2000'], issues)
    expect(issues.map(i => i.id)).toContain('FLAC_UNSUPPORTED')
  })

  it('flags FLAC_UNSUPPORTED on "all" mode (most restrictive)', () => {
    const issues: AudioIssue[] = []
    checkFlac(44100, 24, MODEL_CAPS['all'], issues)
    expect(issues.map(i => i.id)).toContain('FLAC_UNSUPPORTED')
  })

  it('does NOT flag FLAC_UNSUPPORTED on cdj-3000 at 44.1kHz', () => {
    const issues: AudioIssue[] = []
    checkFlac(44100, 24, MODEL_CAPS['cdj-3000'], issues)
    expect(issues.map(i => i.id)).not.toContain('FLAC_UNSUPPORTED')
  })

  it('flags FLAC_SAMPLE_RATE_HIGH on cdj-3000 at 96kHz (FLAC limited to 48kHz even on 3000)', () => {
    const issues: AudioIssue[] = []
    checkFlac(96000, 24, MODEL_CAPS['cdj-3000'], issues)
    expect(issues.map(i => i.id)).toContain('FLAC_SAMPLE_RATE_HIGH')
  })
})

// ─── M4A / ALAC / DRM tests ───────────────────────────────────────────────────

describe('M4A / AAC / ALAC checks', () => {
  it('flags AAC_DRM for .m4p files', () => {
    const issues: AudioIssue[] = []
    checkM4a('/path/to/track.m4p', false, MODEL_CAPS['cdj-2000nxs2'], issues)
    expect(issues.map(i => i.id)).toContain('AAC_DRM')
    expect(issues.find(i => i.id === 'AAC_DRM')?.canAutoFix).toBe(false)
  })

  it('flags ALAC_UNSUPPORTED on cdj-2000 (no ALAC)', () => {
    const issues: AudioIssue[] = []
    checkM4a('/path/to/track.m4a', true, MODEL_CAPS['cdj-2000'], issues)
    expect(issues.map(i => i.id)).toContain('ALAC_UNSUPPORTED')
    expect(issues.find(i => i.id === 'ALAC_UNSUPPORTED')?.isLossless).toBe(true)
  })

  it('does NOT flag ALAC on cdj-2000nxs2 (supports ALAC)', () => {
    const issues: AudioIssue[] = []
    checkM4a('/path/to/track.m4a', true, MODEL_CAPS['cdj-2000nxs2'], issues)
    expect(issues.map(i => i.id)).not.toContain('ALAC_UNSUPPORTED')
  })

  it('reports no issues for clean .m4a AAC on all models', () => {
    const issues: AudioIssue[] = []
    checkM4a('/path/to/track.m4a', false, MODEL_CAPS['cdj-2000'], issues)
    expect(issues).toHaveLength(0)
  })
})

// ─── detectFormat tests ───────────────────────────────────────────────────────

describe('detectFormat', () => {
  it.each([
    ['/path/track.wav',  'wav'],
    ['/path/track.WAV',  'wav'],
    ['/path/track.aiff', 'aiff'],
    ['/path/track.aif',  'aiff'],
    ['/path/track.AIFF', 'aiff'],
    ['/path/track.mp3',  'mp3'],
    ['/path/track.m4a',  'aac'],
    ['/path/track.m4p',  'aac'],
    ['/path/track.flac', 'flac'],
    ['/path/track.ogg',  'ogg'],
    ['/path/track.oga',  'ogg'],
    ['/path/track.xyz',  'unknown'],
  ])('%s → %s', (path, expected) => {
    expect(detectFormat(path)).toBe(expected)
  })
})

// ─── MODEL_CAPS sanity checks ─────────────────────────────────────────────────

describe('MODEL_CAPS', () => {
  it('cdj-2000 is most restrictive', () => {
    expect(MODEL_CAPS['cdj-2000'].supportsFlac).toBe(false)
    expect(MODEL_CAPS['cdj-2000'].supportsAlac).toBe(false)
    expect(MODEL_CAPS['cdj-2000'].maxSampleRate).toBe(48000)
  })

  it('cdj-3000 supports FLAC and has strict MP3', () => {
    expect(MODEL_CAPS['cdj-3000'].supportsFlac).toBe(true)
    expect(MODEL_CAPS['cdj-3000'].strictMp3).toBe(true)
  })

  it('all mode applies strictest rules', () => {
    expect(MODEL_CAPS['all'].supportsFlac).toBe(false)
    expect(MODEL_CAPS['all'].strictMp3).toBe(true) // uses CDJ-3000 strictness
    expect(MODEL_CAPS['all'].maxSampleRate).toBe(48000)
  })
})

// ─── BWF (Broadcast WAV) tests ───────────────────────────────────────────────

describe('BWF / Broadcast WAV checks', () => {
  const caps = MODEL_CAPS['cdj-2000nxs2']

  function makeBwfBuffer(): Buffer {
    const buf = Buffer.alloc(80, 0)
    buf.write('RIFF', 0, 'ascii')
    buf.writeUInt32LE(72, 4)
    buf.write('WAVE', 8, 'ascii')
    buf.write('fmt ', 12, 'ascii')
    buf.writeUInt32LE(16, 16) // PCM fmt chunk size
    buf.writeUInt16LE(0x0001, 20) // PCM
    buf.writeUInt16LE(2, 22) // stereo
    buf.writeUInt32LE(44100, 24)
    buf.writeUInt32LE(264600, 28)
    buf.writeUInt16LE(6, 32)
    buf.writeUInt16LE(24, 34)
    // 'bext' chunk at offset 36
    buf.write('bext', 36, 'ascii')
    buf.writeUInt32LE(4, 40) // chunk size
    // 'data' chunk at offset 44
    buf.write('data', 44, 'ascii')
    buf.writeUInt32LE(0, 48)
    return buf
  }

  it('detects BWF bext chunk and warns', () => {
    const buf = makeBwfBuffer()
    const h = parseWavHeader(buf)
    expect(h.valid).toBe(true)
    expect(h.hasBextChunk).toBe(true)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_BWF')
    expect(issues.find(i => i.id === 'WAV_BWF')?.severity).toBe('warning')
  })
})

// ─── RF64 tests ──────────────────────────────────────────────────────────────

describe('RF64 WAV checks', () => {
  const caps = MODEL_CAPS['cdj-2000nxs2']

  it('detects RF64 magic bytes and reports error', () => {
    const buf = Buffer.alloc(60, 0)
    buf.write('RF64', 0, 'ascii')
    buf.writeUInt32LE(0xFFFFFFFF, 4) // RF64 uses 0xFFFFFFFF for size
    buf.write('WAVE', 8, 'ascii')
    buf.write('fmt ', 12, 'ascii')
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(0x0001, 20) // PCM
    buf.writeUInt16LE(2, 22)
    buf.writeUInt32LE(44100, 24)
    buf.writeUInt32LE(264600, 28)
    buf.writeUInt16LE(6, 32)
    buf.writeUInt16LE(24, 34)
    const h = parseWavHeader(buf)
    expect(h.valid).toBe(true)
    expect(h.isRf64).toBe(true)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('WAV_RF64')
    expect(issues.find(i => i.id === 'WAV_RF64')?.code).toBe('E-8304')
  })
})

// ─── Large file tests ────────────────────────────────────────────────────────

describe('Large file warnings', () => {
  const caps = MODEL_CAPS['cdj-2000nxs2']

  it('warns about WAV files over 2GB', () => {
    const buf = makeWavBuffer({ formatTag: 0x0001, channels: 2, sampleRate: 44100, bitDepth: 24 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    const largeSize = 3 * 1024 * 1024 * 1024 // 3GB
    checkWav(h, caps, issues, largeSize)
    expect(issues.map(i => i.id)).toContain('WAV_FILE_TOO_LARGE')
    expect(issues.find(i => i.id === 'WAV_FILE_TOO_LARGE')?.severity).toBe('warning')
  })

  it('does NOT warn for normal-sized WAV files', () => {
    const buf = makeWavBuffer({ formatTag: 0x0001, channels: 2, sampleRate: 44100, bitDepth: 24 })
    const h = parseWavHeader(buf)
    const issues: AudioIssue[] = []
    checkWav(h, caps, issues, 100 * 1024 * 1024) // 100MB
    expect(issues.map(i => i.id)).not.toContain('WAV_FILE_TOO_LARGE')
  })

  it('warns about AIFF files over 2GB', () => {
    const buf = makeAiffBuffer({ commFirst: true, sampleRate: 44100, bitDepth: 24, channels: 2 })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    const largeSize = 3 * 1024 * 1024 * 1024
    checkAiff(h, caps, issues, largeSize)
    expect(issues.map(i => i.id)).toContain('AIFF_FILE_TOO_LARGE')
  })
})

// ─── AIFC container warning tests ───────────────────────────────────────────

describe('AIFC container warnings', () => {
  const caps = MODEL_CAPS['cdj-2000']

  it('warns about AIFC container with NONE compression', () => {
    const buf = makeAiffBuffer({ isAifc: true, compressionType: 'NONE' })
    const h = parseAiffHeader(buf, buf.length)
    expect(h.valid).toBe(true)
    expect(h.isAifc).toBe(true)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    // Should NOT be in compressed list (NONE is uncompressed)
    expect(issues.map(i => i.id)).not.toContain('AIFF_COMPRESSED')
    // But SHOULD have AIFC container warning
    expect(issues.map(i => i.id)).toContain('AIFF_AIFC_CONTAINER')
  })

  it('warns about AIFC container with sowt compression', () => {
    const buf = makeAiffBuffer({ isAifc: true, compressionType: 'sowt' })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.map(i => i.id)).toContain('AIFF_AIFC_CONTAINER')
  })

  it('does NOT warn about standard AIFF (not AIFC)', () => {
    const buf = makeAiffBuffer({ isAifc: false })
    const h = parseAiffHeader(buf, buf.length)
    const issues: AudioIssue[] = []
    checkAiff(h, caps, issues)
    expect(issues.map(i => i.id)).not.toContain('AIFF_AIFC_CONTAINER')
  })
})

// ─── MP3 ID3v2.4 and ID3v1-only tests ───────────────────────────────────────

describe('MP3 ID3 version checks', () => {
  const caps = MODEL_CAPS['cdj-3000']

  it('detects ID3v2.4 and warns', () => {
    const buf = makeMp3Buffer({ insertId3: true })
    // Override ID3 version to 2.4
    buf[3] = 4 // major version = 4 (ID3v2.4)
    const h = parseMp3Header(buf, buf.length)
    expect(h).not.toBeNull()
    expect(h!.id3v2MajorVersion).toBe(4)
    const issues: AudioIssue[] = []
    checkMp3(h!, caps, issues)
    expect(issues.map(i => i.id)).toContain('MP3_ID3V24')
    expect(issues.find(i => i.id === 'MP3_ID3V24')?.severity).toBe('warning')
  })

  it('does NOT warn for ID3v2.3', () => {
    const buf = makeMp3Buffer({ insertId3: true })
    buf[3] = 3 // major version = 3 (ID3v2.3) — the preferred version
    const h = parseMp3Header(buf, buf.length)
    expect(h).not.toBeNull()
    expect(h!.id3v2MajorVersion).toBe(3)
    const issues: AudioIssue[] = []
    checkMp3(h!, caps, issues)
    expect(issues.map(i => i.id)).not.toContain('MP3_ID3V24')
  })

  it('detects ID3v1-only (no ID3v2) and warns', () => {
    const buf = makeMp3Buffer({ insertId3: false })
    // Add ID3v1 tag at end (last 128 bytes)
    buf.write('TAG', buf.length - 128, 'ascii')
    const h = parseMp3Header(buf, buf.length)
    expect(h).not.toBeNull()
    expect(h!.hasId3v1).toBe(true)
    expect(h!.id3v2MajorVersion).toBeNull()
    const issues: AudioIssue[] = []
    checkMp3(h!, caps, issues)
    expect(issues.map(i => i.id)).toContain('MP3_ID3V1_ONLY')
  })
})
