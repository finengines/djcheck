import { ipcMain, BrowserWindow } from 'electron'
import { normalizeFile, DEFAULT_NORMALIZE_OPTIONS } from '../audio/normalizer'
import type { NormalizeFilesPayload, NormalizeProgress, NormalizeResult as NormResult } from '../../shared/ipc-types'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import * as path from 'path'

let cancelRequested = false

export function registerNormalizeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NORMALIZE_FILES, async (event, payload: NormalizeFilesPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: 'No window' }

    cancelRequested = false
    const { files, options } = payload
    const results: NormResult[] = []

    for (const file of files) {
      if (cancelRequested) break

      const sendProgress = (percent: number, stage: NormalizeProgress['stage']): void => {
        win.webContents.send(IPC_CHANNELS.NORMALIZE_PROGRESS, {
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
          sendProgress(pct, stage)
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
        win.webContents.send(IPC_CHANNELS.NORMALIZE_RESULT, normResult)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const normResult: NormResult = {
          filePath: file.filePath,
          success: false,
          error,
        }
        results.push(normResult)
        win.webContents.send(IPC_CHANNELS.NORMALIZE_RESULT, normResult)
      }
    }

    win.webContents.send(IPC_CHANNELS.NORMALIZE_COMPLETE, { results })
  })

  ipcMain.on(IPC_CHANNELS.CANCEL_NORMALIZE, () => {
    cancelRequested = true
  })
}
