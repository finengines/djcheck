export type CDJModel =
  | 'cdj-2000'      // CDJ-2000, CDJ-900, CDJ-850, CDJ-400, CDJ-350 — oldest
  | 'cdj-2000nxs'   // CDJ-2000NXS, XDJ-1000 — 44.1/48kHz, no FLAC/ALAC
  | 'cdj-2000nxs2'  // CDJ-2000NXS2, XDJ-1000MK2 — FLAC, ALAC, 96kHz
  | 'cdj-3000'      // CDJ-3000 — FLAC, ALAC, strictest MP3
  | 'cdj-3000x'     // CDJ-3000X — FLAC, ALAC, exFAT, 96kHz
  | 'all'           // All CDJs: most restrictive rules (widest compatibility)

export type AudioFormat = 'wav' | 'aiff' | 'mp3' | 'aac' | 'alac' | 'flac' | 'ogg' | 'unknown'

export type ErrorCode = 'E-8302' | 'E-8304' | 'E-8305' | 'E-8306' | 'WARNING' | 'UNSUPPORTED'

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface AudioIssue {
  code: ErrorCode
  id: string
  description: string
  severity: IssueSeverity
  canAutoFix: boolean
  isLossless: boolean
}

export interface TrackAnalysis {
  id: string
  filePath: string
  fileName: string
  fileSize: number
  format: AudioFormat
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  bitrate: number | null
  duration: number | null
  codec: string | null
  issues: AudioIssue[]
  status: 'pending' | 'analyzing' | 'done' | 'error'
  analysisError?: string
  hasArtwork?: boolean
  artworkFormat?: string | null
  /** The folder root this track was scanned from (for replicating folder tree in output) */
  sourceRoot?: string
  /** Integrated loudness in LUFS (EBU R128), measured during analysis. null if not yet measured. */
  lufs?: number | null
  /** Loudness range in LU (EBU R128). null if not yet measured. */
  lra?: number | null
  /** True peak in dBTP. null if not yet measured. */
  truePeakDb?: number | null
}

/** A file discovered during a folder scan */
export interface ScannedFile {
  filePath: string
  /** The top-level folder the user dropped / selected — used to replicate the tree in output */
  sourceRoot: string
}

export interface ConversionResult {
  trackId: string
  success: boolean
  outputPath?: string
  error?: string
  warnings?: string[]
  /** Loudness data — only present when normalization was enabled */
  loudness?: {
    /** Input integrated loudness (LUFS) — measured before processing */
    inputLufs: number
    /** Output integrated loudness (LUFS) — measured after processing (approx = target) */
    outputLufs: number
    /** Gain applied in dB (positive = louder, negative = quieter) */
    gainDb: number
    /** Input true peak (dBTP) */
    inputTruePeak: number
    /** Input loudness range (LU) */
    inputLra: number
    /** Whether normalization was skipped (file already at target ±0.5 dB) */
    skipped: boolean
  }
}

export interface ConversionProgress {
  trackId: string
  percent: number
  stage: 'preparing' | 'measuring' | 'converting' | 'writing-tags' | 'done'
}

export type OutputFormat = 'aiff-24' | 'aiff-16' | 'wav-24' | 'wav-16' | 'mp3-320'

/**
 * replace   — overwrite the original file in its source directory
 *             (same ext: literal overwrite; format change: new ext, original deleted)
 * subfolder — create a named subfolder inside each file's own directory
 * folder    — save to a user-chosen folder, replicating the sub-tree when sourceRoot is set
 * mirror    — create a sibling folder at the source root with the full tree replicated,
 *             containing only converted files (ideal for Rekordbox playlist prep)
 */
export type OutputMode = 'replace' | 'subfolder' | 'folder' | 'mirror'

export interface ConversionOptions {
  outputFormat: OutputFormat
  outputMode: OutputMode
  outputFolder?: string
  rekordboxXmlPath?: string
  applyDither: boolean
  /** Whether to apply loudness normalization after conversion */
  normalize?: boolean
  /** Target integrated loudness in LUFS (default: -14) */
  normalizeTargetLufs?: number
  /** Maximum true peak in dBTP (default: -1.0) */
  normalizeTruePeak?: number
}

/** Options for standalone normalization (not part of conversion) */
export interface StandaloneNormalizeOptions {
  /** Target integrated loudness in LUFS. Default: -14 */
  targetLufs: number
  /** Maximum true peak in dBTP. Default: -1.0 */
  truePeak: number
  /** Output format for normalized files */
  outputFormat: OutputFormat
  /** Whether to apply dither */
  applyDither: boolean
}

export interface NormalizeFilesPayload {
  files: Array<{ filePath: string; sourceRoot?: string }>
  options: StandaloneNormalizeOptions
}

export interface NormalizeProgress {
  filePath: string
  percent: number
  stage: 'measuring' | 'normalizing' | 'done'
}

export interface NormalizeResult {
  filePath: string
  success: boolean
  outputPath?: string
  error?: string
  loudness?: {
    inputLufs: number
    outputLufs: number
    gainDb: number
    inputTruePeak: number
    inputLra: number
    skipped: boolean
  }
}

export const IPC_CHANNELS = {
  ANALYZE_FILES: 'analyze:files',
  CANCEL_ANALYSIS: 'analyze:cancel',
  ANALYSIS_PROGRESS: 'analyze:progress',
  ANALYSIS_RESULT: 'analyze:result',
  ANALYSIS_COMPLETE: 'analyze:complete',

  CONVERT_TRACKS: 'convert:tracks',
  CANCEL_CONVERSION: 'convert:cancel',
  CONVERSION_PROGRESS: 'convert:progress',
  CONVERSION_RESULT: 'convert:result',
  CONVERSION_COMPLETE: 'convert:complete',

  NORMALIZE_FILES: 'normalize:files',
  CANCEL_NORMALIZE: 'normalize:cancel',
  NORMALIZE_PROGRESS: 'normalize:progress',
  NORMALIZE_RESULT: 'normalize:result',
  NORMALIZE_COMPLETE: 'normalize:complete',

  PICK_OUTPUT_FOLDER: 'dialog:pick-output-folder',
  PICK_REKORDBOX_XML: 'dialog:pick-rekordbox-xml',
  PICK_AUDIO_FILES: 'dialog:pick-audio-files',
  PICK_INPUT_FOLDER: 'dialog:pick-input-folder',
  SCAN_FOLDERS: 'dialog:scan-folders',
  OPEN_FILE_EXTERNALLY: 'shell:open-file',
  REVEAL_IN_FINDER: 'shell:reveal',

  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',

  PREFLIGHT_RESULT: 'preflight:result',
} as const

export interface AnalyzeFilesPayload {
  files: Array<{ filePath: string; sourceRoot?: string }>
  targetModel: CDJModel
  measureLoudness?: boolean
}

export interface ConvertTracksPayload {
  tracks: Array<{ trackId: string; filePath: string; issues: AudioIssue[]; sourceRoot?: string }>
  targetModel: CDJModel
  options: ConversionOptions
}

export interface AppSettings {
  targetModel: CDJModel
  outputFormat: OutputFormat
  outputMode: OutputMode
  outputFolder: string | null
  onboardingComplete: boolean
  applyDither: boolean
  normalize: boolean
  normalizeTargetLufs: number
}

export const MODEL_LABELS: Record<CDJModel, string> = {
  'cdj-2000': 'CDJ-2000 / CDJ-900 / CDJ-850',
  'cdj-2000nxs': 'CDJ-2000NXS / XDJ-1000',
  'cdj-2000nxs2': 'CDJ-2000NXS2 / XDJ-1000MK2',
  'cdj-3000': 'CDJ-3000',
  'cdj-3000x': 'CDJ-3000X',
  'all': 'All CDJs (widest compatibility)',
}

export const MODEL_DESCRIPTIONS: Record<CDJModel, string> = {
  'cdj-2000': '44.1/48kHz WAV & AIFF only. No FLAC or ALAC.',
  'cdj-2000nxs': '44.1/48kHz WAV & AIFF only. No FLAC or ALAC.',
  'cdj-2000nxs2': 'Up to 96kHz. FLAC & ALAC supported.',
  'cdj-3000': 'Up to 96kHz. FLAC & ALAC supported. Strictest MP3 validation.',
  'cdj-3000x': 'Up to 96kHz. FLAC, ALAC, exFAT. Same audio specs as CDJ-3000.',
  'all': 'Checks against all CDJ models. Most restrictive rules ensure tracks play everywhere.',
}
