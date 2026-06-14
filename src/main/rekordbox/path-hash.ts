/**
 * path-hash.ts — Pioneer CDJ path hashing algorithm
 *
 * Ported from DjManager's getFolderName() (which itself ports beirbox-gui).
 *
 * Pioneer CDJs store ANLZ analysis files at:
 *   PIONEER/USBANLZ/{hash}/ANLZ0000.DAT
 *
 * The hash is derived from the USB-relative file path. When we convert
 * a file (e.g. .flac → .aiff), the path changes, which means:
 *   1. A new hash is computed
 *   2. The ANLZ directory must be relocated to the new hash folder
 *   3. The PPTH section inside each ANLZ file must be updated
 *
 * IMPORTANT: The filename MUST have a leading slash and use forward slashes.
 * e.g. "/music/Artist - Title.flac" (not "music/Artist - Title.flac")
 */

/**
 * Compute the Pioneer ANLZ folder name for a given USB-relative file path.
 *
 * @param filename - USB-relative path with leading slash, forward slashes only
 *                   e.g. "/music/Artist - Title.flac"
 * @returns Folder name like "P001/00012ABC"
 *
 * Algorithm:
 *   1. Normalise to forward slashes with leading slash
 *   2. Compute a uint32 hash using multiply-add with constants 0x34f5501d and 0x93b6
 *   3. Derive part2 = hash % 0x30d43
 *   4. Derive part1 via bit-manipulation of part2
 *   5. Format as "P{part1:03X}/{part2:08X}"
 */
export function getFolderName(filename: string): string {
  // Normalise to forward slashes and ensure leading slash
  let normalized = filename.replace(/\\/g, '/')
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  // Compute uint32 hash using FNV-like multiply-add
  // The constants 0x34f5501d and 0x93b6 are specific to Pioneer's algorithm
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i)
    // Simulate uint32 overflow using >>> 0 (unsigned right shift)
    hash = (Math.imul(hash, 0x34f5501d) + Math.imul(c, 0x93b6)) >>> 0
  }

  const part2 = hash % 0x30d43

  // Bit-manipulation to derive directory index (part1)
  // This is a series of masked shifts and ORs specific to Pioneer's layout
  const part1 =
    ((((((((((part2 >> 2) & 0x4000) | (part2 & 0x2000)) >> 3) | (part2 & 0x200)) >> 1) |
      (part2 & 0xc0)) >>
      3) |
      (part2 & 0x4)) >>
      1) |
    (part2 & 0x1)

  // Format: P{3-digit hex}/{8-digit hex}, uppercase
  return `P${part1.toString(16).toUpperCase().padStart(3, '0')}/${part2.toString(16).toUpperCase().padStart(8, '0')}`
}

/**
 * Compute the full ANLZ directory path relative to the USB root.
 *
 * @param usbRelativePath - USB-relative file path (e.g. "/music/track.flac")
 * @returns Relative path like "PIONEER/USBANLZ/P001/00012ABC"
 */
export function getAnlzRelativePath(usbRelativePath: string): string {
  return `PIONEER/USBANLZ/${getFolderName(usbRelativePath)}`
}
