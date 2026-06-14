import { useState } from 'react'
import { useStore } from '../store'

/**
 * Modal for converting files on a Rekordbox USB while preserving Pioneer metadata.
 * Shows heavy safety warnings about modifying the USB.
 */
export default function UsbModal({ onClose }: { onClose: () => void }) {
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [usbRoot, setUsbRoot] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [detected, setDetected] = useState(false)
  const [detectError, setDetectError] = useState('')

  const { usbConverting, usbProgress, startUsbConversion, cancelUsbConversion } = useStore()

  const selectedTracks = useStore(s => {
    return [...s.tracks.values()].filter(t =>
      s.selectedIds.has(t.id) && t.issues.some(i => i.severity === 'error')
    )
  })

  const handleDetect = async () => {
    if (!usbRoot.trim()) return
    setDetecting(true)
    setDetectError('')
    try {
      const isUsb = await window.djcheck.detectUsb(usbRoot.trim())
      setDetected(isUsb)
      if (!isUsb) {
        setDetectError('No PIONEER/CD_Rekordbox directory found — not a valid Rekordbox USB')
      }
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : String(err))
      setDetected(false)
    } finally {
      setDetecting(false)
    }
  }

  const handleStart = () => {
    if (!detected || !confirmChecked) return
    startUsbConversion(usbRoot.trim(), selectedTracks.map(t => t.id))
  }

  const progressEntries = [...usbProgress.values()]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 560 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>💾 USB Mode — Rekordbox Preservation</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          {/* Safety warning */}
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}
          >
            <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>
              ⚠️ This modifies your Rekordbox USB in place
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text)', fontSize: 13, lineHeight: 1.6 }}>
              <li>A <strong>full backup</strong> of the PIONEER directory is created before any changes</li>
              <li>If <em>anything</em> goes wrong, the backup is <strong>automatically restored</strong></li>
              <li>Hot cues, memory points, loops, waveforms, and beat grids are <strong>preserved</strong></li>
              <li>Only the audio file and its path reference in ANLZ are modified</li>
              <li>Ensure your USB is <strong>not read-only</strong> and has enough free space</li>
            </ul>
          </div>

          {/* How it works */}
          <div style={{ marginBottom: 20, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text)' }}>How it works:</strong> DJ Check converts the audio file,
            then patches the ANLZ analysis files to point to the new file. The PDB database (playlists, track
            listings) is updated with the new filename, size, and format. All waveform data, cue points, and
            beat grids remain untouched.
          </div>

          {/* USB root input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              USB Root Path
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={usbRoot}
                onChange={e => { setUsbRoot(e.target.value); setDetected(false); setDetectError('') }}
                placeholder="/Volumes/PIONEER or E:\"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 13,
                }}
              />
              <button
                className="btn btn-ghost"
                onClick={handleDetect}
                disabled={!usbRoot.trim() || detecting}
                style={{ whiteSpace: 'nowrap' }}
              >
                {detecting ? 'Detecting…' : 'Detect USB'}
              </button>
            </div>
            {detectError && (
              <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{detectError}</div>
            )}
            {detected && (
              <div style={{ color: '#86efac', fontSize: 12, marginTop: 4 }}>
                ✓ Rekordbox USB detected — PIONEER/CD_Rekordbox found
              </div>
            )}
          </div>

          {/* Track count */}
          <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--muted)' }}>
            {selectedTracks.length > 0 ? (
              <>{selectedTracks.length} track{selectedTracks.length !== 1 ? 's' : ''} selected for conversion</>
            ) : (
              <span style={{ color: '#f59e0b' }}>No tracks selected — select tracks with issues first</span>
            )}
          </div>

          {/* Confirmation checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 20,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={e => setConfirmChecked(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span>I understand this will modify my USB and I have a separate backup</span>
          </label>

          {/* Progress */}
          {usbConverting && progressEntries.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {progressEntries.map(p => (
                <div key={p.trackId} style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                  {p.message} ({p.percent}%)
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={usbConverting}>
              Cancel
            </button>
            {usbConverting ? (
              <button className="btn btn-primary" style={{ background: '#ef4444' }} onClick={cancelUsbConversion}>
                Stop Conversion
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleStart}
                disabled={!detected || !confirmChecked || selectedTracks.length === 0}
              >
                Convert on USB
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
