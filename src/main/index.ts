import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { runPreflight } from './setup/preflight'
import { registerAnalyzeHandlers } from './ipc/analyze'
import { registerConvertHandlers } from './ipc/convert'
import { registerDialogHandlers, store } from './ipc/dialogs'
import { IPC_CHANNELS } from '../shared/ipc-types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const saved = store.get('windowBounds' as never) as { width: number; height: number } | undefined
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1200,
    height: saved?.height ?? 780,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#242424',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Save window size on resize
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow!.getSize()
    store.set('windowBounds' as never, { width, height } as never)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow!.webContents.openDevTools()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Register all IPC handlers before creating the window
  registerAnalyzeHandlers()
  registerConvertHandlers()
  registerDialogHandlers()

  createWindow()

  // Run preflight check and send result to renderer when it's ready
  const preflightResult = await runPreflight()
  mainWindow?.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.PREFLIGHT_RESULT, preflightResult)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
