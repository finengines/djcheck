import { ipcMain, BrowserWindow } from 'electron'
import * as crypto from 'crypto'
import { analyzeFile } from '../audio/analyzer'
import type { AnalyzeFilesPayload } from '../../shared/ipc-types'
import { IPC_CHANNELS } from '../../shared/ipc-types'

const MAX_CONCURRENT = 4
let cancelRequested = false

export function registerAnalyzeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ANALYZE_FILES, async (event, payload: AnalyzeFilesPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    cancelRequested = false
    const { filePaths, targetModel } = payload
    const queue = [...filePaths]
    const active = new Set<Promise<void>>()

    const runOne = async (): Promise<void> => {
      if (queue.length === 0 || cancelRequested) return
      const filePath = queue.shift()!
      const trackId = crypto.randomUUID()

      win.webContents.send(IPC_CHANNELS.ANALYSIS_PROGRESS, trackId)
      const result = await analyzeFile(filePath, targetModel, trackId)
      win.webContents.send(IPC_CHANNELS.ANALYSIS_RESULT, result)
    }

    while (queue.length > 0 && !cancelRequested) {
      while (active.size < MAX_CONCURRENT && queue.length > 0 && !cancelRequested) {
        const p = runOne().finally(() => active.delete(p as Promise<void>))
        active.add(p)
      }
      if (active.size > 0) await Promise.race(active)
    }

    await Promise.all(active)
    win.webContents.send(IPC_CHANNELS.ANALYSIS_COMPLETE)
  })

  ipcMain.on(IPC_CHANNELS.CANCEL_ANALYSIS, () => {
    cancelRequested = true
  })
}
