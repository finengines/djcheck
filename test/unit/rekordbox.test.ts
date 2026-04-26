import { describe, it, expect } from 'vitest'
import { detectRekordboxVersion } from '../../src/main/audio/rekordbox'
import type { RekordboxLibrary } from '../../src/main/audio/rekordbox'

function makeLibrary(version: string | null): RekordboxLibrary {
  return {
    parsed: {},
    tracks: new Map(),
    version,
  }
}

describe('detectRekordboxVersion', () => {
  it('detects rekordbox 7.2.12 as broken', () => {
    const lib = makeLibrary('7.2.12')
    const result = detectRekordboxVersion(lib)
    expect(result.isBroken).toBe(true)
    expect(result.warning).toContain('7.2.12')
  })

  it('does not flag other versions as broken', () => {
    for (const v of ['7.2.11', '7.3.0', '6.6.5', '5.8.0']) {
      const lib = makeLibrary(v)
      const result = detectRekordboxVersion(lib)
      expect(result.isBroken).toBe(false)
      expect(result.warning).toBeNull()
    }
  })

  it('handles null version gracefully', () => {
    const lib = makeLibrary(null)
    const result = detectRekordboxVersion(lib)
    expect(result.isBroken).toBe(false)
    expect(result.version).toBeNull()
  })
})
