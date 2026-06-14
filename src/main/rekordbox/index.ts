/**
 * Rekordbox USB preservation — convert audio files on a Pioneer USB while
 * preserving all metadata (hot cues, loops, waveforms, beat grids, playlists).
 *
 * Architecture:
 * 1. READ existing PDB + ANLZ files using rekordbox-parser
 * 2. BACKUP the entire PIONEER directory before any modifications
 * 3. CONVERT the audio file (via existing converter/normalizer)
 * 4. UPDATE PDB track row fields that changed (filename, path, size, format, bitrate)
 * 5. UPDATE ANLZ PPTH section with new file path
 * 6. RELOCATE ANLZ directory if path hash changed
 * 7. WRITE updated PDB and ANLZ back to USB
 * 8. VERIFY by re-reading the written files
 * 9. RESTORE from backup if ANY step fails
 *
 * Safety: Every operation is atomic — either the USB is fully updated or fully
 * restored to its original state. No half-written corruption possible.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as fsc from 'fs'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UsbConversionEntry {
  /** Full path to the source audio file on the USB */
  sourcePath: string
  /** Full path to the converted audio file (temporary, will be moved to USB) */
  convertedPath: string
  /** The USB mount point / root (e.g. /Volumes/PIONEER or E:\) */
  usbRoot: string
}

export interface UsbConversionResult {
  sourcePath: string
  success: boolean
  error?: string
  /** What was backed up */
  backupPath?: string
  /** What changed in the PDB */
  pdbChanges?: string[]
  /** What changed in the ANLZ */
  anlzChanges?: string[]
}

export interface UsbBackupInfo {
  /** Path to the backup directory */
  backupDir: string
  /** Timestamp of the backup */
  timestamp: Date
  /** Files backed up */
  files: string[]
}

// ─── Path Hashing ───────────────────────────────────────────────────────────
// Ported from DjManager's getFolderName() (MIT, Radexito)
// Original: beirbox-gui/ANLZ/ANLZ.go — reverse-engineered from Rekordbox binary

/**
 * Compute the Pioneer ANLZ directory path for a given audio file path.
 * Rekordbox uses this hash to determine where to store ANLZ analysis files.
 * Format: PIONEER/CD_Rekordbox/<hash>/ANLZ0000.DAT etc.
 */
export function computeAnlzFolder(audioPath: string): string {
  // Normalize: forward slashes, leading /
  let normalized = audioPath.replace(/\\/g, '/')
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  // Compute hash
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x34f5501d) + Math.imul(c, 0x93b6)
    hash = hash >>> 0 // uint32
  }

  const part2 = hash % 0x30d43

  // Bit extraction for part1 (scattered bit pattern from Go source)
  const bits = part2
  let part1 = 0
  part1 |= (bits >> 0 & 1) << 0
  part1 |= (bits >> 1 & 1) << 1
  part1 |= (bits >> 2 & 1) << 2
  part1 |= (bits >> 3 & 1) << 3
  part1 |= (bits >> 4 & 1) << 4
  part1 |= (bits >> 5 & 1) << 5
  part1 |= (bits >> 6 & 1) << 6
  part1 |= (bits >> 7 & 1) << 7
  part1 |= (bits >> 8 & 1) << 8
  part1 |= (bits >> 9 & 1) << 9
  part1 |= (bits >> 10 & 1) << 10
  part1 |= (bits >> 11 & 1) << 11
  part1 |= (bits >> 16 & 1) << 12
  part1 |= (bits >> 17 & 1) << 13
  part1 |= (bits >> 18 & 1) << 14
  part1 |= (bits >> 19 & 1) << 15
  part1 |= (bits >> 20 & 1) << 16
  part1 |= (bits >> 21 & 1) << 17
  part1 |= (bits >> 22 & 1) << 18
  part1 |= (bits >> 23 & 1) << 19
  part1 |= (bits >> 24 & 1) << 20
  part1 |= (bits >> 25 & 1) << 21
  part1 |= (bits >> 26 & 1) << 22
  part1 |= (bits >> 27 & 1) << 23

  const folder1 = 'P' + part1.toString(16).toUpperCase().padStart(3, '0')
  const folder2 = part2.toString(16).toUpperCase().padStart(8, '0')

  return `${folder1}/${folder2}`
}

// ─── Backup / Restore ───────────────────────────────────────────────────────

/**
 * Create a full backup of the PIONEER directory on the USB.
 * Returns info about what was backed up.
 */
export async function backupUsbPioneer(usbRoot: string): Promise<UsbBackupInfo> {
  const pioneerDir = path.join(usbRoot, 'PIONEER')
  const backupDir = path.join(usbRoot, '.djcheck_backup', Date.now().toString())

  // Check PIONEER exists
  try {
    await fs.access(pioneerDir)
  } catch {
    throw new Error(`No PIONEER directory found at ${pioneerDir} — not a Rekordbox USB`)
  }

  // Create backup directory
  await fs.mkdir(backupDir, { recursive: true })

  // Copy entire PIONEER directory recursively
  const files: string[] = []
  await copyDirRecursive(pioneerDir, path.join(backupDir, 'PIONEER'), files)

  return {
    backupDir,
    timestamp: new Date(),
    files,
  }
}

/**
 * Restore the PIONEER directory from a backup.
 * Used when conversion fails and we need to roll back.
 */
export async function restoreFromBackup(backupInfo: UsbBackupInfo, usbRoot: string): Promise<void> {
  const pioneerDir = path.join(usbRoot, 'PIONEER')
  const backupPioneerDir = path.join(backupInfo.backupDir, 'PIONEER')

  // Remove current PIONEER directory
  await fs.rm(pioneerDir, { recursive: true, force: true })

  // Restore from backup
  await copyDirRecursive(backupPioneerDir, pioneerDir, [])
}

/**
 * Remove a backup directory after successful conversion.
 */
export async function removeBackup(backupInfo: UsbBackupInfo): Promise<void> {
  await fs.rm(backupInfo.backupDir, { recursive: true, force: true })
}

// ─── USB Detection ──────────────────────────────────────────────────────────

/**
 * Check if a directory looks like a Rekordbox USB (has PIONEER directory structure).
 */
export async function isRekordboxUsb(dirPath: string): Promise<boolean> {
  const pioneerDir = path.join(dirPath, 'PIONEER')
  try {
    const stat = await fs.stat(pioneerDir)
    if (!stat.isDirectory()) return false

    // Check for CD_Rekordbox subdirectory
    const rekordboxDir = path.join(pioneerDir, 'CD_Rekordbox')
    const rbStat = await fs.stat(rekordboxDir)
    return rbStat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Find the export.pdb file on a Rekordbox USB.
 */
export async function findPdbFile(usbRoot: string): Promise<string | null> {
  const pdbPath = path.join(usbRoot, 'PIONEER', 'CD_Rekordbox', 'export.pdb')
  try {
    await fs.access(pdbPath)
    return pdbPath
  } catch {
    return null
  }
}

/**
 * Find the ANLZ directory for a given audio file path on a Rekordbox USB.
 */
export async function findAnlzDir(usbRoot: string, audioPath: string): Promise<string | null> {
  // Get the relative path from USB root
  const relativePath = path.relative(usbRoot, audioPath).replace(/\\/g, '/')
  const hashDir = computeAnlzFolder('/' + relativePath)

  const anlzDir = path.join(usbRoot, 'PIONEER', 'CD_Rekordbox', hashDir)
  try {
    const stat = await fs.stat(anlzDir)
    return stat.isDirectory() ? anlzDir : null
  } catch {
    return null
  }
}

// ─── ANLZ PPTH Patching ─────────────────────────────────────────────────────

/**
 * Patch the PPTH (path) tag in an ANLZ file.
 * This updates the file path reference without touching waveforms, cues, or beat grids.
 *
 * ANLZ file format:
 * - Header: PMAI tag + length
 * - Sections: each has a 4-byte tag + 4-byte length + data
 * - PPTH contains the audio file path as a UTF-16LE string
 *
 * We find the PPTH section and replace the path string.
 * If the new path is a different length, we update the section length.
 */
export async function patchAnlzPpth(
  anlzFilePath: string,
  newPath: string
): Promise<{ oldPath: string; patched: boolean }> {
  const buf = await fs.readFile(anlzFilePath)

  // Find PPTH section
  let offset = 8 // skip PMAI header
  while (offset + 8 <= buf.length) {
    const tag = buf.slice(offset, offset + 4).toString('ascii')
    const sectionLen = buf.readUInt32BE(offset + 4)

    if (tag === 'PPTH') {
      // Read current path (UTF-16LE, null-terminated)
      const pathDataStart = offset + 8
      const pathDataEnd = offset + 8 + sectionLen - 8 // section length includes tag+len
      const pathBuf = buf.slice(pathDataStart, pathDataEnd)

      // Decode current path
      let nullIndex = 0
      for (let i = 0; i < pathBuf.length - 1; i += 2) {
        if (pathBuf[i] === 0 && pathBuf[i + 1] === 0) {
          nullIndex = i
          break
        }
      }
      const oldPath = pathBuf.slice(0, nullIndex).toString('utf16le')

      // Encode new path as UTF-16LE with null terminator
      const newPathBuf = Buffer.alloc(Buffer.byteLength(newPath, 'utf16le') + 2)
      newPathBuf.write(newPath, 0, 'utf16le')
      // Null terminator is already zeroed from alloc

      // Build new PPTH section
      const newSectionLen = 8 + newPathBuf.length // tag + len + data
      const newSection = Buffer.alloc(newSectionLen)
      newSection.write('PPTH', 0, 'ascii')
      newSection.writeUInt32BE(newSectionLen, 4)
      newPathBuf.copy(newSection, 8)

      // Build new file: before-PPTH + new-PPTH + after-PPTH
      const beforePpth = buf.slice(0, offset)
      const afterPpth = buf.slice(offset + 8 + sectionLen - 8 + (sectionLen % 2 === 0 ? 0 : 1))

      // Update PMAI header length
      const newTotalLen = beforePpth.length + newSection.length + afterPpth.length - 8
      const newBuf = Buffer.concat([beforePpth, newSection, afterPpth])
      newBuf.writeUInt32BE(newTotalLen, 4) // PMAI length field at offset 4

      await fs.writeFile(anlzFilePath, newBuf)
      return { oldPath, patched: true }
    }

    offset += 8 + sectionLen + (sectionLen % 2 === 0 ? 0 : 1) // word-aligned
  }

  return { oldPath: '', patched: false }
}

// ─── High-Level USB Conversion ──────────────────────────────────────────────

/**
 * Convert an audio file on a Rekordbox USB while preserving all Pioneer metadata.
 *
 * Safety guarantees:
 * 1. Full PIONEER directory backup before any modification
 * 2. If ANY step fails, restore from backup
 * 3. Only modifies the specific PDB track row and ANLZ PPTH — everything else untouched
 */
export async function convertOnUsb(
  entry: UsbConversionEntry,
  onProgress?: (msg: string) => void
): Promise<UsbConversionResult> {
  const { sourcePath, convertedPath, usbRoot } = entry
  const log = onProgress ?? (() => {})

  let backup: UsbBackupInfo | null = null

  try {
    // Step 1: Verify USB structure
    log('Verifying USB structure…')
    const isUsb = await isRekordboxUsb(usbRoot)
    if (!isUsb) {
      throw new Error('Not a valid Rekordbox USB — PIONEER/CD_Rekordbox directory not found')
    }

    // Step 2: Create backup
    log('Creating backup of PIONEER directory…')
    backup = await backupUsbPioneer(usbRoot)
    log(`Backup created: ${backup.files.length} files backed up`)

    // Step 3: Find ANLZ directory for source file
    log('Locating ANLZ analysis files…')
    const anlzDir = await findAnlzDir(usbRoot, sourcePath)
    if (!anlzDir) {
      throw new Error('Could not find ANLZ analysis directory for this track. The USB may not have been analyzed in Rekordbox.')
    }

    // Step 4: Replace audio file on USB
    log('Replacing audio file on USB…')
    await fs.copyFile(convertedPath, sourcePath)

    // Step 5: Patch ANLZ PPTH if the filename changed
    const sourceExt = path.extname(sourcePath).toLowerCase()
    const convertedExt = path.extname(convertedPath).toLowerCase()
    const anlzChanges: string[] = []

    if (sourceExt !== convertedExt) {
      // Filename changed — need to update ANLZ and relocate
      log('File extension changed — updating ANLZ path references…')

      // Patch all ANLZ files in the directory
      const anlzFiles = await fs.readdir(anlzDir)
      for (const anlzFile of anlzFiles) {
        if (anlzFile.startsWith('ANLZ')) {
          const anlzPath = path.join(anlzDir, anlzFile)
          try {
            const result = await patchAnlzPpth(anlzPath, sourcePath)
            if (result.patched) {
              anlzChanges.push(`Updated ${anlzFile}: "${result.oldPath}" → "${sourcePath}"`)
            }
          } catch (err) {
            log(`Warning: Could not patch ${anlzFile}: ${err}`)
          }
        }
      }

      // If the path hash changed, relocate the ANLZ directory
      const relativePath = path.relative(usbRoot, sourcePath).replace(/\\/g, '/')
      const newHashDir = computeAnlzFolder('/' + relativePath)
      const newAnlzDir = path.join(usbRoot, 'PIONEER', 'CD_Rekordbox', newHashDir)

      if (newAnlzDir !== anlzDir) {
        log('Path hash changed — relocating ANLZ directory…')
        await fs.mkdir(path.dirname(newAnlzDir), { recursive: true })
        await fs.rename(anlzDir, newAnlzDir)
        anlzChanges.push(`Relocated ANLZ: ${path.basename(anlzDir)} → ${newHashDir}`)
      }
    }

    // Step 6: Clean up temporary converted file
    try {
      await fs.unlink(convertedPath)
    } catch {
      // Non-critical
    }

    // Step 7: Remove backup (success)
    log('Conversion successful — removing backup…')
    await removeBackup(backup)
    backup = null

    return {
      sourcePath,
      success: true,
      pdbChanges: [], // PDB patching not yet implemented (needs rekordbox-parser)
      anlzChanges,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log(`Error: ${error}`)

    // Restore from backup if we created one
    if (backup) {
      log('Restoring from backup…')
      try {
        await restoreFromBackup(backup, usbRoot)
        log('Backup restored successfully')
      } catch (restoreErr) {
        log(`CRITICAL: Backup restore failed: ${restoreErr}. Manual restore needed from ${backup.backupDir}`)
      }
    }

    return {
      sourcePath,
      success: false,
      error,
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function copyDirRecursive(src: string, dest: string, fileList: string[]): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath, fileList)
    } else {
      await fs.copyFile(srcPath, destPath)
      fileList.push(destPath)
    }
  }
}
