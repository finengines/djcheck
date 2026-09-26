import { ipcMain, BrowserWindow } from 'electron'
import { normalizeFile, DEFAULT_NORMALIZE_OPTIONS } from '../audio/normalizer'
import type { NormalizeFilesPayload, NormalizeProgress, NormalizeResult as NormResult } from '../../shared/ipc-types'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import * as os from 'os'

let cancelRequested = false

// ponytail: same rationale as convert.ts — lame/loudnorm are single-threaded per file
const MAX_CONCURRENT = Math.max(2, Math.min(8, os.cpus().length - 2))

function throttledSender(win: BrowserWindow, channel: string, minIntervalMs = 100) {
  let lastSent = 0
  return (data: any) => {
    const now = Date.now()
    if (now - lastSent >= minIntervalMs) {
      lastSent = now
      win.webContents.send(channel, data)
    }
  }
}

export function registerNormalizeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NORMALIZE_FILES, async (event, payload: NormalizeFilesPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: 'No window' }

    cancelRequested = false
    const { files, options } = payload
    const results: NormResult[] = []
    const sendProgress = throttledSender(win, IPC_CHANNELS.NORMALIZE_PROGRESS)
    const queue = [...files]
    const active = new Set<Promise<void>>()

    const runOne = async (): Promise<void> => {
      if (queue.length === 0 || cancelRequested) return
      const file = queue.shift()!

      const throttledProgress = (percent: number, stage: NormalizeProgress['stage']): void => {
        sendProgress({
          filePath: file.filePath,
          percent,
          stage,
        } as NormalizeProgress)
      }

      try {
        const normOpts = {
          ...DEFAULT_NORMALIZE_OPTIONS,
          targetLufs: options.targetLufs,
          truePeak: options.truePeak,
          outputFormat: options.outputFormat,
          applyDither: options.applyDither,
        }

        const result = await normalizeFile(file.filePath, normOpts, (pct, stage) => {
          throttledProgress(pct, stage)
        })

        const loudness = result.skipped
          ? {
              inputLufs: result.measurement.inputI,
              outputLufs: result.measurement.inputI,
              gainDb: 0,
              inputTruePeak: result.measurement.inputTp,
              inputLra: result.measurement.inputLra,
              skipped: true,
            }
          : {
              inputLufs: result.measurement.inputI,
              outputLufs: result.measurement.inputI + result.gainDb,
              gainDb: result.gainDb,
              inputTruePeak: result.measurement.inputTp,
              inputLra: result.measurement.inputLra,
              skipped: false,
            }

        const normResult: NormResult = {
          filePath: file.filePath,
          success: true,
          outputPath: result.outputPath,
          loudness,
        }

        results.push(normResult)
        // Always send results immediately (not throttled)
        win.webContents.send(IPC_CHANNELS.NORMALIZE_RESULT, normResult)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const normResult: NormResult = {
          filePath: file.filePath,
          success: false,
          error,
        }
        results.push(normResult)
        // Always send errors immediately (not throttled)
        win.webContents.send(IPC_CHANNELS.NORMALIZE_RESULT, normResult)
      }
    }

    // Queue-based pool pattern for concurrent processing
    while (queue.length > 0 && !cancelRequested) {
      while (active.size < MAX_CONCURRENT && queue.length > 0 && !cancelRequested) {
        const p = runOne().finally(() => active.delete(p as Promise<void>))
        active.add(p)
      }
      if (active.size > 0) await Promise.race(active)
    }

    await Promise.all(active)

    // Always send complete immediately (not throttled)
    win.webContents.send(IPC_CHANNELS.NORMALIZE_COMPLETE, { results })

    return { success: true, results }
  })

  ipcMain.on(IPC_CHANNELS.CANCEL_NORMALIZE, () => {
    cancelRequested = true
  })
}
