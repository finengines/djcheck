import { useStore } from '../store'

export default function EmptyState() {
  const { analysisRunning, startAnalysis } = useStore()

  const handleBrowseFiles = async () => {
    const paths = await window.djcheck.pickAudioFiles()
    if (paths.length > 0) startAnalysis(paths)
  }

  const handleBrowseFolder = async () => {
    const scanned = await window.djcheck.pickInputFolder()
    if (scanned.length > 0) startAnalysis(scanned)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 animate-fade-in">
      {analysisRunning ? (
        <>
          <div
            className="animate-spin w-10 h-10 rounded-full"
            style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: 'rgba(255,255,255,0.5)' }}
          />
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Analysing tracks…</p>
        </>
      ) : (
        <>
          {/* Waveform-style illustration */}
          <WaveformIllustration />

          <div className="text-center max-w-xs">
            <h2 className="font-cal text-3xl text-white mb-3 tracking-tight">
              Check your tracks
            </h2>
            <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--muted)' }}>
              Drop audio files or a folder here, or click to browse. DJCheck analyses every file for CDJ compatibility issues and fixes them locally — no upload, instant results.
            </p>
            <div className="flex gap-2 justify-center">
              <button onClick={handleBrowseFiles} className="btn btn-primary px-6 h-11 text-sm font-semibold">
                Browse files
              </button>
              <button
                onClick={handleBrowseFolder}
                className="btn btn-dark px-6 h-11 text-sm font-semibold"
              >
                <FolderIcon />
                Browse folder
              </button>
            </div>
          </div>

          <p className="text-xs text-center" style={{ color: 'var(--muted)', opacity: 0.5 }}>
            MP3 · WAV · AIFF · FLAC · M4A · OGG · drag &amp; drop folders supported
          </p>
        </>
      )}
    </div>
  )
}

function WaveformIllustration() {
  const bars = [3, 6, 10, 7, 14, 9, 5, 12, 8, 15, 6, 11, 4, 9, 13, 7, 5, 10, 8, 3]
  return (
    <div className="flex items-end gap-1" style={{ height: 40 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="rounded-sm"
          style={{
            width: 3,
            height: h * 2.5,
            background: `rgba(255,255,255,${0.08 + (h / 15) * 0.12})`,
          }}
        />
      ))}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginRight: 4 }}>
      <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.379l1.414 1.414A1 1 0 0 0 8 4.5h5.5A1 1 0 0 1 14.5 5.5v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}
