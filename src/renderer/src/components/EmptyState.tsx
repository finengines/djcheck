import { useStore } from '../store'

export default function EmptyState() {
  const { analysisRunning, startAnalysis } = useStore()

  const handleClick = async () => {
    const paths = await window.djcheck.pickAudioFiles()
    if (paths.length > 0) startAnalysis(paths)
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
              Drop audio files here, or click to browse. DJCheck analyses every file for CDJ compatibility issues and fixes them locally — no upload, instant results.
            </p>
            <button onClick={handleClick} className="btn btn-primary px-8 h-11 text-sm font-semibold">
              Browse files
            </button>
          </div>

          <p className="text-xs text-center" style={{ color: 'var(--muted)', opacity: 0.5 }}>
            MP3 · WAV · AIFF · FLAC · M4A · OGG
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
