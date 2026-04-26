export default function DropZone() {
  return (
    <div className="drop-overlay">
      <div
        className="flex flex-col items-center gap-4 rounded-2xl p-12"
        style={{
          background: 'rgba(255,255,255,0.04)',
          boxShadow: '0 0 0 2px rgba(255,255,255,0.15)',
        }}
      >
        <div className="text-5xl">🎵</div>
        <div className="text-center">
          <p className="font-cal text-2xl text-white mb-2">Drop tracks here</p>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            MP3, WAV, AIFF, FLAC, M4A, OGG
          </p>
        </div>
      </div>
    </div>
  )
}
