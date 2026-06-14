/**
 * types.ts — Shared types for Rekordbox PDB/ANLZ structures
 *
 * These types model the binary Pioneer DeviceSQL database (PDB) and
 * ANLZ analysis files used by Rekordbox-formatted USB drives.
 *
 * Binary format references:
 *   - PDB: github.com/ambientsound/rex (Go), github.com/Radexito/DjManager (JS)
 *   - ANLZ: github.com/hrydgard/minirekordbox, crate-digger (Rust)
 *
 * All multi-byte integers in PDB are **little-endian**.
 * All multi-byte integers in ANLZ are **big-endian**.
 */

// ─── PDB Types ─────────────────────────────────────────────────────────────────

/**
 * Pioneer file-type codes stored in the Track row's FileType field (u16 LE).
 * These determine which decoder the CDJ uses to read the audio file.
 */
export const PIONEER_FILE_TYPES = {
  MP3: 0x01,
  M4A_AAC: 0x04,
  FLAC: 0x05,
  AIFF: 0x06,
  WAV: 0x0b,
} as const

export type PioneerFileType = (typeof PIONEER_FILE_TYPES)[keyof typeof PIONEER_FILE_TYPES]

/**
 * Maps a file extension to the corresponding Pioneer FileType code.
 * Used when rewriting the PDB track row after conversion.
 */
export function extensionToFileType(ext: string): PioneerFileType {
  switch (ext.toLowerCase().replace('.', '')) {
    case 'mp3':  return PIONEER_FILE_TYPES.MP3
    case 'm4a':
    case 'aac':  return PIONEER_FILE_TYPES.M4A_AAC
    case 'flac': return PIONEER_FILE_TYPES.FLAC
    case 'aif':
    case 'aiff': return PIONEER_FILE_TYPES.AIFF
    case 'wav':
    case 'wave': return PIONEER_FILE_TYPES.WAV
    default:     return PIONEER_FILE_TYPES.MP3
  }
}

/**
 * PDB table type identifiers. The PDB file contains 20 tables in a
 * fixed order (see TABLE_ORDER in pdb-writer.ts). Each table has an
 * index page followed by one or more data pages.
 */
export const PDB_TABLE_TYPES = {
  Tracks: 0,
  Genres: 1,
  Artists: 2,
  Albums: 3,
  Labels: 4,
  Keys: 5,
  Colors: 6,
  PlaylistTree: 7,
  PlaylistEntries: 8,
  Unknown9: 9,
  Unknown10: 10,
  HistoryPlaylists: 11,
  HistoryEntries: 12,
  Artwork: 13,
  Unknown14: 14,
  Unknown15: 15,
  Columns: 16,
  Unknown17: 17,
  Unknown18: 18,
  History: 19,
} as const

/**
 * A single track row read from the PDB.
 *
 * This is a simplified representation of the 136+ byte track row.
 * The full row has a 94-byte fixed header, 42 bytes of string offsets
 * (21 × u16), and a variable-length string heap.
 *
 * When rewriting after conversion, we preserve all fields except:
 *   - filePath, filename (changed extension/path)
 *   - fileSize, bitrate (changed by re-encoding)
 *   - fileType (changed format, e.g. FLAC → AIFF)
 *   - sampleRate, sampleDepth (may change during resampling)
 */
export interface PdbTrackRow {
  /** PDB-internal row ID (1-indexed, sequential within the Tracks table) */
  id: number
  artistId: number
  albumId: number
  genreId: number
  labelId: number
  keyId: number
  artworkId: number
  colorId: number
  remixerId: number
  composerId: number
  originalArtistId: number

  /** The track title */
  title: string
  /** USB-relative file path, e.g. "/music/Artist - Title.flac" */
  filePath: string
  /** Just the filename portion, e.g. "Artist - Title.flac" */
  filename: string

  sampleRate: number
  sampleDepth: number
  fileSize: number
  bitrate: number
  duration: number
  fileType: PioneerFileType
  trackNumber: number
  tempo: number       // BPM × 100 (e.g. 12800 = 128.00 BPM)
  year: number
  discNumber: number
  playCount: number
  rating: number       // 0–255, where stars = value / 51

  // String fields
  comment: string
  isrc: string
  composer: string
  mixName: string
  message: string
  releaseDate: string
  dateAdded: string
  analyzeDate: string
  /** USB-relative path to ANLZ directory (e.g. "/PIONEER/USBANLZ/P001/00012ABC") */
  analyzePath: string
  kuvoPublic: string

  // Unknown strings from original PDB — preserved verbatim
  unknownStr4: string
  unknownStr5: string
  unknownStr6: string
  unknownStr7: string
  unknownStr8: string
}

/**
 * A playlist tree entry (folder or leaf playlist).
 */
export interface PdbPlaylistTreeRow {
  id: number
  parentId: number
  sortOrder: number
  isFolder: boolean
  name: string
}

/**
 * A playlist entry linking a track to a playlist.
 */
export interface PdbPlaylistEntryRow {
  entryIndex: number
  trackId: number
  playlistId: number
}

// ─── ANLZ Types ────────────────────────────────────────────────────────────────

/**
 * ANLZ section tag identifiers (FourCC codes, big-endian ASCII).
 *
 * ANLZ files consist of a 28-byte PMAI header followed by tagged sections.
 * Each section starts with: FourCC(4) + len_header(u32BE) + len_tag(u32BE).
 *
 * Three ANLZ files exist per track:
 *   - ANLZ0000.DAT: beat grid, mono waveform preview, VBR index
 *   - ANLZ0000.EXT: colour scroll waveform, extended beat grid (PQT2)
 *   - ANLZ0000.2EX: CDJ-3000 colour waveform data
 */
export const ANLZ_TAGS = {
  PPTH: 'PPTH', // File path (UTF-16BE with null terminator)
  PVBR: 'PVBR', // Variable Bit Rate seek index (400 × u32BE offsets)
  PQTZ: 'PQTZ', // Beat grid (beat entries: beatNumber + tempo + time_ms)
  PQT2: 'PQT2', // Extended beat grid (Rekordbox 6+)
  PWAV: 'PWAV', // Monochrome preview waveform (400 columns, touch strip)
  PWV2: 'PWV2', // Tiny monochrome overview (100 columns, CDJ-900)
  PWV3: 'PWV3', // Monochrome scroll waveform (1 byte/col, 10ms/col)
  PWV4: 'PWV4', // Colour preview waveform (6 bytes/col, NXS2)
  PWV5: 'PWV5', // Colour scroll waveform (2 bytes/col, u16BE)
  PWV6: 'PWV6', // Colour overview for .2EX (3 bytes/col, CDJ-3000)
  PWV7: 'PWV7', // Colour scroll waveform for .2EX (3 bytes/col)
  PWVC: 'PWVC', // Colour calibration (6 bytes, static)
  PCOB: 'PCOB', // Cue object stub
  PCO2: 'PCO2', // Extended cue stub
} as const

/**
 * A parsed ANLZ section (raw binary, not yet decoded).
 * Used when preserving existing sections during USB metadata rewrite.
 */
export interface AnlzSection {
  tag: string
  lenHeader: number
  lenTag: number
  /** Raw bytes of the entire section (header + body) */
  raw: Buffer
}

/**
 * Parsed ANLZ file containing all sections.
 */
export interface AnlzFile {
  /** 28-byte PMAI file header */
  pmaiHeader: Buffer
  /** Ordered sections in the file */
  sections: AnlzSection[]
}

/**
 * A single beat entry in the PQTZ beat grid.
 * beatNumber: 1-4 (position within a bar)
 * tempo: BPM × 100 (u16)
 * time: position in milliseconds (u32)
 */
export interface BeatEntry {
  beatNumber: number
  tempo: number
  time: number
}

/**
 * Hot cue / memory cue / loop point from the ANLZ PCOB/PCO2 sections.
 * When preserving metadata, we keep the raw PCOB/PCO2 section buffers
 * rather than decoding them — this avoids any loss of unknown fields.
 */
export interface CuePoint {
  /** Cue type: 0=cue, 1=fade-in, 2=fade-out, 3=load, 4=loop */
  type: number
  /** Hot cue number: -1=memory cue, 0-7=hot cues A-H */
  number: number
  /** Start position in milliseconds */
  startTime: number
  /** End position (only for loops) */
  endTime?: number
  /** Color ID (Pioneer color palette 1-8) */
  colorId?: number
}

// ─── USB Preservation Types ────────────────────────────────────────────────────

/**
 * Result of scanning a USB drive for Rekordbox format.
 */
export interface UsbScanResult {
  /** True if a valid PIONEER directory structure was found */
  isRekordboxUsb: boolean
  /** Absolute path to the USB root on the host filesystem */
  usbRoot: string
  /** Absolute path to PIONEER/ directory */
  pioneerDir: string
  /** Absolute path to PIONEER/rekordbox/export.pdb */
  pdbPath: string
  /** Absolute path to PIONEER/USBANLZ/ */
  usbanlzDir: string
  /** Absolute path to PIONEER/USBMUSIC/ (may not exist; music can be elsewhere) */
  usbmusicDir: string | null
  /** Number of tracks found in the PDB */
  trackCount: number
}

/**
 * A single track on a Rekordbox USB, combining PDB metadata and
 * the on-disk file path.
 */
export interface UsbTrackInfo {
  /** PDB track row ID */
  pdbId: number
  /** Track title */
  title: string
  /** USB-relative path (e.g. "/music/track.flac") */
  usbRelativePath: string
  /** Absolute path on the host filesystem */
  absolutePath: string
  /** Pioneer file type code */
  fileType: PioneerFileType
  /** File size in bytes */
  fileSize: number
  /** Bitrate in kbps */
  bitrate: number
  /** Duration in seconds */
  duration: number
  /** Sample rate in Hz */
  sampleRate: number
  /** Bit depth (e.g. 16, 24) */
  sampleDepth: number
  /** Path hash folder name (e.g. "P001/00012ABC") */
  anlzFolder: string
  /** Absolute path to the ANLZ directory */
  anlzDir: string
}

/**
 * Summary of what will change during a USB conversion.
 * Presented to the user for explicit confirmation before proceeding.
 */
export interface UsbConversionPlan {
  /** The USB drive root */
  usbRoot: string
  /** Tracks that will be converted */
  tracks: Array<{
    pdbId: number
    title: string
    currentFormat: string
    newFormat: string
    currentPath: string
    newPath: string
    currentAnlzFolder: string
    newAnlzFolder: string
  }>
  /** Total number of ANLZ directories that will be relocated */
  anlzRelocations: number
  /** Whether the PDB will be rewritten */
  pdbWillBeModified: boolean
}

/**
 * Progress callback for USB conversion operations.
 */
export interface UsbConversionProgress {
  /** PDB track ID being processed */
  pdbId: number
  /** Current stage */
  stage: 'backup' | 'converting-audio' | 'updating-pdb' | 'relocating-anlz' | 'verifying' | 'done'
  /** Progress 0–100 within the current track */
  percent: number
}

/**
 * Result of converting a single track on a Rekordbox USB.
 */
export interface UsbConversionResult {
  pdbId: number
  success: boolean
  error?: string
  /** New absolute path of the converted audio file */
  newAudioPath?: string
  /** New ANLZ folder hash */
  newAnlzFolder?: string
}

/**
 * Backup metadata for a USB PIONEER directory backup.
 */
export interface UsbBackup {
  /** Absolute path to the backup directory */
  backupDir: string
  /** Timestamp when backup was created */
  createdAt: Date
  /** USB root that was backed up */
  usbRoot: string
  /** Size in bytes of the backup */
  totalSize: number
}
