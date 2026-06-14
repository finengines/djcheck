/**
 * pdb-writer.ts — Write Rekordbox DeviceSQL PDB files
 *
 * Ported from DjManager's pdbWriter.js to TypeScript.
 * Produces a PIONEER/rekordbox/export.pdb file readable by CDJ/XDJ hardware.
 *
 * Binary format: all values little-endian, page size = 4096 bytes.
 *
 * PDB File Structure:
 *   Page 0: File header (table pointers)
 *   Pages 1-N: Index pages + Data pages for each of 20 tables
 *
 * Each table has:
 *   - 1 index page (PageFlags=0x64, heap filled with 0x1ffffff8 sentinels)
 *   - 1+ data pages (PageFlags=0x34, rows packed from top, rowsets from bottom)
 *
 * When preserving metadata on USB conversion, we:
 *   1. Read the existing PDB (via pdb-reader.ts)
 *   2. Modify only the changed track rows
 *   3. Rebuild the entire PDB from scratch (PDB doesn't support in-place edits
 *      because row sizes change when string fields change length)
 *   4. Write the new PDB atomically (write to temp, then rename)
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 4096
const PAGE_HEADER_SIZE = 32       // Common page header (Magic + PageIndex + Type + NextPage + ...)
const DATA_HEADER_SIZE = 8        // DataPageHeader (3 × u16 fields)
const DATA_HEADER_TOTAL = PAGE_HEADER_SIZE + DATA_HEADER_SIZE  // 40
const HEAP_SIZE = PAGE_SIZE - DATA_HEADER_TOTAL  // 4056 bytes available for rows + rowsets
const INDEX_EXTRA_SIZE = 28       // Index page header fields
const INDEX_HEADER_TOTAL = PAGE_HEADER_SIZE + INDEX_EXTRA_SIZE  // 60
const ROWSET_SIZE = 36            // 16 × u16 positions + u16 ActiveRows + u16 LastWrittenRows
const MAX_ROWS_PER_ROWSET = 16
const EMPTY_TABLE_SENTINEL = 0x03ffffff

/**
 * PDB table type identifiers. Order must match Pioneer's expected layout.
 */
export const TABLE_TYPES = {
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
 * Table order in the PDB file header. This order is required for CDJ compatibility.
 */
export const TABLE_ORDER: number[] = [
  TABLE_TYPES.Tracks,
  TABLE_TYPES.Genres,
  TABLE_TYPES.Artists,
  TABLE_TYPES.Albums,
  TABLE_TYPES.Labels,
  TABLE_TYPES.Keys,
  TABLE_TYPES.Colors,
  TABLE_TYPES.PlaylistTree,
  TABLE_TYPES.PlaylistEntries,
  TABLE_TYPES.Unknown9,
  TABLE_TYPES.Unknown10,
  TABLE_TYPES.HistoryPlaylists,
  TABLE_TYPES.HistoryEntries,
  TABLE_TYPES.Artwork,
  TABLE_TYPES.Unknown14,
  TABLE_TYPES.Unknown15,
  TABLE_TYPES.Columns,
  TABLE_TYPES.Unknown17,
  TABLE_TYPES.Unknown18,
  TABLE_TYPES.History,
]

// ── Static datasets ───────────────────────────────────────────────────────────
// These are written verbatim into the PDB for every export. They contain
// Pioneer's standard color palette, column definitions, and unknown metadata.
// Reverse-engineered from native Rekordbox exports.

const COLOR_DATASET = [
  { Unknown1: 0, Unknown2: 1, ID: 1, Unknown3: 0, Name: 'Pink' },
  { Unknown1: 0, Unknown2: 2, ID: 2, Unknown3: 0, Name: 'Red' },
  { Unknown1: 0, Unknown2: 3, ID: 3, Unknown3: 0, Name: 'Orange' },
  { Unknown1: 0, Unknown2: 4, ID: 4, Unknown3: 0, Name: 'Yellow' },
  { Unknown1: 0, Unknown2: 5, ID: 5, Unknown3: 0, Name: 'Green' },
  { Unknown1: 0, Unknown2: 6, ID: 6, Unknown3: 0, Name: 'Aqua' },
  { Unknown1: 0, Unknown2: 7, ID: 7, Unknown3: 0, Name: 'Blue' },
  { Unknown1: 0, Unknown2: 8, ID: 8, Unknown3: 0, Name: 'Purple' },
]

const COLUMN_DATASET = [
  { ID: 0x01, Unknown1: 0x80, Name: '\ufffaGENRE\ufffb' },
  { ID: 0x02, Unknown1: 0x81, Name: '\ufffaARTIST\ufffb' },
  { ID: 0x03, Unknown1: 0x82, Name: '\ufffaALBUM\ufffb' },
  { ID: 0x04, Unknown1: 0x83, Name: '\ufffaTRACK\ufffb' },
  { ID: 0x05, Unknown1: 0x85, Name: '\ufffaBPM\ufffb' },
  { ID: 0x06, Unknown1: 0x86, Name: '\ufffaRATING\ufffb' },
  { ID: 0x07, Unknown1: 0x87, Name: '\ufffaYEAR\ufffb' },
  { ID: 0x08, Unknown1: 0x88, Name: '\ufffaREMIXER\ufffb' },
  { ID: 0x09, Unknown1: 0x89, Name: '\ufffaLABEL\ufffb' },
  { ID: 0x0a, Unknown1: 0x8a, Name: '\ufffaORIGINAL ARTIST\ufffb' },
  { ID: 0x0b, Unknown1: 0x8b, Name: '\ufffaKEY\ufffb' },
  { ID: 0x0c, Unknown1: 0x8d, Name: '\ufffaCUE\ufffb' },
  { ID: 0x0d, Unknown1: 0x8e, Name: '\ufffaCOLOR\ufffb' },
  { ID: 0x0e, Unknown1: 0x92, Name: '\ufffaTIME\ufffb' },
  { ID: 0x0f, Unknown1: 0x93, Name: '\ufffaBITRATE\ufffb' },
  { ID: 0x10, Unknown1: 0x94, Name: '\ufffaFILE NAME\ufffb' },
  { ID: 0x11, Unknown1: 0x84, Name: '\ufffaPLAYLIST\ufffb' },
  { ID: 0x12, Unknown1: 0x98, Name: '\ufffaHOT CUE BANK\ufffb' },
  { ID: 0x13, Unknown1: 0x95, Name: '\ufffaHISTORY\ufffb' },
  { ID: 0x14, Unknown1: 0x91, Name: '\ufffaSEARCH\ufffb' },
  { ID: 0x15, Unknown1: 0x96, Name: '\ufffaCOMMENTS\ufffb' },
  { ID: 0x16, Unknown1: 0x8c, Name: '\ufffaDATE ADDED\ufffb' },
  { ID: 0x17, Unknown1: 0x97, Name: '\ufffaDJ PLAY COUNT\ufffb' },
  { ID: 0x18, Unknown1: 0x90, Name: '\ufffaFOLDER\ufffb' },
  { ID: 0x19, Unknown1: 0xa1, Name: '\ufffaDEFAULT\ufffb' },
  { ID: 0x1a, Unknown1: 0xa2, Name: '\ufffaALPHABET\ufffb' },
  { ID: 0x1b, Unknown1: 0xaa, Name: '\ufffaMATCHING\ufffb' },
]

const UNKNOWN17_DATASET = [
  { Unknown1: 0x01, Unknown2: 0x01, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x05, Unknown2: 0x06, Unknown3: 0x105, Unknown4: 0x00 },
  { Unknown1: 0x06, Unknown2: 0x07, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x07, Unknown2: 0x08, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x08, Unknown2: 0x09, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x09, Unknown2: 0x0a, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x0a, Unknown2: 0x0b, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x0d, Unknown2: 0x0f, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x0e, Unknown2: 0x13, Unknown3: 0x104, Unknown4: 0x00 },
  { Unknown1: 0x0f, Unknown2: 0x14, Unknown3: 0x106, Unknown4: 0x00 },
  { Unknown1: 0x10, Unknown2: 0x15, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x12, Unknown2: 0x17, Unknown3: 0x163, Unknown4: 0x00 },
  { Unknown1: 0x02, Unknown2: 0x02, Unknown3: 0x02, Unknown4: 0x01 },
  { Unknown1: 0x03, Unknown2: 0x03, Unknown3: 0x03, Unknown4: 0x02 },
  { Unknown1: 0x04, Unknown2: 0x04, Unknown3: 0x01, Unknown4: 0x03 },
  { Unknown1: 0x0b, Unknown2: 0x0c, Unknown3: 0x63, Unknown4: 0x04 },
  { Unknown1: 0x11, Unknown2: 0x05, Unknown3: 0x63, Unknown4: 0x05 },
  { Unknown1: 0x13, Unknown2: 0x16, Unknown3: 0x63, Unknown4: 0x06 },
  { Unknown1: 0x14, Unknown2: 0x12, Unknown3: 0x63, Unknown4: 0x07 },
  { Unknown1: 0x1b, Unknown2: 0x1a, Unknown3: 0x263, Unknown4: 0x08 },
  { Unknown1: 0x18, Unknown2: 0x11, Unknown3: 0x63, Unknown4: 0x09 },
  { Unknown1: 0x16, Unknown2: 0x1b, Unknown3: 0x63, Unknown4: 0x0a },
]

const UNKNOWN18_DATASET = [
  { Unknown1: 0x01, Unknown2: 0x06, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x15, Unknown2: 0x07, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x0e, Unknown2: 0x08, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x08, Unknown2: 0x09, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x09, Unknown2: 0x0a, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x0a, Unknown2: 0x0b, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x0f, Unknown2: 0x0d, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x0d, Unknown2: 0x0f, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x17, Unknown2: 0x10, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x16, Unknown2: 0x11, Unknown3: 0x01, Unknown4: 0x00 },
  { Unknown1: 0x19, Unknown2: 0x00, Unknown3: 0x100, Unknown4: 0x00 },
  { Unknown1: 0x1a, Unknown2: 0x01, Unknown3: 0x200, Unknown4: 0x00 },
  { Unknown1: 0x02, Unknown2: 0x02, Unknown3: 0x302, Unknown4: 0x00 },
  { Unknown1: 0x03, Unknown2: 0x03, Unknown3: 0x400, Unknown4: 0x00 },
  { Unknown1: 0x05, Unknown2: 0x04, Unknown3: 0x500, Unknown4: 0x00 },
  { Unknown1: 0x06, Unknown2: 0x05, Unknown3: 0x600, Unknown4: 0x00 },
  { Unknown1: 0x0b, Unknown2: 0x0c, Unknown3: 0x700, Unknown4: 0x00 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function alignTo4(n: number): number {
  const rem = n % 4
  return rem === 0 ? n : n + (4 - rem)
}

/** Star rating: 0=0, 1=51, 2=102, 3=153, 4=204, 5=255 */
function encodeRating(stars: number): number {
  return Math.min(5, Math.max(0, stars)) * 51
}

// ── DeviceSQL string encoding ─────────────────────────────────────────────────

function isASCII(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7f) return false
  }
  return true
}

/**
 * Encode a string as a DeviceSQL string (DeviceSQLString).
 *
 * Short ASCII (len < 127): 1 header byte = ((len+1)<<1)|1, then ASCII bytes.
 * Long ASCII (len >= 127): [0x40, u16LE(len+4), 0x00, ASCII bytes].
 * Unicode: [0x90, u16LE(byte_len+4), 0x00, UTF-16LE bytes].
 */
function encodeDeviceSQLString(str: string): Buffer {
  if (isASCII(str)) {
    if (str.length < 127) {
      const buf = Buffer.allocUnsafe(1 + str.length)
      buf[0] = ((str.length + 1) << 1) | 1
      buf.write(str, 1, 'ascii')
      return buf
    } else {
      const buf = Buffer.allocUnsafe(4 + str.length)
      buf[0] = 0x40
      buf.writeUInt16LE(str.length + 4, 1)
      buf[3] = 0x00
      buf.write(str, 4, 'ascii')
      return buf
    }
  } else {
    const encoded = Buffer.from(str, 'utf16le')
    const buf = Buffer.allocUnsafe(4 + encoded.length)
    buf[0] = 0x90
    buf.writeUInt16LE(encoded.length + 4, 1)
    buf[3] = 0x00
    encoded.copy(buf, 4)
    return buf
  }
}

/**
 * Encode an ISRC string.
 * Format: [0x90, u16LE(len+6), 0x00, 0x03, ASCII bytes, 0x00]
 */
function encodeISRCString(str: string): Buffer {
  const len = str.length
  const buf = Buffer.allocUnsafe(6 + len)
  buf[0] = 0x90
  buf.writeUInt16LE(len + 6, 1)
  buf[3] = 0x00
  buf[4] = 0x03
  buf.write(str, 5, 'ascii')
  buf[5 + len] = 0x00
  return buf
}

// ── Row builders ──────────────────────────────────────────────────────────────

interface TrackRowParams {
  id: number
  artistId?: number
  albumId?: number
  genreId?: number
  labelId?: number
  keyId?: number
  artworkId?: number
  colorId?: number
  remixerId?: number
  composerId?: number
  originalArtistId?: number
  title?: string
  filePath?: string
  filename?: string
  sampleRate?: number
  fileSize?: number
  checksum?: number
  bitrate?: number
  trackNumber?: number
  tempo?: number
  year?: number
  sampleDepth?: number
  duration?: number
  discNumber?: number
  playCount?: number
  fileType?: number
  rating?: number
  comment?: string
  isrc?: string
  composer?: string
  mixName?: string
  message?: string
  releaseDate?: string
  dateAdded?: string
  analyzeDate?: string
  analyzePath?: string
  kuvoPublic?: string
  unknownStr4?: string
  unknownStr5?: string
  unknownStr6?: string
  unknownStr7?: string
  unknownStr8?: string
}

/**
 * Build a Track row buffer.
 *
 * Layout (all LE):
 *   Header (94 bytes):
 *     Unnamed0(u16=0x24) + IndexShift(u16) + Bitmask(u32=0xC0700)
 *     + SampleRate(u32) + ComposerId(u32) + FileSize(u32) + Checksum(u32)
 *     + Unnamed7(u16=0x758a) + Unnamed8(u16=0x57a2) + ArtworkId(u32) + KeyId(u32)
 *     + OriginalArtistId(u32) + LabelId(u32) + RemixerId(u32) + Bitrate(u32)
 *     + TrackNumber(u32) + Tempo(u32) + GenreId(u32) + AlbumId(u32) + ArtistId(u32)
 *     + Id(u32) + DiscNumber(u16) + PlayCount(u16) + Year(u16) + SampleDepth(u16)
 *     + Duration(u16) + Unnamed26(u16=0x29) + ColorId(u8) + Rating(u8)
 *     + FileType(u16) + Unnamed30(u16=0x03)
 *   StringOffsets (42 bytes): 21 × u16LE absolute offsets into string heap
 *   String heap: DeviceSQLString values for each string field
 */
export function buildTrackRow(params: TrackRowParams): Buffer {
  const {
    id,
    artistId = 0,
    albumId = 0,
    genreId = 0,
    labelId = 0,
    keyId = 0,
    artworkId = 0,
    colorId = 0,
    remixerId = 0,
    composerId = 0,
    originalArtistId = 0,
    title = '',
    filePath = '',
    filename = '',
    sampleRate = 44100,
    fileSize = 0,
    checksum = 0,
    bitrate = 320,
    trackNumber = 0,
    tempo = 0,
    year = 0,
    sampleDepth = 16,
    duration = 0,
    discNumber = 0,
    playCount = 0,
    fileType = 0x01,
    rating = 0,
    comment = '',
    isrc = '',
    composer = '',
    mixName = '',
    message = '',
    releaseDate = '',
    dateAdded = '',
    analyzeDate = '',
    analyzePath = '',
    kuvoPublic = '',
    unknownStr4 = '',
    unknownStr5 = '',
    unknownStr6 = '',
    unknownStr7 = '',
    unknownStr8 = '',
  } = params

  // String encoding order matches rex track.go StringOffsets struct
  const strBufs = [
    encodeISRCString(isrc),                    // [0]  Isrc
    encodeDeviceSQLString(composer),           // [1]  Composer
    encodeDeviceSQLString('1'),                // [2]  Num1 = KeyAnalyzed
    encodeDeviceSQLString('1'),                // [3]  Num2 = PhraseAnalyzed
    encodeDeviceSQLString(unknownStr4),        // [4]  UnknownString4
    encodeDeviceSQLString(message),            // [5]  Message
    encodeDeviceSQLString(kuvoPublic),         // [6]  KuvoPublic
    encodeDeviceSQLString('ON'),               // [7]  AutoloadHotcues
    encodeDeviceSQLString(unknownStr5),        // [8]  UnknownString5
    encodeDeviceSQLString(unknownStr6),        // [9]  UnknownString6
    encodeDeviceSQLString(dateAdded),          // [10] DateAdded
    encodeDeviceSQLString(releaseDate),        // [11] ReleaseDate
    encodeDeviceSQLString(mixName),            // [12] MixName
    encodeDeviceSQLString(unknownStr7),        // [13] UnknownString7
    encodeDeviceSQLString(analyzePath),        // [14] AnalyzePath
    encodeDeviceSQLString(analyzeDate),        // [15] AnalyzeDate
    encodeDeviceSQLString(comment),            // [16] Comment
    encodeDeviceSQLString(title),              // [17] Title
    encodeDeviceSQLString(unknownStr8),        // [18] UnknownString8
    encodeDeviceSQLString(filename),           // [19] Filename
    encodeDeviceSQLString(filePath),           // [20] FilePath
  ]

  const HEADER_BYTES = 94
  const STRING_OFFSETS_BYTES = 42  // 21 × u16
  const RECORD_LEN = HEADER_BYTES + STRING_OFFSETS_BYTES  // 136

  // Compute string heap offsets (absolute = heap_relative + RECORD_LEN)
  const absOffsets: number[] = []
  let heapPos = 0
  for (const sbuf of strBufs) {
    absOffsets.push(heapPos + RECORD_LEN)
    heapPos += sbuf.length
  }

  const totalSize = RECORD_LEN + heapPos
  const result = Buffer.alloc(totalSize)
  let pos = 0

  // ── Header (94 bytes) ──
  result.writeUInt16LE(0x24, pos); pos += 2   // Unnamed0
  result.writeUInt16LE(0, pos); pos += 2       // IndexShift (set by DataPage)
  result.writeUInt32LE(0xc0700, pos); pos += 4 // Bitmask
  result.writeUInt32LE(sampleRate, pos); pos += 4
  result.writeUInt32LE(composerId, pos); pos += 4
  result.writeUInt32LE(fileSize, pos); pos += 4
  result.writeUInt32LE(checksum, pos); pos += 4
  result.writeUInt16LE(0x758a, pos); pos += 2  // Unnamed7
  result.writeUInt16LE(0x57a2, pos); pos += 2  // Unnamed8
  result.writeUInt32LE(artworkId, pos); pos += 4
  result.writeUInt32LE(keyId, pos); pos += 4
  result.writeUInt32LE(originalArtistId, pos); pos += 4
  result.writeUInt32LE(labelId, pos); pos += 4
  result.writeUInt32LE(remixerId, pos); pos += 4
  result.writeUInt32LE(bitrate, pos); pos += 4       // @48
  result.writeUInt32LE(trackNumber, pos); pos += 4   // @52
  result.writeUInt32LE(tempo, pos); pos += 4         // @56
  result.writeUInt32LE(genreId, pos); pos += 4       // @60
  result.writeUInt32LE(albumId, pos); pos += 4       // @64
  result.writeUInt32LE(artistId, pos); pos += 4      // @68
  result.writeUInt32LE(id, pos); pos += 4            // @72
  result.writeUInt16LE(discNumber, pos); pos += 2    // @76
  result.writeUInt16LE(playCount, pos); pos += 2     // @78
  result.writeUInt16LE(year, pos); pos += 2          // @80
  result.writeUInt16LE(sampleDepth, pos); pos += 2   // @82
  result.writeUInt16LE(duration, pos); pos += 2      // @84
  result.writeUInt16LE(0x29, pos); pos += 2          // Unnamed26 @86
  result[pos++] = colorId                           // @88
  result[pos++] = rating                            // @89
  result.writeUInt16LE(fileType, pos); pos += 2     // @90
  result.writeUInt16LE(0x03, pos); pos += 2         // Unnamed30 @92
  // pos == 94

  // ── StringOffsets (42 bytes = 21 × u16LE) ──
  for (const off of absOffsets) {
    result.writeUInt16LE(off, pos)
    pos += 2
  }
  // pos == 136

  // ── String heap ──
  for (const sbuf of strBufs) {
    sbuf.copy(result, pos)
    pos += sbuf.length
  }

  return result
}

/** Artist row: Subtype(u16=0x60) + IndexShift(u16) + Id(u32) + Unnamed3(u8=0x03) + OfsNameNear(u8=0x0A) + dstring(name) */
function buildArtistRow(id: number, name: string): Buffer {
  const nameEnc = encodeDeviceSQLString(name)
  const buf = Buffer.alloc(10 + nameEnc.length)
  buf.writeUInt16LE(0x60, 0)  // Subtype
  buf.writeUInt16LE(0, 2)     // IndexShift
  buf.writeUInt32LE(id, 4)    // Id
  buf[8] = 0x03               // Unnamed3
  buf[9] = 0x0a               // OfsNameNear
  nameEnc.copy(buf, 10)
  return buf
}

/** Album row: Unnamed1(u16=0x80) + IndexShift(u16) + Unnamed2(u32) + ArtistId(u32) + Id(u32) + Unnamed3(u32) + Unnamed4(u8=0x03) + OfsName(u8=22) + dstring(name) */
function buildAlbumRow(id: number, artistId: number, name: string): Buffer {
  const nameEnc = encodeDeviceSQLString(name)
  const buf = Buffer.alloc(22 + nameEnc.length)
  buf.writeUInt16LE(0x80, 0)
  buf.writeUInt16LE(0, 2)
  buf.writeUInt32LE(0, 4)
  buf.writeUInt32LE(artistId, 8)
  buf.writeUInt32LE(id, 12)
  buf.writeUInt32LE(0, 16)
  buf[20] = 0x03
  buf[21] = 22
  nameEnc.copy(buf, 22)
  return buf
}

/** Key row: SmallId(u16) + IndexShift(u16=0) + Id(u32) + dstring(name) */
function buildKeyRow(id: number, name: string): Buffer {
  const nameEnc = encodeDeviceSQLString(name)
  const buf = Buffer.alloc(8 + nameEnc.length)
  buf.writeUInt16LE(id, 0)
  buf.writeUInt16LE(0, 2)
  buf.writeUInt32LE(id, 4)
  nameEnc.copy(buf, 8)
  return buf
}

/** Color row: Unknown1(u32) + Unknown2(u8) + ID(u16) + Unknown3(u8) + dstring(Name) */
function buildColorRow(data: { Unknown1: number; Unknown2: number; ID: number; Unknown3: number; Name: string }): Buffer {
  const nameEnc = encodeDeviceSQLString(data.Name)
  const buf = Buffer.alloc(8 + nameEnc.length)
  buf.writeUInt32LE(data.Unknown1, 0)
  buf[4] = data.Unknown2
  buf.writeUInt16LE(data.ID, 5)
  buf[7] = data.Unknown3
  nameEnc.copy(buf, 8)
  return buf
}

/** Column row: ID(u16) + Unknown1(u16) + dstring(Name) */
function buildColumnRow(data: { ID: number; Unknown1: number; Name: string }): Buffer {
  const nameEnc = encodeDeviceSQLString(data.Name)
  const buf = Buffer.alloc(4 + nameEnc.length)
  buf.writeUInt16LE(data.ID, 0)
  buf.writeUInt16LE(data.Unknown1, 2)
  nameEnc.copy(buf, 4)
  return buf
}

/** PlaylistTree row */
function buildPlaylistTreeRow(data: { id: number; parentId: number; sortOrder: number; isFolder: boolean; name: string }): Buffer {
  const nameEnc = encodeDeviceSQLString(data.name)
  const buf = Buffer.alloc(20 + nameEnc.length)
  buf.writeUInt32LE(data.parentId, 0)
  buf.writeUInt32LE(0, 4)
  buf.writeUInt32LE(data.sortOrder, 8)
  buf.writeUInt32LE(data.id, 12)
  buf.writeUInt32LE(data.isFolder ? 1 : 0, 16)
  nameEnc.copy(buf, 20)
  return buf
}

/** PlaylistEntry row: EntryIndex(u32) + TrackID(u32) + PlaylistID(u32) */
function buildPlaylistEntryRow(entryIndex: number, trackId: number, playlistId: number): Buffer {
  const buf = Buffer.alloc(12)
  buf.writeUInt32LE(entryIndex, 0)
  buf.writeUInt32LE(trackId, 4)
  buf.writeUInt32LE(playlistId, 8)
  return buf
}

/** Unknown17 row: 4 × u16 LE */
function buildUnknown17Row(data: { Unknown1: number; Unknown2: number; Unknown3: number; Unknown4: number }): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeUInt16LE(data.Unknown1, 0)
  buf.writeUInt16LE(data.Unknown2, 2)
  buf.writeUInt16LE(data.Unknown3, 4)
  buf.writeUInt16LE(data.Unknown4, 6)
  return buf
}

/** Unknown18 row: 4 × u16 LE */
function buildUnknown18Row(data: { Unknown1: number; Unknown2: number; Unknown3: number; Unknown4: number }): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeUInt16LE(data.Unknown1, 0)
  buf.writeUInt16LE(data.Unknown2, 2)
  buf.writeUInt16LE(data.Unknown3, 4)
  buf.writeUInt16LE(data.Unknown4, 6)
  return buf
}

// ── DataPage ──────────────────────────────────────────────────────────────────

/**
 * Represents a single 4096-byte data page in the PDB file.
 *
 * Rows are packed from the top of the heap; RowSets grow backwards from the
 * bottom (mirroring rex's heap implementation). Rows are 4-byte aligned.
 */
class DataPage {
  private pageType: number
  private _topBufs: Buffer[] = []
  private _topSize = 0
  private _rowsets: Array<{
    positions: number[]
    activeRows: number
    lastWrittenRows: number
  }> = []
  numRows = 0

  constructor(pageType: number) {
    this.pageType = pageType
  }

  /**
   * Insert a row buffer into this page.
   * @returns true on success, false if page is full
   */
  insertRow(rowBuf: Buffer, hasIndexShift = false): boolean {
    const alignedSize = alignTo4(rowBuf.length)
    const requiredRowsetBytes = Math.ceil((this.numRows + 1) / MAX_ROWS_PER_ROWSET) * ROWSET_SIZE

    if (this._topSize + alignedSize + requiredRowsetBytes > HEAP_SIZE) {
      return false
    }

    const heapPosition = this._topSize

    // Build aligned buffer with zero padding
    const aligned = Buffer.alloc(alignedSize)
    rowBuf.copy(aligned)

    // Apply IndexShift at bytes 2-3 (for Track, Artist, Album rows)
    if (hasIndexShift) {
      aligned.writeUInt16LE((this.numRows * 0x20) & 0xffff, 2)
    }

    this._topBufs.push(aligned)
    this._topSize += alignedSize

    // RowSet management
    const bitIndex = this.numRows % MAX_ROWS_PER_ROWSET
    if (bitIndex === 0) {
      this._rowsets.push({
        positions: new Array(MAX_ROWS_PER_ROWSET).fill(0),
        activeRows: 0,
        lastWrittenRows: 0,
      })
    }

    const rs = this._rowsets[this._rowsets.length - 1]
    rs.positions[bitIndex] = heapPosition
    rs.activeRows |= 1 << bitIndex
    rs.lastWrittenRows = 1 << bitIndex

    this.numRows++
    return true
  }

  /** Serialize the page to a 4096-byte Buffer */
  toBuffer(pageIndex: number, nextPage: number, transaction: number): Buffer {
    const buf = Buffer.alloc(PAGE_SIZE)

    const bottomSize = this._rowsets.length * ROWSET_SIZE
    const freeSize = HEAP_SIZE - this._topSize - bottomSize

    // ── Page Header (32 bytes) ──
    buf.writeUInt32LE(0, 0)                       // Magic
    buf.writeUInt32LE(pageIndex, 4)               // PageIndex
    buf.writeUInt32LE(this.pageType, 8)           // Type
    buf.writeUInt32LE(nextPage, 12)               // NextPage
    buf.writeUInt32LE(transaction, 16)            // Transaction
    buf.writeUInt32LE(0, 20)                      // Unknown2
    buf[24] = this.numRows & 0xff                 // NumRowsSmall
    buf[25] = (this.numRows * 0x20) & 0xff        // Unknown3
    buf[26] = 0                                    // Unknown4
    buf[27] = 0x34                                 // PageFlags (data page)
    buf.writeUInt16LE(freeSize, 28)               // FreeSize
    buf.writeUInt16LE(this._topSize, 30)          // NextHeapWriteOffset

    // ── Data Page Header (8 bytes at offset 32) ──
    buf.writeUInt16LE(1, 32)   // Unknown5
    buf.writeUInt16LE(0, 34)   // NumRowsLarge
    buf.writeUInt16LE(0, 36)   // Unknown6
    buf.writeUInt16LE(0, 38)   // Unknown7

    // ── Row data at offset 40 ──
    let writePos = DATA_HEADER_TOTAL
    for (const chunk of this._topBufs) {
      chunk.copy(buf, writePos)
      writePos += chunk.length
    }

    // ── RowSets at end of heap (reversed order) ──
    let rsOffset = PAGE_SIZE - ROWSET_SIZE
    for (let i = 0; i < this._rowsets.length; i++) {
      this._serializeRowset(this._rowsets[i], buf, rsOffset)
      rsOffset -= ROWSET_SIZE
    }

    return buf
  }

  /** Write a RowSet at `offset` in buf with positions in reversed order */
  private _serializeRowset(
    rs: { positions: number[]; activeRows: number; lastWrittenRows: number },
    buf: Buffer,
    offset: number
  ): void {
    // Reversed: write pos[15] first, pos[0] last (per rex row.go MarshalBinary)
    for (let i = MAX_ROWS_PER_ROWSET - 1; i >= 0; i--) {
      buf.writeUInt16LE(rs.positions[i], offset)
      offset += 2
    }
    buf.writeUInt16LE(rs.activeRows, offset)
    offset += 2
    buf.writeUInt16LE(rs.lastWrittenRows, offset)
  }
}

// ── Index page ────────────────────────────────────────────────────────────────

/**
 * Build a 4096-byte index page for a table.
 * Index pages have PageFlags=0x64 and a heap filled with sentinel values.
 */
function buildIndexPage(pageType: number, pageIndex: number, firstDataPage: number, transaction: number): Buffer {
  const buf = Buffer.alloc(PAGE_SIZE)

  // ── Page Header (32 bytes) ──
  buf.writeUInt32LE(0, 0)
  buf.writeUInt32LE(pageIndex, 4)
  buf.writeUInt32LE(pageType, 8)
  buf.writeUInt32LE(pageIndex + 1, 12)       // NextPage
  buf.writeUInt32LE(transaction, 16)
  buf.writeUInt32LE(0, 20)
  buf[24] = 0
  buf[25] = 0
  buf[26] = 0
  buf[27] = 0x64                              // PageFlags = index page
  buf.writeUInt16LE(0, 28)
  buf.writeUInt16LE(0, 30)

  // ── Index Header (28 bytes at offset 32) ──
  buf.writeUInt16LE(0x1fff, 32)
  buf.writeUInt16LE(0x1fff, 34)
  buf.writeUInt16LE(0x03ec, 36)
  buf.writeUInt16LE(0, 38)                   // NextOffset
  buf.writeUInt32LE(pageIndex, 40)
  buf.writeUInt32LE(EMPTY_TABLE_SENTINEL, 44) // IndexHeader.NextPage
  buf.writeUInt32LE(0x03ffffff, 48)
  buf.writeUInt32LE(0, 52)
  buf.writeUInt16LE(0, 56)                   // NumEntries
  buf.writeUInt16LE(0x1fff, 58)              // FirstEmptyEntry

  // ── Heap: fill with 0x1ffffff8 sentinel, last 20 bytes stay zero ──
  const fillEnd = PAGE_SIZE - 20
  for (let off = INDEX_HEADER_TOTAL; off < fillEnd; off += 4) {
    buf.writeUInt32LE(0x1ffffff8, off)
  }

  return buf
}

// ── File header ───────────────────────────────────────────────────────────────

function buildFileHeader(
  tableStates: Map<number, { indexPageIndex: number; emptyCandidate: number; firstPage: number; lastPage: number }>,
  nextUnusedPage: number,
  sequence: number
): Buffer {
  const numTables = TABLE_ORDER.length
  const buf = Buffer.alloc(PAGE_SIZE)

  buf.writeUInt32LE(0, 0)                    // Magic
  buf.writeUInt32LE(PAGE_SIZE, 4)            // LenPage
  buf.writeUInt32LE(numTables, 8)            // NumTables
  buf.writeUInt32LE(nextUnusedPage, 12)      // NextUnusedPage
  buf.writeUInt32LE(0x05, 16)               // Unknown1
  buf.writeUInt32LE(sequence, 20)            // Sequence
  buf.writeUInt32LE(0, 24)                   // Gap

  // TablePointers (16 bytes each, in TABLE_ORDER)
  let offset = 28
  for (const type of TABLE_ORDER) {
    const st = tableStates.get(type)!
    buf.writeUInt32LE(type, offset)
    buf.writeUInt32LE(st.emptyCandidate, offset + 4)
    buf.writeUInt32LE(st.firstPage, offset + 8)
    buf.writeUInt32LE(st.lastPage, offset + 12)
    offset += 16
  }

  return buf
}

// ── PDB builder ───────────────────────────────────────────────────────────────

/**
 * Input data for building a PDB file from parsed/modified data.
 * This is used when rewriting the PDB after USB conversion.
 */
export interface PdbWriteInput {
  tracks: TrackRowParams[]
  artists: Array<{ id: number; name: string }>
  albums: Array<{ id: number; artistId: number; name: string }>
  keys: Array<{ id: number; name: string }>
  playlistTree: Array<{ id: number; parentId: number; sortOrder: number; isFolder: boolean; name: string }>
  playlistEntries: Array<{ entryIndex: number; trackId: number; playlistId: number }>
}

/**
 * Build the complete PDB binary buffer from input data.
 * Rebuilds the entire PDB from scratch — required because row sizes change
 * when string fields (like filePath) change length.
 */
export function buildPdbBuffer(input: PdbWriteInput): Buffer {
  const { tracks = [], artists = [], albums = [], keys = [], playlistTree = [], playlistEntries = [] } = input

  // ── Build all row buffers grouped by table type ──
  const rowsByType = new Map<number, Buffer[]>()
  for (const type of TABLE_ORDER) rowsByType.set(type, [])

  // Track rows
  for (const t of tracks) {
    rowsByType.get(TABLE_TYPES.Tracks)!.push(buildTrackRow(t))
  }

  // Artist rows
  for (const a of artists) {
    rowsByType.get(TABLE_TYPES.Artists)!.push(buildArtistRow(a.id, a.name))
  }

  // Album rows
  for (const a of albums) {
    rowsByType.get(TABLE_TYPES.Albums)!.push(buildAlbumRow(a.id, a.artistId, a.name))
  }

  // Key rows
  for (const k of keys) {
    rowsByType.get(TABLE_TYPES.Keys)!.push(buildKeyRow(k.id, k.name))
  }

  // Playlist rows
  for (let i = 0; i < playlistTree.length; i++) {
    const pl = playlistTree[i]
    rowsByType.get(TABLE_TYPES.PlaylistTree)!.push(
      buildPlaylistTreeRow(pl)
    )
  }
  for (const e of playlistEntries) {
    rowsByType.get(TABLE_TYPES.PlaylistEntries)!.push(
      buildPlaylistEntryRow(e.entryIndex, e.trackId, e.playlistId)
    )
  }

  // Static datasets
  for (const r of COLOR_DATASET) rowsByType.get(TABLE_TYPES.Colors)!.push(buildColorRow(r))
  for (const r of COLUMN_DATASET) rowsByType.get(TABLE_TYPES.Columns)!.push(buildColumnRow(r))
  for (const r of UNKNOWN17_DATASET) rowsByType.get(TABLE_TYPES.Unknown17)!.push(buildUnknown17Row(r))
  for (const r of UNKNOWN18_DATASET) rowsByType.get(TABLE_TYPES.Unknown18)!.push(buildUnknown18Row(r))

  // ── Database engine — assign page numbers ──
  const writtenPages = new Map<number, Buffer>()
  const tableStates = new Map<number, { indexPageIndex: number; emptyCandidate: number; firstPage: number; lastPage: number }>()

  let nextUnusedPage = 1
  let sequence = 2

  // Create all 20 tables: write index pages
  for (const type of TABLE_ORDER) {
    const indexPageIndex = nextUnusedPage
    const emptyCandidate = indexPageIndex + 1

    const indexBuf = buildIndexPage(type, indexPageIndex, EMPTY_TABLE_SENTINEL, 1)
    writtenPages.set(indexPageIndex, indexBuf)

    tableStates.set(type, {
      indexPageIndex,
      emptyCandidate,
      firstPage: indexPageIndex,
      lastPage: indexPageIndex,
    })

    nextUnusedPage += 2
  }

  // Insert data pages for each non-empty table
  for (const type of TABLE_ORDER) {
    const rows = rowsByType.get(type)
    if (!rows || rows.length === 0) continue

    const hasIndexShift =
      type === TABLE_TYPES.Tracks || type === TABLE_TYPES.Artists || type === TABLE_TYPES.Albums

    let currentPage = new DataPage(type)
    const st = tableStates.get(type)!

    let firstDataPageIndex = st.emptyCandidate
    let currentPageIndex = st.emptyCandidate

    for (const rowBuf of rows) {
      if (!currentPage.insertRow(rowBuf, hasIndexShift)) {
        // Page full — flush it
        const pageBuf = currentPage.toBuffer(currentPageIndex, nextUnusedPage, sequence)
        writtenPages.set(currentPageIndex, pageBuf)
        st.lastPage = currentPageIndex
        st.emptyCandidate = nextUnusedPage
        nextUnusedPage++
        sequence++

        currentPage = new DataPage(type)
        currentPageIndex = st.emptyCandidate

        currentPage.insertRow(rowBuf, hasIndexShift)
      }
    }

    // Flush final page
    const finalNextPage = nextUnusedPage
    const pageBuf = currentPage.toBuffer(currentPageIndex, finalNextPage, sequence)
    writtenPages.set(currentPageIndex, pageBuf)
    st.lastPage = currentPageIndex
    st.emptyCandidate = finalNextPage
    nextUnusedPage++
    sequence++

    // Update index page to point to first data page
    const updatedIndex = buildIndexPage(type, st.indexPageIndex, firstDataPageIndex, 1)
    updatedIndex.writeUInt32LE(firstDataPageIndex, 44)
    writtenPages.set(st.indexPageIndex, updatedIndex)
  }

  // ── Build file buffer ──
  const maxPage = Math.max(...Array.from(writtenPages.keys()))
  const totalPages = maxPage + 1
  const fileBuf = Buffer.alloc(totalPages * PAGE_SIZE)

  // Write file header at page 0
  const headerBuf = buildFileHeader(tableStates, nextUnusedPage, sequence)
  headerBuf.copy(fileBuf, 0)

  // Write all other pages
  for (const [pageIndex, pageBuf] of Array.from(writtenPages.entries())) {
    pageBuf.copy(fileBuf, pageIndex * PAGE_SIZE)
  }

  return fileBuf
}

/**
 * Write a Rekordbox PDB file to the given output path.
 * Writes atomically: writes to a temp file first, then renames.
 */
export function writePdb(input: PdbWriteInput, outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const buf = buildPdbBuffer(input)

  // Atomic write: write to temp file, then rename
  const tmpPath = outputPath + '.tmp'
  fs.writeFileSync(tmpPath, buf)
  fs.renameSync(tmpPath, outputPath)
}
