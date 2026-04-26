import * as path from 'path'
import * as fs from 'fs/promises'
import type { AudioIssue, OutputFormat, ConversionOptions } from '../../shared/ipc-types'

// ffmpeg path is injected at runtime after app initialises
let ffmpegPath = ''
let ffprobePath = ''

export function setFfmpegPaths(ffmpeg: string, ffprobe: string): void {
  ffmpegPath = ffmpeg
  ffprobePath = ffprobe
}

export function getFfmpegPath(): string { return ffmpegPath }
export function getFfprobePath(): string { return ffprobePath }

export interface ConversionJob {
  trackId: string
  filePath: string
  issues: AudioIssue[]
  options: ConversionOptions
  /** Original folder root the file was scanned from — used to replicate tree in output */
  sourceRoot?: string
  onProgress: (percent: number, stage: 'preparing' | 'converting' | 'writing-tags' | 'done') => void
}

// ─── WAV_EXTENSIBLE in-place patch (WavPatcher approach) ──────────────────────
// Fastest fix: seek to byte 20 and overwrite format tag 0xFFFE → 0x0001
// Only safe when the subformat GUID is standard PCM
export async function patchWavExtensible(filePath: string): Promise<boolean> {
  try {
    const fh = await fs.open(filePath, 'r+')
    try {
      const buf = Buffer.alloc(2)
      await fh.read(buf, 0, 2, 20)
      const tag = buf.readUInt16LE(0)
      if (tag === 0xfffe) {
        await fh.write(Buffer.from([0x01, 0x00]), 0, 2, 20)
        return true
      }
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
  return false
}

// ─── MP3 passthrough logic ────────────────────────────────────────────────────
// If the source is already an MP3, always re-encode as MP3 rather than
// converting to a lossless format — transcoding lossy→lossless wastes space
// and adds a generation of quality loss with no benefit.

function isSourceMp3(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.mp3'
}

/** The effective output format, honouring MP3 passthrough. */
function effectiveFormat(filePath: string, outputFormat: OutputFormat): OutputFormat {
  return isSourceMp3(filePath) ? 'mp3-320' : outputFormat
}

// ─── Build output path ────────────────────────────────────────────────────────

export function buildOutputPath(
  filePath: string,
  issueIds: Set<string>,
  options: ConversionOptions,
  /** Original scan-root folder — when provided the relative sub-path is preserved in 'folder' mode */
  sourceRoot?: string
): string {
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath, ext)
  const dir = path.dirname(filePath)

  const fmt = effectiveFormat(filePath, options.outputFormat)
  const outExt = getOutputExtension(ext, issueIds, fmt)

  switch (options.outputMode) {
    case 'replace':
      // Same directory, same basename — just update the extension.
      // If the extension hasn't changed this is a literal in-place overwrite.
      return path.join(dir, `${base}.${outExt}`)

    case 'subfolder':
      // <sourceDir>/djcheck/<basename>.<ext>  — keeps files alongside originals
      // but neatly separated in a sub-folder inside each source directory.
      return path.join(dir, 'djcheck', `${base}.${outExt}`)

    case 'folder':
    default:
      if (options.outputFolder) {
        if (sourceRoot) {
          // Replicate the sub-folder tree: <outputFolder>/<relative/path>/<base.ext>
          const relDir = path.relative(sourceRoot, dir)
          return path.join(options.outputFolder, relDir, `${base}.${outExt}`)
        }
        return path.join(options.outputFolder, `${base}.${outExt}`)
      }
      // Fallback if no folder chosen — use subfolder behaviour
      return path.join(dir, 'djcheck', `${base}.${outExt}`)
  }
}

function getOutputExtension(
  origExt: string,
  issueIds: Set<string>,
  outputFormat: OutputFormat
): string {
  // Format conversions (FLAC/ALAC/OGG → user-chosen lossless or MP3)
  if (issueIds.has('FLAC_UNSUPPORTED') || issueIds.has('ALAC_UNSUPPORTED') ||
      issueIds.has('OGG_UNSUPPORTED') ||
      issueIds.has('FLAC_SAMPLE_RATE_HIGH') || issueIds.has('FLAC_BIT_DEPTH')) {
    return formatToExt(outputFormat)
  }
  // MP3 passthrough — always stay MP3 (effectiveFormat already enforces this,
  // but guard here too in case buildOutputPath is called directly in tests)
  if (origExt === '.mp3') return 'mp3'
  // WAV/AIFF → user-chosen format
  return formatToExt(outputFormat)
}

function formatToExt(format: OutputFormat): string {
  switch (format) {
    case 'aiff-24': case 'aiff-16': return 'aiff'
    case 'wav-24': case 'wav-16': return 'wav'
    case 'mp3-320': return 'mp3'
  }
}

// ─── ffmpeg argument builder ──────────────────────────────────────────────────

interface FfmpegArgs {
  outputOptions: string[]
  audioFilters: string[]
  needsConversion: boolean
}

export function buildFfmpegArgs(
  filePath: string,
  issueIds: Set<string>,
  outputFormat: OutputFormat,
  applyDither: boolean
): FfmpegArgs {
  const outputOptions: string[] = []
  const audioFilters: string[] = []
  const origExt = path.extname(filePath).toLowerCase()
  // Honour MP3 passthrough: if source is MP3 always output as MP3
  const fmt = effectiveFormat(filePath, outputFormat)
  const outExt = formatToExt(fmt)

  // Determine output codec
  const targetBitDepth = fmt.includes('-16') ? 16 : 24
  const isDitherNeeded = outExt !== 'mp3' && applyDither && (
    targetBitDepth === 16 ||
    issueIds.has('WAV_32BIT_FLOAT') ||
    issueIds.has('AIFF_BIT_DEPTH_32') ||
    issueIds.has('WAV_BIT_DEPTH_32INT')
  )

  if (outExt === 'aiff') {
    const codec = targetBitDepth === 16 ? 'pcm_s16be' : 'pcm_s24be'
    outputOptions.push(`-acodec ${codec}`)
  } else if (outExt === 'wav') {
    const codec = targetBitDepth === 16 ? 'pcm_s16le' : 'pcm_s24le'
    outputOptions.push(`-acodec ${codec}`)
    // CRITICAL: prevent ffmpeg from outputting WAVE_FORMAT_EXTENSIBLE for 24-bit WAV
    outputOptions.push('-rf64 never')
  } else if (outExt === 'mp3') {
    outputOptions.push('-acodec libmp3lame')
    outputOptions.push('-b:a 320k')
    outputOptions.push('-q:a 0')
    outputOptions.push('-id3v2_version 3') // ID3v2.3 for widest CDJ compatibility
    outputOptions.push('-write_id3v1 1')
  }

  // Sample rate normalisation
  const needsResample =
    issueIds.has('WAV_SAMPLE_RATE_HIGH') || issueIds.has('WAV_SAMPLE_RATE_LOW') ||
    issueIds.has('AIFF_SAMPLE_RATE_HIGH') || issueIds.has('AIFF_SAMPLE_RATE_LOW') ||
    issueIds.has('MP3_INVALID_SAMPLE_RATE') || issueIds.has('MP3_MPEG2_SAMPLE_RATE') ||
    issueIds.has('FLAC_SAMPLE_RATE_HIGH')
  if (needsResample) {
    outputOptions.push('-ar 44100')
  }

  // Multichannel → stereo downmix
  if (issueIds.has('WAV_MULTICHANNEL') || issueIds.has('AIFF_MULTICHANNEL')) {
    outputOptions.push('-ac 2')
    // Pan filter for better stereo downmix (preserves center content)
    audioFilters.push('pan=stereo|FL=0.5*FL+0.5*FC+0.3*LFE+0.5*BL|FR=0.5*FR+0.5*FC+0.3*LFE+0.5*BR')
  } else if (issueIds.has('WAV_MONO') || issueIds.has('AIFF_MONO')) {
    // Upmix mono to stereo
    outputOptions.push('-ac 2')
  } else {
    outputOptions.push('-ac 2')
  }

  // Dithering when reducing bit depth
  if (isDitherNeeded) {
    audioFilters.push('dither=method=triangular')
  }

  // Preserve all metadata
  outputOptions.push('-map_metadata 0')
  if (outExt === 'wav') {
    outputOptions.push('-write_id3v2 1')
  }

  // For AIFF chunk order fix only (no audio changes): use copy codec
  const isAiffContainerFixOnly =
    (origExt === '.aif' || origExt === '.aiff') &&
    issueIds.has('AIFF_CHUNK_ORDER') &&
    !issueIds.has('AIFF_COMPRESSED') &&
    !issueIds.has('AIFF_SAMPLE_RATE_HIGH') &&
    !issueIds.has('AIFF_SAMPLE_RATE_LOW') &&
    !issueIds.has('AIFF_BIT_DEPTH_8') &&
    !issueIds.has('AIFF_BIT_DEPTH_32') &&
    !issueIds.has('AIFF_MULTICHANNEL') &&
    outExt === 'aiff' &&
    !needsResample
  if (isAiffContainerFixOnly) {
    // Replace codec with copy — just remux the container
    const codecIdx = outputOptions.findIndex(o => o.startsWith('-acodec'))
    if (codecIdx !== -1) outputOptions[codecIdx] = '-acodec copy'
    const rfIdx = outputOptions.indexOf('-rf64 never')
    if (rfIdx !== -1) outputOptions.splice(rfIdx, 1)
  }

  const needsConversion = !issueIds.has('WAV_EXTENSIBLE_PCM') // pure patch handled separately

  return { outputOptions, audioFilters, needsConversion }
}

// ─── Run ffmpeg conversion ────────────────────────────────────────────────────

export async function runFfmpeg(
  inputPath: string,
  outputPath: string,
  outputOptions: string[],
  audioFilters: string[],
  onProgress: (percent: number) => void
): Promise<void> {
  const { default: Ffmpeg } = await import('fluent-ffmpeg')
  Ffmpeg.setFfmpegPath(ffmpegPath)

  return new Promise((resolve, reject) => {
    let cmd = Ffmpeg(inputPath)

    if (audioFilters.length > 0) {
      cmd = cmd.audioFilters(audioFilters)
    }

    // Split compound options and add individually
    for (const opt of outputOptions) {
      const parts = opt.split(' ')
      cmd = cmd.outputOption(...parts)
    }

    cmd
      .output(outputPath)
      .on('progress', (p: { percent?: number }) => {
        onProgress(Math.min(99, p.percent ?? 0))
      })
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run()
  })
}

// ─── Main conversion entry point ─────────────────────────────────────────────

export async function convertTrack(job: ConversionJob): Promise<string> {
  const { filePath, issues, options, onProgress } = job
  const issueIds = new Set(issues.map(i => i.id))

  onProgress(0, 'preparing')

  // Fast path: WAV_EXTENSIBLE_PCM — in-place 2-byte header patch
  if (issueIds.has('WAV_EXTENSIBLE_PCM') && issueIds.size === 1) {
    const patched = await patchWavExtensible(filePath)
    if (patched) {
      onProgress(100, 'done')
      return filePath // same file, patched in-place
    }
    // Fall through to full conversion if patch failed
  }

  // Full ffmpeg conversion
  const outputPath = buildOutputPath(filePath, issueIds, options, job.sourceRoot)

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const { outputOptions, audioFilters } = buildFfmpegArgs(
    filePath, issueIds, options.outputFormat, options.applyDither
  )

  onProgress(5, 'converting')

  // If output === input (replace mode, same extension) write to a temp file first
  // then atomically rename so we never corrupt the original on failure.
  const sameFile = path.resolve(outputPath) === path.resolve(filePath)
  const ffmpegTarget = sameFile
    ? path.join(path.dirname(outputPath), `.__djcheck_tmp_${path.basename(outputPath)}`)
    : outputPath

  await runFfmpeg(filePath, ffmpegTarget, outputOptions, audioFilters, (pct) => {
    onProgress(5 + Math.floor(pct * 0.9), 'converting')
  })

  if (sameFile) {
    await fs.rename(ffmpegTarget, outputPath)
  }

  onProgress(98, 'writing-tags')
  onProgress(100, 'done')

  return outputPath
}
