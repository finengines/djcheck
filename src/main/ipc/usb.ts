/**
 * IPC handlers for Rekordbox USB preservation.
 * Handles: usb:detect, usb:convert, usb:cancel
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import type { UsbConvertPayload, UsbProgress, UsbResult, UsbCompletePayload } from '../../shared/ipc-types'
import { isRekordboxUsb, convertOnUsb } from '../rekordbox'
import { convertTrack } from '../audio/converter'

let cancelRequested = false

export function registerUsbHandlers(): void {
  // Detect if a directory is a Rekordbox USB
  ipcMain.handle(IPC_CHANNELS.USB_DETECT, async (_event, dirPath: string) => {
    return isRekordboxUsb(dirPath)
  })

  // Convert tracks on a Rekordbox USB
  ipcMain.handle(IPC_CHANNELS.USB_CONVERT, async (event, payload: UsbConvertPayload) => {
    cancelRequested = false
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { usbRoot, tracks, options } = payload
    const results: UsbResult[] = []

    const sendProgress = (_trackId: string, p: UsbProgress) => {
      win.webContents.send(IPC_CHANNELS.USB_PROGRESS, p)
    }
    const sendResult = (r: UsbResult) => {
      win.webContents.send(IPC_CHANNELS.USB_RESULT, r)
    }

    for (let i = 0; i < tracks.length; i++) {
      if (cancelRequested) break

      const track = tracks[i]
      const basePercent = Math.round(((i) / tracks.length) * 100)

      try {
        // Step 1: Convert the audio file using the existing pipeline
        // (converts in-place when replace mode, or creates new file alongside)
        sendProgress(track.trackId, {
          trackId: track.trackId,
          percent: basePercent,
          stage: 'converting',
          message: 'Converting audio file…',
        })

        const convertedPath = await convertTrack({
          trackId: track.trackId,
          filePath: track.sourcePath,
          issues: track.issues,
          options,
          sourceRoot: usbRoot,
          onProgress: (pct, stage) => {
            // Map converter progress stages to USB progress stages
            const usbStage: UsbProgress['stage'] =
              stage === 'done' ? 'done' : 'converting'
            sendProgress(track.trackId, {
              trackId: track.trackId,
              percent: Math.round(basePercent + (pct / 200) * (100 / tracks.length)),
              stage: usbStage,
              message: stage === 'converting' ? 'Converting audio…' :
                       stage === 'writing-tags' ? 'Writing metadata tags…' :
                       stage === 'preparing' ? 'Preparing conversion…' : 'Done',
            })
          },
        })

        // Step 2: Apply ANLZ metadata patching on the USB
        sendProgress(track.trackId, {
          trackId: track.trackId,
          percent: Math.round(basePercent + (100 / tracks.length) * 0.6),
          stage: 'patching-anlz',
          message: 'Patching ANLZ metadata…',
        })

        const usbResult = await convertOnUsb({
          sourcePath: track.sourcePath,
          convertedPath,
          usbRoot,
        }, (msg) => {
          const stage: UsbProgress['stage'] =
            msg.toLowerCase().includes('backup') ? 'backing-up' :
            msg.toLowerCase().includes('anlz') || msg.toLowerCase().includes('patch') ? 'patching-anlz' :
            msg.toLowerCase().includes('relocat') ? 'relocating' :
            msg.toLowerCase().includes('verif') ? 'verifying' : 'converting'

          sendProgress(track.trackId, {
            trackId: track.trackId,
            percent: basePercent,
            stage,
            message: msg,
          })
        })

        const result: UsbResult = {
          trackId: track.trackId,
          sourcePath: track.sourcePath,
          success: usbResult.success,
          error: usbResult.error,
          anlzChanges: usbResult.anlzChanges,
        }
        results.push(result)
        sendResult(result)

      } catch (err) {
        const result: UsbResult = {
          trackId: track.trackId,
          sourcePath: track.sourcePath,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
        results.push(result)
        sendResult(result)
      }
    }

    const complete: UsbCompletePayload = {
      total: tracks.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    }
    win.webContents.send(IPC_CHANNELS.USB_COMPLETE, complete)
    return complete
  })

  // Cancel USB conversion
  ipcMain.handle(IPC_CHANNELS.USB_CANCEL, async () => {
    cancelRequested = true
  })
}
