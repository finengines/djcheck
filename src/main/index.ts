import { app, BrowserWindow, Menu, shell, dialog } from 'electron'
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
    title: 'DJCheck',
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

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const macAppMenu: Electron.MenuItemConstructorOptions = {
    label: 'DJCheck',
    submenu: [
      { label: 'About DJCheck', click: () => { dialog.showMessageBox({ type: 'info', title: 'About DJCheck', message: 'DJCheck', detail: `Version ${app.getVersion()}\n\nPioneer CDJ Audio File Compatibility Checker\n\nChecks your audio files against Pioneer CDJ player specifications and auto-fixes issues.`, buttons: ['OK'] }) } },
      { type: 'separator' },
      { label: 'Preferences…', accelerator: 'Cmd+,', click: () => { /* settings UI coming in a future release */ } },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }

  const fileMenu: Electron.MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'Open Files…',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          if (!mainWindow) return
          const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile', 'multiSelections'],
            title: 'Select Audio Files',
            filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'wave', 'aif', 'aiff', 'm4a', 'm4p', 'flac', 'ogg', 'oga', 'aac'] }],
          })
          if (!result.canceled && result.filePaths.length > 0) {
            mainWindow.webContents.send('menu:open-files', result.filePaths)
          }
        },
      },
      {
        label: 'Open Folder…',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: async () => {
          if (!mainWindow) return
          const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory', 'multiSelections'],
            title: 'Select Folder to Analyse',
          })
          if (!result.canceled && result.filePaths.length > 0) {
            mainWindow.webContents.send('menu:open-folders', result.filePaths)
          }
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }

  const editMenu: Electron.MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  }

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }

  const windowMenu: Electron.MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' },
    ],
  }

  const helpMenu: Electron.MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'DJCheck Help',
        click: () => { shell.openExternal('https://github.com/finengines/djcheck') },
      },
      {
        label: 'Report an Issue',
        click: () => { shell.openExternal('https://github.com/finengines/djcheck/issues') },
      },
      { type: 'separator' },
      {
        label: 'Supported CDJ Models',
        click: () => {
          dialog.showMessageBox({
            type: 'info',
            title: 'Supported CDJ Models',
            message: 'Supported Pioneer CDJ Models',
            detail: [
              'CDJ-2000 / CDJ-900 / CDJ-850 / CDJ-400 / CDJ-350',
              '  44.1/48 kHz WAV & AIFF only',
              '',
              'CDJ-2000NXS / XDJ-1000',
              '  44.1/48 kHz WAV & AIFF only',
              '',
              'CDJ-2000NXS2 / XDJ-1000MK2',
              '  Up to 96 kHz. FLAC & ALAC supported.',
              '',
              'CDJ-3000 / CDJ-3000X',
              '  Up to 96 kHz. FLAC & ALAC supported.',
            ].join('\n'),
            buttons: ['OK'],
          })
        },
      },
    ],
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    ...(isMac ? [windowMenu] : []),
    helpMenu,
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(async () => {
  // Set app name for macOS About panel and dock
  app.setName('DJCheck')

  // Register all IPC handlers before creating the window
  registerAnalyzeHandlers()
  registerConvertHandlers()
  registerDialogHandlers()

  createWindow()
  buildMenu()

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
