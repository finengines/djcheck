import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store'

interface Props {
  /** File paths to normalize */
  filePaths: string[]
  onClose: () => void
}

export default function NormalizeModal({ filePaths, onClose }: Props) {
  const { startNormalization } = useStore()

  const [targetLufs, setTargetLufs] = useState(-14)
  const [outputFormat, setOutputFormat] = useState<'aiff-24' | 'aiff-16' | 'wav-24' | 'wav-16' | 'mp3-320'>('aiff-24')

  const handleNormalize = () => {
    startNormalization(
      filePaths.map(p => ({ filePath: p })),
      {
        targetLufs,
        truePeak: -1.0,
        outputFormat,
        applyDither: false,
      }
    )
    onClose()
  }

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', zIndex: 100, backdropFilter: 'blur(4px)' }}
    >
      <div
        className="flex flex-col rounded-2xl animate-fade-in"
        style={{
          width: 420,
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-cal text-xl text-white tracking-tight">
            Normalize loudness
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Apply linear gain adjustment for consistent perceived loudness across {filePaths.length} file{filePaths.length !== 1 ? 's' : ''}.
            No limiting or compression — transients and dynamics are preserved.
          </p>
        </div>

        {/* Options */}
        <div className="px-5 py-4 flex flex-col gap-3">
          {/* Target LUFS */}
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--muted)' }}>
              Target loudness
            </label>
            <div
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'var(--surface-2)' }}
            >
              <select
                value={targetLufs}
                onChange={e => setTargetLufs(Number(e.target.value))}
                className="text-xs bg-transparent outline-none text-white w-full"
                style={{ border: 'none', cursor: 'pointer' }}
              >
                <option value={-11} style={{ background: '#1a1a1a' }}>-11 LUFS (loud — club standard)</option>
                <option value={-14} style={{ background: '#1a1a1a' }}>-14 LUFS (balanced — Spotify/YouTube)</option>
                <option value={-16} style={{ background: '#1a1a1a' }}>-16 LUFS (conservative — Apple Music)</option>
                <option value={-18} style={{ background: '#1a1a1a' }}>-18 LUFS (quiet — dynamic music)</option>
              </select>
            </div>
          </div>

          {/* Output format */}
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--muted)' }}>
              Output format
            </label>
            <div
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'var(--surface-2)' }}
            >
              <select
                value={outputFormat}
                onChange={e => setOutputFormat(e.target.value as typeof outputFormat)}
                className="text-xs bg-transparent outline-none text-white w-full"
                style={{ border: 'none', cursor: 'pointer' }}
              >
                <option value="aiff-24" style={{ background: '#1a1a1a' }}>AIFF 24-bit (recommended)</option>
                <option value="aiff-16" style={{ background: '#1a1a1a' }}>AIFF 16-bit</option>
                <option value="wav-24" style={{ background: '#1a1a1a' }}>WAV 24-bit</option>
                <option value="wav-16" style={{ background: '#1a1a1a' }}>WAV 16-bit</option>
                <option value="mp3-320" style={{ background: '#1a1a1a' }}>MP3 320kbps</option>
              </select>
            </div>
          </div>

          {/* Info box */}
          <div
            className="rounded-lg px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}
          >
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              <strong className="text-white">How it works:</strong> Two-pass EBU R128 analysis measures each file's
              perceived loudness, then applies a single constant gain to reach the target.
              This is equivalent to turning a volume knob — zero compression, zero limiting,
              zero transient damage. Files already within ±0.5 dB of target are skipped automatically.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-4"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button onClick={onClose} className="btn btn-ghost text-sm" style={{ height: 36 }}>
            Cancel
          </button>
          <button
            onClick={handleNormalize}
            className="btn btn-primary text-sm font-semibold"
            style={{ height: 36, minWidth: 120 }}
          >
            Normalize {filePaths.length} file{filePaths.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
