import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnalyzeFilesPayload,
  ConvertTracksPayload,
  TrackAnalysis,
  ConversionResult,
  ConversionProgress,
  AppSettings,
  ScannedFile,
} from '../shared/ipc-types'
import { IPC_CHANNELS } from '../shared/ipc-types'

type Unsubscribe = () => void

const api = {
  // ─── Analysis ───────────────────────────────────────────────────────────────
  analyzeFiles: (payload: AnalyzeFilesPayload): void => {
    ipcRenderer.invoke(IPC_CHANNELS.ANALYZE_FILES, payload)
  },
  cancelAnalysis: (): void => {
    ipcRenderer.send(IPC_CHANNELS.CANCEL_ANALYSIS)
  },
  onAnalysisProgress: (cb: (trackId: string) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on(IPC_CHANNELS.ANALYSIS_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ANALYSIS_PROGRESS, handler)
  },
  onAnalysisResult: (cb: (result: TrackAnalysis) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, r: TrackAnalysis): void => cb(r)
    ipcRenderer.on(IPC_CHANNELS.ANALYSIS_RESULT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ANALYSIS_RESULT, handler)
  },
  onAnalysisComplete: (cb: () => void): Unsubscribe => {
    ipcRenderer.once(IPC_CHANNELS.ANALYSIS_COMPLETE, cb)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ANALYSIS_COMPLETE, cb)
  },

  // ─── Conversion ─────────────────────────────────────────────────────────────
  convertTracks: (payload: ConvertTracksPayload): void => {
    ipcRenderer.invoke(IPC_CHANNELS.CONVERT_TRACKS, payload)
  },
  cancelConversion: (): void => {
    ipcRenderer.send(IPC_CHANNELS.CANCEL_CONVERSION)
  },
  onConversionProgress: (cb: (progress: ConversionProgress) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, p: ConversionProgress): void => cb(p)
    ipcRenderer.on(IPC_CHANNELS.CONVERSION_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CONVERSION_PROGRESS, handler)
  },
  onConversionResult: (cb: (result: ConversionResult) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, r: ConversionResult): void => cb(r)
    ipcRenderer.on(IPC_CHANNELS.CONVERSION_RESULT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CONVERSION_RESULT, handler)
  },
  onConversionComplete: (cb: (payload: unknown) => void): Unsubscribe => {
    ipcRenderer.once(IPC_CHANNELS.CONVERSION_COMPLETE, (_e, p) => cb(p))
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CONVERSION_COMPLETE, cb)
  },

  // ─── Dialogs ─────────────────────────────────────────────────────────────────
  pickOutputFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PICK_OUTPUT_FOLDER),
  pickRekordboxXml: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PICK_REKORDBOX_XML),
  pickAudioFiles: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PICK_AUDIO_FILES),
  pickInputFolder: (): Promise<ScannedFile[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PICK_INPUT_FOLDER),
  scanFolders: (folderPaths: string[]): Promise<ScannedFile[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDERS, folderPaths),
  openFileExternally: (filePath: string): void => {
    ipcRenderer.send(IPC_CHANNELS.OPEN_FILE_EXTERNALLY, filePath)
  },
  revealInFinder: (filePath: string): void => {
    ipcRenderer.send(IPC_CHANNELS.REVEAL_IN_FINDER, filePath)
  },

  // ─── Settings ────────────────────────────────────────────────────────────────
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  setSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SETTINGS, settings),

  // ─── Preflight ───────────────────────────────────────────────────────────────
  onPreflightResult: (cb: (result: unknown) => void): Unsubscribe => {
    ipcRenderer.once(IPC_CHANNELS.PREFLIGHT_RESULT, (_e, r) => cb(r))
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PREFLIGHT_RESULT, cb)
  },
}

contextBridge.exposeInMainWorld('djcheck', api)

export type DJCheckAPI = typeof api

declare global {
  interface Window {
    djcheck: DJCheckAPI
  }
}
