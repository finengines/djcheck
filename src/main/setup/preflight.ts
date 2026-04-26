import * as fs from 'fs/promises'
import { setFfmpegPaths } from '../audio/converter'

export interface PreflightResult {
  ok: boolean
  ffmpegPath: string
  ffmpegOk: boolean
  errors: string[]
  nodeVersion: string
}

function resolveAsarPath(p: string): string {
  // When packaged, ffmpeg-static path is inside app.asar but the binary
  // is unpacked to app.asar.unpacked. Remap the path.
  if (process.env.NODE_ENV === 'production' || (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath) {
    return p.replace('app.asar/node_modules', 'app.asar.unpacked/node_modules')
  }
  return p
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function runPreflight(): Promise<PreflightResult> {
  const errors: string[] = []

  // Resolve ffmpeg binary path
  let ffmpegPath = ''
  let ffmpegOk = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require('ffmpeg-static') as string
    ffmpegPath = resolveAsarPath(raw)
    ffmpegOk = await isExecutable(ffmpegPath)
    if (!ffmpegOk) {
      errors.push(`ffmpeg binary not executable at: ${ffmpegPath}`)
    }
  } catch (err) {
    errors.push(`ffmpeg-static not found: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (ffmpegOk) {
    setFfmpegPaths(ffmpegPath, '')
  }

  return {
    ok: errors.length === 0,
    ffmpegPath,
    ffmpegOk,
    errors,
    nodeVersion: process.versions.node,
  }
}
