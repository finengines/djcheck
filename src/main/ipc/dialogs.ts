import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-types'
import type { AppSettings, ScannedFile } from '../../shared/ipc-types'
import Store from 'electron-store'
import * as fs from 'fs'
import * as path from 'path'

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.wave', '.aif', '.aiff', '.m4a', '.m4p', '.flac', '.ogg', '.oga', '.aac'])

function scanFolderRecursive(folderPath: string, sourceRoot: string): ScannedFile[] {
  const results: ScannedFile[] = []
  function scan(dir: string) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        results.push({ filePath: fullPath, sourceRoot })
      }
    }
  }
  scan(folderPath)
  return results
}

const store = new Store<AppSettings>({
  defaults: {
    targetModel: 'cdj-2000nxs2',
    outputFormat: 'aiff-24',
    outputMode: 'subfolder',
    outputFolder: null,
    onboardingComplete: false,
    applyDither: true,
  },
})

export function registerDialogHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PICK_OUTPUT_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Output Folder',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.PICK_REKORDBOX_XML, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      title: 'Select rekordbox.xml',
      filters: [{ name: 'rekordbox XML', extensions: ['xml'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.PICK_AUDIO_FILES, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      title: 'Select Audio Files',
      filters: [
        {
          name: 'Audio Files',
          extensions: ['mp3', 'wav', 'wave', 'aif', 'aiff', 'm4a', 'm4p', 'flac', 'ogg', 'oga', 'aac'],
        },
      ],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.on(IPC_CHANNELS.OPEN_FILE_EXTERNALLY, (_event, filePath: string) => {
    shell.openPath(filePath)
  })

  ipcMain.on(IPC_CHANNELS.REVEAL_IN_FINDER, (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IPC_CHANNELS.PICK_INPUT_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory', 'multiSelections'],
      title: 'Select Folder to Analyse',
    })
    if (result.canceled) return []
    const scanned: ScannedFile[] = []
    for (const folderPath of result.filePaths) {
      scanned.push(...scanFolderRecursive(folderPath, folderPath))
    }
    return scanned
  })

  ipcMain.handle(IPC_CHANNELS.SCAN_FOLDERS, (_event, folderPaths: string[]) => {
    const scanned: ScannedFile[] = []
    for (const folderPath of folderPaths) {
      scanned.push(...scanFolderRecursive(folderPath, folderPath))
    }
    return scanned
  })

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => {
    return store.store
  })

  ipcMain.handle(IPC_CHANNELS.SET_SETTINGS, (_event, settings: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key as keyof AppSettings, value as never)
    }
    return store.store
  })
}

export { store }
