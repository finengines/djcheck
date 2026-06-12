import * as path from 'path'
import * as fs from 'fs/promises'
import { getFfmpegPath } from './converter'
import type { OutputFormat } from '../../shared/ipc-types'

// ─── Loudness normalization via two-pass ffmpeg loudnorm ────────────────────
// Implements EBU R128 (ITU-R BS.1770) with K-weighted filtering.
// Two-pass + linear=true applies a SINGLE constant gain to the entire file —
// equivalent to turning a volume knob. Zero compression, zero limiting,
// zero transient damage.
//
// Inspired by Platinum Notes' goal of consistent loudness across a DJ library,
// but deliberately avoids PN's use of brick-wall limiting which destroys
// dynamics and transients. Instead, we use pure linear gain adjustment.

export interface NormalizeOptions {
  /** Target integrated loudness in LUFS. Default: -14 (Spotify/YouTube standard) */
  targetLufs: number
  /** Maximum true peak in dBTP. Default: -1.0 (safe headroom) */
  truePeak: number
  /** Target loudness range in LU. Default: 20 (generous — prevents dynamic fallback) */
  lra: number
  /** Whether to apply dither when reducing bit depth. Default: false */
  applyDither: boolean
  /** Output format for standalone normalization (when not part of conversion). Default: same as input */
  outputFormat?: OutputFormat
}

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = {
  targetLufs: -14,
  truePeak: -1.0,
  lra: 20,
  applyDither: false,
}

export interface LoudnessMeasurement {
  /** Measured integrated loudness (LUFS) */
  inputI: number
  /** Measured true peak (dBTP) */
  inputTp: number
  /** Measured loudness range (LU) */
  inputLra: number
  /** Measured threshold (LUFS) */
  inputThresh: number
  /** Target offset gain (dB) */
  targetOffset: number
  /** Whether normalization type stayed linear (false = fell back to dynamic) */
  normalizationType: 'linear' | 'dynamic'
}

export interface NormalizeResult {
  outputPath: string
  measurement: LoudnessMeasurement
  /** dB gain applied */
  gainDb: number
  /** Whether the file was already at or below target (no amplification needed) */
  skipped: boolean
}

// ─── Pass 1: Measure loudness ──────────────────────────────────────────────

export async function measureLoudness(
  inputPath: string,
  options: NormalizeOptions
): Promise<LoudnessMeasurement> {
  const ffmpegPath = getFfmpegPath()
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  const filter = `loudnorm=I=${options.targetLufs}:TP=${options.truePeak}:LRA=${options.lra}:print_format=json`

  const { stderr } = await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-i', inputPath,
    '-af', filter,
    '-f', 'null',
    '-',
  ])

  // Extract JSON block from stderr
  const jsonMatch = stderr.match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/)
  if (!jsonMatch) {
    throw new Error('Failed to parse loudness measurement from ffmpeg output')
  }

  const data = JSON.parse(jsonMatch[0])

  return {
    inputI: parseFloat(data.input_i),
    inputTp: parseFloat(data.input_tp),
    inputLra: parseFloat(data.input_lra),
    inputThresh: parseFloat(data.input_thresh),
    targetOffset: parseFloat(data.target_offset),
    normalizationType: (data.normalization_type || 'linear') as 'linear' | 'dynamic',
  }
}

// ─── Pass 2: Apply linear normalization ─────────────────────────────────────

async function applyNormalization(
  inputPath: string,
  outputPath: string,
  measurement: LoudnessMeasurement,
  options: NormalizeOptions,
  outputCodecArgs: string[],
  onProgress?: (percent: number) => void
): Promise<void> {
  const { default: Ffmpeg } = await import('fluent-ffmpeg')
  Ffmpeg.setFfmpegPath(getFfmpegPath())

  const filter = [
    `loudnorm=I=${options.targetLufs}:TP=${options.truePeak}:LRA=${options.lra}`,
    `measured_I=${measurement.inputI}`,
    `measured_TP=${measurement.inputTp}`,
    `measured_LRA=${measurement.inputLra}`,
    `measured_thresh=${measurement.inputThresh}`,
    `offset=${measurement.targetOffset}`,
    `linear=true`,
  ].join(':')

  return new Promise((resolve, reject) => {
    let cmd = Ffmpeg(inputPath).audioFilters(filter)

    // Add codec/format args
    for (const opt of outputCodecArgs) {
      const parts = opt.split(' ')
      cmd = cmd.outputOption(...parts)
    }

    cmd
      .output(outputPath)
      .on('progress', (p: { percent?: number }) => {
        onProgress?.(Math.min(99, p.percent ?? 0))
      })
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run()
  })
}

// ─── Build codec args from output format ────────────────────────────────────

function buildCodecArgs(
  inputPath: string,
  outputFormat: OutputFormat,
  sampleRate: number,
  applyDither: boolean
): string[] {
  const fmt = inputPath.toLowerCase().endsWith('.mp3') ? 'mp3-320' as OutputFormat : outputFormat
  const args: string[] = []

  switch (fmt) {
    case 'aiff-24':
      args.push('-acodec pcm_s24be')
      break
    case 'aiff-16':
      args.push('-acodec pcm_s16be')
      if (applyDither) args.push('-af dither=method=triangular')
      break
    case 'wav-24':
      args.push('-acodec pcm_s24le', '-rf64 never')
      break
    case 'wav-16':
      args.push('-acodec pcm_s16le', '-rf64 never')
      if (applyDither) args.push('-af dither=method=triangular')
      break
    case 'mp3-320':
      args.push('-acodec libmp3lame', '-b:a 320k', '-q:a 0', '-id3v2_version 3', '-write_id3v1 1')
      break
  }

  args.push('-ar', String(sampleRate || 44100))
  args.push('-ac', '2')
  args.push('-map_metadata', '0')

  return args
}

// ─── Get output extension for a format ──────────────────────────────────────

function formatToExt(format: OutputFormat): string {
  switch (format) {
    case 'aiff-24': case 'aiff-16': return 'aiff'
    case 'wav-24': case 'wav-16': return 'wav'
    case 'mp3-320': return 'mp3'
  }
}

// ─── Main entry: normalize a file (standalone) ─────────────────────────────

export async function normalizeFile(
  inputPath: string,
  options: Partial<NormalizeOptions>,
  onProgress?: (percent: number, stage: 'measuring' | 'normalizing' | 'done') => void
): Promise<NormalizeResult> {
  const opts = { ...DEFAULT_NORMALIZE_OPTIONS, ...options }

  onProgress?.(0, 'measuring')

  // Pass 1: Measure loudness
  const measurement = await measureLoudness(inputPath, opts)

  const gainDb = opts.targetLufs - measurement.inputI

  // If the file is already at or below target, skip (don't amplify)
  // We still apply normalization if the file is ABOVE target (needs gain reduction)
  if (gainDb <= 0 && Math.abs(gainDb) < 0.5) {
    // Within 0.5 dB of target — close enough, skip
    onProgress?.(100, 'done')
    return {
      outputPath: inputPath,
      measurement,
      gainDb: 0,
      skipped: true,
    }
  }

  // Build output path — same directory, "_normalized" suffix
  const ext = path.extname(inputPath)
  const base = path.basename(inputPath, ext)
  const dir = path.dirname(inputPath)
  const outFormat = opts.outputFormat || 'aiff-24'
  const outExt = formatToExt(outFormat)
  const outputPath = path.join(dir, `${base}_normalized.${outExt}`)

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  // Build codec args
  const codecArgs = buildCodecArgs(inputPath, outFormat, 44100, opts.applyDither)

  onProgress?.(30, 'normalizing')

  // Pass 2: Apply linear normalization
  await applyNormalization(inputPath, outputPath, measurement, opts, codecArgs, (pct) => {
    onProgress?.(30 + Math.floor(pct * 0.65), 'normalizing')
  })

  onProgress?.(100, 'done')

  return {
    outputPath,
    measurement,
    gainDb,
    skipped: false,
  }
}

// ─── Build loudnorm filter string for use during conversion ─────────────────
// This is the "convert + normalize" path — the loudnorm filter is appended
// to the existing audio filter chain so it runs in a single ffmpeg pass pair.

export interface NormalizationFilterResult {
  /** The loudnorm measurement filter (pass 1) */
  measureFilter: string
  /** The loudnorm apply filter (pass 2) with measured values + linear=true */
  applyFilter: (measurement: LoudnessMeasurement) => string
  /** Measured loudness (populated after pass 1) */
  measureLoudness: (inputPath: string, options: NormalizeOptions) => Promise<LoudnessMeasurement>
}

export function createNormalizationFilter(options: NormalizeOptions): NormalizationFilterResult {
  const measureFilter = `loudnorm=I=${options.targetLufs}:TP=${options.truePeak}:LRA=${options.lra}:print_format=json`

  const applyFilter = (m: LoudnessMeasurement): string => {
    return [
      `loudnorm=I=${options.targetLufs}:TP=${options.truePeak}:LRA=${options.lra}`,
      `measured_I=${m.inputI}`,
      `measured_TP=${m.inputTp}`,
      `measured_LRA=${m.inputLra}`,
      `measured_thresh=${m.inputThresh}`,
      `offset=${m.targetOffset}`,
      `linear=true`,
    ].join(':')
  }

  return {
    measureFilter,
    applyFilter,
    measureLoudness: (inputPath, opts) => measureLoudness(inputPath, opts),
  }
}

// ─── Convert + Normalize in one pipeline ────────────────────────────────────
// Runs a two-pass conversion: Pass 1 measures loudness, Pass 2 converts + normalizes.

export async function convertAndNormalize(
  inputPath: string,
  outputPath: string,
  existingFilters: string[],
  existingOptions: string[],
  normalizeOpts: NormalizeOptions,
  onProgress?: (percent: number, stage: 'measuring' | 'converting' | 'done') => void
): Promise<{ outputPath: string; measurement: LoudnessMeasurement; gainDb: number }> {
  onProgress?.(0, 'measuring')

  // Pass 1: Measure loudness from the input file
  const measurement = await measureLoudness(inputPath, normalizeOpts)
  const gainDb = normalizeOpts.targetLufs - measurement.inputI

  // If already within 0.5 dB of target, skip normalization and just convert normally
  const skipNorm = gainDb <= 0 && Math.abs(gainDb) < 0.5

  onProgress?.(30, 'converting')

  // Build the combined filter chain
  const allFilters = [...existingFilters]
  if (!skipNorm) {
    allFilters.push(
      [
        `loudnorm=I=${normalizeOpts.targetLufs}:TP=${normalizeOpts.truePeak}:LRA=${normalizeOpts.lra}`,
        `measured_I=${measurement.inputI}`,
        `measured_TP=${measurement.inputTp}`,
        `measured_LRA=${measurement.inputLra}`,
        `measured_thresh=${measurement.inputThresh}`,
        `offset=${measurement.targetOffset}`,
        `linear=true`,
      ].join(':')
    )
  }

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  // Pass 2: Convert + normalize
  const { default: Ffmpeg } = await import('fluent-ffmpeg')
  Ffmpeg.setFfmpegPath(getFfmpegPath())

  return new Promise((resolve, reject) => {
    let cmd = Ffmpeg(inputPath)

    if (allFilters.length > 0) {
      cmd = cmd.audioFilters(allFilters)
    }

    for (const opt of existingOptions) {
      const parts = opt.split(' ')
      cmd = cmd.outputOption(...parts)
    }

    // Ensure sample rate is set (loudnorm defaults to 192kHz output otherwise)
    const hasAr = existingOptions.some(o => o.startsWith('-ar'))
    if (!hasAr) {
      cmd = cmd.outputOption('-ar', '44100')
    }

    cmd
      .output(outputPath)
      .on('progress', (p: { percent?: number }) => {
        onProgress?.(30 + Math.floor((p.percent ?? 0) * 0.65), 'converting')
      })
      .on('end', () => {
        onProgress?.(100, 'done')
        resolve({ outputPath, measurement, gainDb: skipNorm ? 0 : gainDb })
      })
      .on('error', (err: Error) => reject(err))
      .run()
  })
}
