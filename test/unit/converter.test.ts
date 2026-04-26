import { describe, it, expect } from 'vitest'
import { buildFfmpegArgs, buildOutputPath } from '../../src/main/audio/converter'
import type { ConversionOptions } from '../../src/shared/ipc-types'

const defaultOptions: ConversionOptions = {
  outputFormat: 'aiff-24',
  outputMode: 'suffix',
  applyDither: true,
}

describe('buildOutputPath', () => {
  it('appends _djcheck suffix in suffix mode', () => {
    const out = buildOutputPath('/music/track.wav', new Set(['WAV_32BIT_FLOAT']), {
      ...defaultOptions,
      outputMode: 'suffix',
    })
    expect(out).toBe('/music/track_djcheck.aiff')
  })

  it('places output in chosen folder in folder mode', () => {
    const out = buildOutputPath('/music/track.wav', new Set(['WAV_32BIT_FLOAT']), {
      ...defaultOptions,
      outputMode: 'folder',
      outputFolder: '/output',
    })
    expect(out).toBe('/output/track.aiff')
  })

  it('converts FLAC to AIFF when FLAC_UNSUPPORTED issue present', () => {
    const out = buildOutputPath('/music/track.flac', new Set(['FLAC_UNSUPPORTED']), {
      ...defaultOptions,
      outputFormat: 'aiff-24',
    })
    expect(out.endsWith('.aiff')).toBe(true)
  })

  it('converts to WAV when outputFormat is wav-24', () => {
    const out = buildOutputPath('/music/track.flac', new Set(['FLAC_UNSUPPORTED']), {
      ...defaultOptions,
      outputFormat: 'wav-24',
    })
    expect(out.endsWith('.wav')).toBe(true)
  })

  it('keeps mp3 extension for MP3 issues', () => {
    const out = buildOutputPath('/music/track.mp3', new Set(['MP3_VBR_NO_XING']), {
      ...defaultOptions,
      outputFormat: 'mp3-320',
    })
    expect(out.endsWith('.mp3')).toBe(true)
  })
})

describe('buildFfmpegArgs — AIFF output', () => {
  it('uses pcm_s24be codec for aiff-24', () => {
    const { outputOptions } = buildFfmpegArgs('/track.wav', new Set(['WAV_32BIT_FLOAT']), 'aiff-24', false)
    expect(outputOptions.some(o => o.includes('pcm_s24be'))).toBe(true)
  })

  it('uses pcm_s16be codec for aiff-16', () => {
    const { outputOptions } = buildFfmpegArgs('/track.wav', new Set(['WAV_32BIT_FLOAT']), 'aiff-16', true)
    expect(outputOptions.some(o => o.includes('pcm_s16be'))).toBe(true)
  })

  it('includes dither filter when converting 32-bit float with applyDither=true', () => {
    const { audioFilters } = buildFfmpegArgs('/track.wav', new Set(['WAV_32BIT_FLOAT']), 'aiff-24', true)
    expect(audioFilters.some(f => f.includes('dither'))).toBe(true)
  })

  it('does NOT include dither when applyDither=false', () => {
    const { audioFilters } = buildFfmpegArgs('/track.wav', new Set(['WAV_EXTENSIBLE_PCM']), 'aiff-24', false)
    expect(audioFilters.some(f => f.includes('dither'))).toBe(false)
  })
})

describe('buildFfmpegArgs — WAV output', () => {
  it('includes -rf64 never to prevent EXTENSIBLE output', () => {
    const { outputOptions } = buildFfmpegArgs('/track.aiff', new Set(['AIFF_CHUNK_ORDER']), 'wav-24', false)
    expect(outputOptions).toContain('-rf64 never')
  })

  it('uses pcm_s24le for wav-24', () => {
    const { outputOptions } = buildFfmpegArgs('/track.aiff', new Set([]), 'wav-24', false)
    expect(outputOptions.some(o => o.includes('pcm_s24le'))).toBe(true)
  })

  it('uses pcm_s16le for wav-16 with dither', () => {
    const { outputOptions, audioFilters } = buildFfmpegArgs('/track.wav', new Set(['WAV_32BIT_FLOAT']), 'wav-16', true)
    expect(outputOptions.some(o => o.includes('pcm_s16le'))).toBe(true)
    expect(audioFilters.some(f => f.includes('dither'))).toBe(true)
  })
})

describe('buildFfmpegArgs — MP3 output', () => {
  it('uses libmp3lame at 320kbps for mp3-320', () => {
    const { outputOptions } = buildFfmpegArgs('/track.flac', new Set(['FLAC_UNSUPPORTED']), 'mp3-320', false)
    expect(outputOptions).toContain('-acodec libmp3lame')
    expect(outputOptions).toContain('-b:a 320k')
  })

  it('uses ID3v2.3 for CDJ compatibility', () => {
    const { outputOptions } = buildFfmpegArgs('/track.flac', new Set(['FLAC_UNSUPPORTED']), 'mp3-320', false)
    expect(outputOptions).toContain('-id3v2_version 3')
  })
})

describe('buildFfmpegArgs — sample rate', () => {
  it('adds -ar 44100 for high sample rate WAV', () => {
    const { outputOptions } = buildFfmpegArgs('/track.wav', new Set(['WAV_SAMPLE_RATE_HIGH']), 'aiff-24', false)
    expect(outputOptions).toContain('-ar 44100')
  })

  it('adds -ar 44100 for FLAC with high sample rate', () => {
    const { outputOptions } = buildFfmpegArgs('/track.flac', new Set(['FLAC_SAMPLE_RATE_HIGH']), 'aiff-24', false)
    expect(outputOptions).toContain('-ar 44100')
  })

  it('does NOT add -ar for clean 44.1kHz files', () => {
    const { outputOptions } = buildFfmpegArgs('/track.wav', new Set(['WAV_EXTENSIBLE_PCM']), 'aiff-24', false)
    expect(outputOptions).not.toContain('-ar 44100')
  })
})

describe('buildFfmpegArgs — multichannel', () => {
  it('adds downmix pan filter for multichannel WAV', () => {
    const { audioFilters, outputOptions } = buildFfmpegArgs(
      '/track.wav', new Set(['WAV_MULTICHANNEL']), 'aiff-24', false
    )
    expect(outputOptions).toContain('-ac 2')
    expect(audioFilters.some(f => f.includes('pan=stereo'))).toBe(true)
  })
})

describe('buildFfmpegArgs — metadata', () => {
  it('always includes -map_metadata 0', () => {
    const { outputOptions } = buildFfmpegArgs('/track.wav', new Set([]), 'aiff-24', false)
    expect(outputOptions).toContain('-map_metadata 0')
  })

  it('includes -write_id3v2 1 for WAV output', () => {
    const { outputOptions } = buildFfmpegArgs('/track.flac', new Set(['FLAC_UNSUPPORTED']), 'wav-24', false)
    expect(outputOptions).toContain('-write_id3v2 1')
  })
})

describe('buildFfmpegArgs — AIFF chunk order fix', () => {
  it('uses -acodec copy for AIFF chunk-order-only fix', () => {
    const { outputOptions } = buildFfmpegArgs(
      '/track.aiff', new Set(['AIFF_CHUNK_ORDER']), 'aiff-24', false
    )
    // Should use copy codec since no other audio changes are needed
    expect(outputOptions.some(o => o.includes('copy'))).toBe(true)
  })

  it('does NOT use copy codec when AIFF also needs resampling', () => {
    const { outputOptions } = buildFfmpegArgs(
      '/track.aiff', new Set(['AIFF_CHUNK_ORDER', 'AIFF_SAMPLE_RATE_HIGH']), 'aiff-24', false
    )
    expect(outputOptions.some(o => o.includes('copy'))).toBe(false)
    expect(outputOptions.some(o => o.includes('pcm_s'))).toBe(true)
  })
})
