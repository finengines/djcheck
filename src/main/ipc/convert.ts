import { ipcMain, BrowserWindow } from 'electron'
import { convertTrack } from '../audio/converter'
import { parseRekordboxXml, updateRekordboxXml } from '../audio/rekordbox'
import type { ConvertTracksPayload, ConversionProgress } from '../../shared/ipc-types'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import * as path from 'path'

let cancelRequested = false

export function registerConvertHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONVERT_TRACKS, async (event, payload: ConvertTracksPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: 'No window' }

    cancelRequested = false
    const { tracks, options } = payload
    const conversions: Array<{ originalPath: string; outputPath: string }> = []
    const results: Array<{ trackId: string; success: boolean; outputPath?: string; error?: string }> = []

    // Load rekordbox library if provided
    let rekordboxLibrary = null
    if (options.rekordboxXmlPath) {
      try {
        rekordboxLibrary = await parseRekordboxXml(options.rekordboxXmlPath)
      } catch (err) {
        win.webContents.send(IPC_CHANNELS.CONVERSION_RESULT, {
          trackId: 'rekordbox',
          success: false,
          error: `Failed to parse rekordbox.xml: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    for (const track of tracks) {
      if (cancelRequested) break

      const sendProgress = (percent: number, stage: ConversionProgress['stage']): void => {
        const progress: ConversionProgress = { trackId: track.trackId, percent, stage }
        win.webContents.send(IPC_CHANNELS.CONVERSION_PROGRESS, progress)
      }

      try {
        const outputPath = await convertTrack({
          trackId: track.trackId,
          filePath: track.filePath,
          issues: track.issues,
          options,
          onProgress: sendProgress,
        })

        conversions.push({ originalPath: track.filePath, outputPath })
        results.push({ trackId: track.trackId, success: true, outputPath })
        win.webContents.send(IPC_CHANNELS.CONVERSION_RESULT, {
          trackId: track.trackId,
          success: true,
          outputPath,
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        results.push({ trackId: track.trackId, success: false, error })
        win.webContents.send(IPC_CHANNELS.CONVERSION_RESULT, {
          trackId: track.trackId,
          success: false,
          error,
        })
      }
    }

    // Update rekordbox XML if provided
    if (rekordboxLibrary && conversions.length > 0 && options.rekordboxXmlPath) {
      const xmlDir = path.dirname(options.rekordboxXmlPath)
      const outputXmlPath = path.join(xmlDir, 'rekordbox_djcheck.xml')
      try {
        const { updatedCount, hotCueWarnings } = await updateRekordboxXml(
          rekordboxLibrary, conversions, outputXmlPath
        )
        win.webContents.send(IPC_CHANNELS.CONVERSION_COMPLETE, {
          results,
          rekordbox: { updatedCount, outputXmlPath, hotCueWarnings },
        })
      } catch (err) {
        win.webContents.send(IPC_CHANNELS.CONVERSION_COMPLETE, {
          results,
          rekordbox: {
            updatedCount: 0,
            outputXmlPath: null,
            hotCueWarnings: [],
            error: err instanceof Error ? err.message : String(err),
          },
        })
      }
    } else {
      win.webContents.send(IPC_CHANNELS.CONVERSION_COMPLETE, { results, rekordbox: null })
    }
  })

  ipcMain.on(IPC_CHANNELS.CANCEL_CONVERSION, () => {
    cancelRequested = true
  })
}
