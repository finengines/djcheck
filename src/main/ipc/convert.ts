import { ipcMain, BrowserWindow } from 'electron'
import { convertTrack } from '../audio/converter'
import { parseRekordboxXml, updateRekordboxXml } from '../audio/rekordbox'
import { convertAndNormalize, DEFAULT_NORMALIZE_OPTIONS } from '../audio/normalizer'
import type { ConvertTracksPayload, ConversionProgress } from '../../shared/ipc-types'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import * as path from 'path'
import * as fs from 'fs/promises'

let cancelRequested = false

export function registerConvertHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONVERT_TRACKS, async (event, payload: ConvertTracksPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: 'No window' }

    cancelRequested = false
    const { tracks, options } = payload
    const conversions: Array<{ originalPath: string; outputPath: string }> = []
    const results: Array<{ trackId: string; success: boolean; outputPath?: string; error?: string; loudness?: { inputLufs: number; outputLufs: number; gainDb: number; inputTruePeak: number; inputLra: number; skipped: boolean } }> = []

    // Load rekordbox library if provided
    let rekordboxLibrary: import('../audio/rekordbox').RekordboxLibrary | null = null
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
        let outputPath: string

        if (options.normalize) {
          // ─── Convert + Normalize path ────────────────────────────────────
          // Two-pass: measure loudness, then convert + apply linear gain
          const { buildOutputPath, buildFfmpegArgs } = await import('../audio/converter')
          const issueIds = new Set(track.issues.map(i => i.id))

          outputPath = buildOutputPath(track.filePath, issueIds, options, track.sourceRoot)

          // Ensure output directory exists
          await fs.mkdir(path.dirname(outputPath), { recursive: true })

          const { outputOptions, audioFilters } = buildFfmpegArgs(
            track.filePath, issueIds, options.outputFormat, options.applyDither
          )

          // Determine if we need the atomic temp-file write for replace mode
          const sameFile = path.resolve(outputPath) === path.resolve(track.filePath)
          const ffmpegTarget = sameFile
            ? path.join(path.dirname(outputPath), `.__djcheck_tmp_${path.basename(outputPath)}`)
            : outputPath

          const normOpts = {
            ...DEFAULT_NORMALIZE_OPTIONS,
            targetLufs: options.normalizeTargetLufs ?? DEFAULT_NORMALIZE_OPTIONS.targetLufs,
            truePeak: options.normalizeTruePeak ?? DEFAULT_NORMALIZE_OPTIONS.truePeak,
          }

          sendProgress(0, 'measuring')

          const normResult = await convertAndNormalize(
            track.filePath,
            ffmpegTarget,
            audioFilters,
            outputOptions,
            normOpts,
            (pct, stage) => {
              if (stage === 'measuring') {
                sendProgress(pct * 0.3, 'measuring')
              } else {
                sendProgress(30 + Math.floor(pct * 0.65), 'converting')
              }
            }
          )

          if (sameFile) {
            await fs.rename(ffmpegTarget, outputPath)
          }

          // Replace mode: delete original if format changed
          if (options.outputMode === 'replace' && !sameFile) {
            try { await fs.unlink(track.filePath) } catch { /* ignore */ }
          }

          sendProgress(100, 'done')

          conversions.push({ originalPath: track.filePath, outputPath })
          results.push({
            trackId: track.trackId,
            success: true,
            outputPath,
            loudness: {
              inputLufs: normResult.measurement.inputI,
              outputLufs: normResult.measurement.inputI + normResult.gainDb,
              gainDb: normResult.gainDb,
              inputTruePeak: normResult.measurement.inputTp,
              inputLra: normResult.measurement.inputLra,
              skipped: Math.abs(normResult.gainDb) < 0.5,
            },
          })
        } else {
          // ─── Standard convert path (unchanged) ───────────────────────────
          outputPath = await convertTrack({
            trackId: track.trackId,
            filePath: track.filePath,
            issues: track.issues,
            options,
            sourceRoot: track.sourceRoot,
            onProgress: sendProgress,
          })

          conversions.push({ originalPath: track.filePath, outputPath })
          results.push({ trackId: track.trackId, success: true, outputPath })
        }

        win.webContents.send(IPC_CHANNELS.CONVERSION_RESULT, {
          trackId: track.trackId,
          success: true,
          outputPath,
          loudness: results[results.length - 1]?.loudness,
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

    return { success: true, results }
  })

  ipcMain.on(IPC_CHANNELS.CANCEL_CONVERSION, () => {
    cancelRequested = true
  })
}
