import { useCallback, useEffect } from 'react'
import { useStore } from '../store'
import TitleBar from '../components/TitleBar'
import Sidebar from '../components/Sidebar'
import Toolbar from '../components/Toolbar'
import TrackList from '../components/TrackList'
import DropZone from '../components/DropZone'
import ConversionProgress from '../components/ConversionProgress'
import ConversionSummary from '../components/ConversionSummary'
import EmptyState from '../components/EmptyState'

export default function Home() {
  const {
    tracks,
    analysisRunning,
    isDragOver,
    setDragOver,
    startAnalysis,
    conversionRunning,
    conversionComplete,
  } = useStore()

  const hasTracks = tracks.size > 0

  // Global drag-and-drop handling
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [setDragOver])

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!e.relatedTarget) setDragOver(false)
  }, [setDragOver])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const items = Array.from(e.dataTransfer?.items ?? [])
    const supported = ['.mp3','.wav','.wave','.aif','.aiff','.m4a','.m4p','.flac','.ogg','.oga','.aac']

    const filePaths: string[] = []
    const folderPaths: string[] = []

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      const file = item.getAsFile()
      if (!file?.path) continue
      if (entry?.isDirectory) {
        folderPaths.push(file.path)
      } else if (supported.some(ext => file.name.toLowerCase().endsWith(ext))) {
        filePaths.push(file.path)
      }
    }

    // Scan folders for audio files
    let scannedFromFolders: import('@shared/ipc-types').ScannedFile[] = []
    if (folderPaths.length > 0) {
      scannedFromFolders = await window.djcheck.scanFolders(folderPaths)
    }

    const allFiles: import('@shared/ipc-types').ScannedFile[] = [
      ...filePaths.map(p => ({ filePath: p, sourceRoot: '' })),
      ...scannedFromFolders,
    ]

    if (allFiles.length > 0) startAnalysis(allFiles)
  }, [setDragOver, startAnalysis])

  useEffect(() => {
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    // Listen for native menu events
    const unsubFiles = window.djcheck.onMenuOpenFiles(async (filePaths) => {
      const files = filePaths.map(p => ({ filePath: p, sourceRoot: '' }))
      if (files.length > 0) startAnalysis(files)
    })
    const unsubFolders = window.djcheck.onMenuOpenFolders(async (folderPaths) => {
      const scanned = await window.djcheck.scanFolders(folderPaths)
      if (scanned.length > 0) startAnalysis(scanned)
    })

    return () => {
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
      unsubFiles()
      unsubFolders()
    }
  }, [handleDragOver, handleDragLeave, handleDrop, startAnalysis])

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      <TitleBar />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div className="flex flex-col flex-1 min-w-0">
          {hasTracks && <Toolbar />}

          <div className="flex-1 min-h-0 relative">
            {hasTracks ? <TrackList /> : <EmptyState />}

            {isDragOver && <DropZone />}
          </div>

          {conversionRunning && <ConversionProgress />}
          {conversionComplete && !conversionRunning && <ConversionSummary />}
        </div>
      </div>
    </div>
  )
}
