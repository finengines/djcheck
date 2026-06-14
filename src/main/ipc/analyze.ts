import { ipcMain, BrowserWindow } from 'electron'
import * as crypto from 'crypto'
import { analyzeFile } from '../audio/analyzer'
import type { AnalyzeFilesPayload } from '../../shared/ipc-types'
import { IPC_CHANNELS } from '../../shared/ipc-types'

const MAX_CONCURRENT = 4
let cancelRequested = false

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

export function registerAnalyzeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ANALYZE_FILES, async (event, payload: AnalyzeFilesPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    cancelRequested = false
    const { files, targetModel, measureLoudness: measureLoudnessFlag } = payload
    const queue = [...files]
    const active = new Set<Promise<void>>()
    const sendProgress = throttledSender(win, IPC_CHANNELS.ANALYSIS_PROGRESS)

    const runOne = async (): Promise<void> => {
      if (queue.length === 0 || cancelRequested) return
      const file = queue.shift()!
      const trackId = crypto.randomUUID()

      sendProgress(trackId)
      const result = await analyzeFile(file.filePath, targetModel, trackId, measureLoudnessFlag ?? false)
      if (file.sourceRoot) result.sourceRoot = file.sourceRoot
      // Always send results immediately (not throttled)
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
    // Always send complete immediately (not throttled)
    win.webContents.send(IPC_CHANNELS.ANALYSIS_COMPLETE)
  })

  ipcMain.on(IPC_CHANNELS.CANCEL_ANALYSIS, () => {
    cancelRequested = true
  })
}
