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

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    const supported = ['.mp3','.wav','.wave','.aif','.aiff','.m4a','.m4p','.flac','.ogg','.oga','.aac']
    const paths = files
      .filter(f => supported.some(ext => f.name.toLowerCase().endsWith(ext)))
      .map(f => f.path)
    if (paths.length > 0) startAnalysis(paths)
  }, [setDragOver, startAnalysis])

  useEffect(() => {
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [handleDragOver, handleDragLeave, handleDrop])

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
