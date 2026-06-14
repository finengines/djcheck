/**
 * pdb-reader.ts — Read Rekordbox PDB files using rekordbox-parser
 *
 * This module wraps the rekordbox-parser npm package to provide a
 * high-level API for reading the Pioneer DeviceSQL database (export.pdb)
 * found on Rekordbox-formatted USB drives.
 *
 * PDB Binary Format Overview:
 *   - Page size: 4096 bytes, all values little-endian
 *   - Page 0: file header with table pointers
 *   - Each table: index page → linked data pages
 *   - Data pages: rows packed from top, rowset bitmaps grow from bottom
 *   - Strings: DeviceSQL encoding (short ASCII, long ASCII, or UTF-16LE)
 *
 * When converting files on a Rekordbox USB, we need to:
 *   1. Read the PDB to find the track entry for the file being converted
 *   2. Preserve all its metadata (cues, playlists, etc.)
 *   3. Update only the fields that change (path, size, format, bitrate)
 *   4. Write the modified PDB back using pdb-writer.ts
 */

import * as path from 'path'
import * as fs from 'fs'
import type {
  PdbTrackRow,
  PdbPlaylistTreeRow,
  PdbPlaylistEntryRow,
  UsbTrackInfo,
  PioneerFileType,
  PIONEER_FILE_TYPES,
} from './types'
import { extensionToFileType, getFolderName } from './types'
import { getAnlzRelativePath } from './path-hash'

// rekordbox-parser provides typed exports. We import dynamically to handle
// the case where it's not yet installed (it's added as a dependency).
// The parser returns structured objects from the binary PDB file.

/**
 * Dynamically import rekordbox-parser.
 * This avoids build-time errors if the package isn't installed yet.
 */
async function importParser(): Promise<typeof import('rekordbox-parser')> {
  return import('rekordbox-parser')
}

/**
 * Full parsed PDB database. Contains all tables.
 */
export interface ParsedPdb {
  tracks: PdbTrackRow[]
  artists: Array<{ id: number; name: string }>
  albums: Array<{ id: number; artistId: number; name: string }>
  genres: Array<{ id: number; name: string }>
  labels: Array<{ id: number; name: string }>
  keys: Array<{ id: number; name: string }>
  colors: Array<{ id: number; name: string }>
  playlistTree: PdbPlaylistTreeRow[]
  playlistEntries: PdbPlaylistEntryRow[]
  /** Raw buffer of the original PDB file, kept for verification */
  rawBuffer: Buffer
}

/**
 * Read and parse a Rekordbox export.pdb file.
 *
 * @param pdbPath - Absolute path to the PDB file
 * @returns Parsed PDB data
 * @throws If the file cannot be read or parsed
 */
export async function readPdb(pdbPath: string): Promise<ParsedPdb> {
  const parser = await importParser()

  // Read the raw file into a buffer for verification later
  const rawBuffer = fs.readFileSync(pdbPath)

  // rekordbox-parser accepts a Buffer and returns structured data
  const parsed = parser.parsePdb(rawBuffer)

  // Map parsed tracks to our PdbTrackRow interface
  const tracks: PdbTrackRow[] = (parsed.tracks ?? []).map((t: Record<string, unknown>) => ({
    id: Number(t.id ?? 0),
    artistId: Number(t.artistId ?? 0),
    albumId: Number(t.albumId ?? 0),
    genreId: Number(t.genreId ?? 0),
    labelId: Number(t.labelId ?? 0),
    keyId: Number(t.keyId ?? 0),
    artworkId: Number(t.artworkId ?? 0),
    colorId: Number(t.colorId ?? 0),
    remixerId: Number(t.remixerId ?? 0),
    composerId: Number(t.composerId ?? 0),
    originalArtistId: Number(t.originalArtistId ?? 0),
    title: String(t.title ?? ''),
    filePath: String(t.filePath ?? ''),
    filename: String(t.filename ?? ''),
    sampleRate: Number(t.sampleRate ?? 44100),
    sampleDepth: Number(t.sampleDepth ?? 16),
    fileSize: Number(t.fileSize ?? 0),
    bitrate: Number(t.bitrate ?? 0),
    duration: Number(t.duration ?? 0),
    fileType: Number(t.fileType ?? 1) as PioneerFileType,
    trackNumber: Number(t.trackNumber ?? 0),
    tempo: Number(t.tempo ?? 0),
    year: Number(t.year ?? 0),
    discNumber: Number(t.discNumber ?? 0),
    playCount: Number(t.playCount ?? 0),
    rating: Number(t.rating ?? 0),
    comment: String(t.comment ?? ''),
    isrc: String(t.isrc ?? ''),
    composer: String(t.composer ?? ''),
    mixName: String(t.mixName ?? ''),
    message: String(t.message ?? ''),
    releaseDate: String(t.releaseDate ?? ''),
    dateAdded: String(t.dateAdded ?? ''),
    analyzeDate: String(t.analyzeDate ?? ''),
    analyzePath: String(t.analyzePath ?? ''),
    kuvoPublic: String(t.kuvoPublic ?? ''),
    unknownStr4: String(t.unknownStr4 ?? ''),
    unknownStr5: String(t.unknownStr5 ?? ''),
    unknownStr6: String(t.unknownStr6 ?? ''),
    unknownStr7: String(t.unknownStr7 ?? ''),
    unknownStr8: String(t.unknownStr8 ?? ''),
  }))

  // Map other tables
  const artists = (parsed.artists ?? []).map((a: Record<string, unknown>) => ({
    id: Number(a.id ?? 0),
    name: String(a.name ?? ''),
  }))

  const albums = (parsed.albums ?? []).map((a: Record<string, unknown>) => ({
    id: Number(a.id ?? 0),
    artistId: Number(a.artistId ?? 0),
    name: String(a.name ?? ''),
  }))

  const genres = (parsed.genres ?? []).map((g: Record<string, unknown>) => ({
    id: Number(g.id ?? 0),
    name: String(g.name ?? ''),
  }))

  const labels = (parsed.labels ?? []).map((l: Record<string, unknown>) => ({
    id: Number(l.id ?? 0),
    name: String(l.name ?? ''),
  }))

  const keys = (parsed.keys ?? []).map((k: Record<string, unknown>) => ({
    id: Number(k.id ?? 0),
    name: String(k.name ?? ''),
  }))

  const colors = (parsed.colors ?? []).map((c: Record<string, unknown>) => ({
    id: Number(c.id ?? 0),
    name: String(c.name ?? ''),
  }))

  const playlistTree: PdbPlaylistTreeRow[] = (parsed.playlistTree ?? []).map(
    (p: Record<string, unknown>) => ({
      id: Number(p.id ?? 0),
      parentId: Number(p.parentId ?? 0),
      sortOrder: Number(p.sortOrder ?? 0),
      isFolder: Boolean(p.isFolder),
      name: String(p.name ?? ''),
    })
  )

  const playlistEntries: PdbPlaylistEntryRow[] = (parsed.playlistEntries ?? []).map(
    (e: Record<string, unknown>) => ({
      entryIndex: Number(e.entryIndex ?? 0),
      trackId: Number(e.trackId ?? 0),
      playlistId: Number(e.playlistId ?? 0),
    })
  )

  return {
    tracks,
    artists,
    albums,
    genres,
    labels,
    keys,
    colors,
    playlistTree,
    playlistEntries,
    rawBuffer,
  }
}

/**
 * Find a track in the PDB by its USB-relative file path.
 *
 * The filePath field in the PDB uses forward slashes with a leading slash,
 * e.g. "/music/Artist - Title.flac". We normalise both paths for comparison.
 *
 * @param pdb - Parsed PDB data
 * @param usbRelativePath - USB-relative path to search for
 * @returns The matching track row, or undefined if not found
 */
export function findTrackByPath(
  pdb: ParsedPdb,
  usbRelativePath: string
): PdbTrackRow | undefined {
  const normalised = usbRelativePath.replace(/\\/g, '/')
  const withSlash = normalised.startsWith('/') ? normalised : '/' + normalised

  return pdb.tracks.find((t) => {
    const trackPath = t.filePath.replace(/\\/g, '/')
    return trackPath === withSlash || trackPath === normalised
  })
}

/**
 * Find a track in the PDB by its PDB row ID.
 */
export function findTrackById(pdb: ParsedPdb, pdbId: number): PdbTrackRow | undefined {
  return pdb.tracks.find((t) => t.id === pdbId)
}

/**
 * Build UsbTrackInfo from a PDB track row and USB root path.
 * Resolves the absolute paths for the audio file and ANLZ directory.
 */
export function buildUsbTrackInfo(
  track: PdbTrackRow,
  usbRoot: string
): UsbTrackInfo {
  // The PDB filePath is USB-relative with leading slash, e.g. "/music/track.flac"
  // The absolute path on the host is usbRoot + filePath (strip leading slash)
  const relativePath = track.filePath.replace(/^\/+/, '')
  const absolutePath = path.resolve(usbRoot, relativePath)
  const anlzFolder = getFolderName(track.filePath)
  const anlzDir = path.resolve(usbRoot, 'PIONEER', 'USBANLZ', anlzFolder)

  return {
    pdbId: track.id,
    title: track.title,
    usbRelativePath: track.filePath,
    absolutePath,
    fileType: track.fileType,
    fileSize: track.fileSize,
    bitrate: track.bitrate,
    duration: track.duration,
    sampleRate: track.sampleRate,
    sampleDepth: track.sampleDepth,
    anlzFolder,
    anlzDir,
  }
}
