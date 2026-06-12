import { useState, useEffect, useCallback } from 'react'
import * as path from 'path-browserify'
import { useStore } from '../store'
import type { OutputMode } from '../store'

interface Props {
  /** Track IDs to convert */
  trackIds: string[]
  onClose: () => void
}

/** Derive a sensible default subfolder name from the set of tracks being converted */
function deriveDefaultName(tracks: ReturnType<typeof useStore.getState>['tracks'], ids: string[]): string {
  const roots = new Set<string>()
  for (const id of ids) {
    const t = tracks.get(id)
    if (!t) continue
    const root = t.sourceRoot || path.dirname(t.filePath)
    roots.add(root)
  }
  if (roots.size === 1) {
    return path.basename([...roots][0]) || 'converted'
  }
  // Multiple source roots — find common parent name
  const allRoots = [...roots]
  const commonParent = allRoots.reduce((prev, cur) => {
    const a = prev.split('/')
    const b = cur.split('/')
    const shared = []
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) shared.push(a[i])
      else break
    }
    return shared.join('/')
  })
  return path.basename(commonParent) || 'converted'
}

export default function ConversionModal({ trackIds, onClose }: Props) {
  const { tracks, startConversion, settings, outputFolder: savedFolder, rekordboxXmlPath } = useStore()

  const fixableCount = trackIds.filter(id => {
    const t = tracks.get(id)
    return t && t.issues.some(i => i.severity === 'error')
  }).length

  const defaultName = deriveDefaultName(tracks, trackIds)

  const [mode, setMode] = useState<OutputMode>('mirror')
  const [subfolderName, setSubfolderName] = useState(defaultName)
  const [mirrorName, setMirrorName] = useState(`${defaultName} converted`)
  const [customFolder, setCustomFolder] = useState<string | null>(savedFolder)
  const [normalize, setNormalize] = useState(false)
  const [normalizeLufs, setNormalizeLufs] = useState(-14)

  // Reset name when modal opens
  useEffect(() => { setSubfolderName(defaultName) }, [defaultName])

  const handlePickFolder = async () => {
    const folder = await window.djcheck.pickOutputFolder()
    if (folder) {
      setCustomFolder(folder)
      setMode('folder')
    }
  }

  const handleConvert = () => {
    const opts: Partial<import('@shared/ipc-types').ConversionOptions> = { outputMode: mode }
    if (mode === 'subfolder') {
      opts.outputFolder = subfolderName.trim() || defaultName
    } else if (mode === 'folder') {
      opts.outputFolder = customFolder ?? undefined
    } else if (mode === 'mirror') {
      opts.outputFolder = mirrorName.trim() || `${defaultName} converted`
    }
    if (normalize) {
      opts.normalize = true
      opts.normalizeTargetLufs = normalizeLufs
      opts.normalizeTruePeak = -1.0
    }
    startConversion(trackIds, opts)
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
            Fix {fixableCount} track{fixableCount !== 1 ? 's' : ''}
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Where should the converted files be saved?
          </p>
        </div>

        {/* Mode options */}
        <div className="px-5 py-4 flex flex-col gap-2">

          {/* Mirror — new sibling folder with full tree */}
          <button
            onClick={() => setMode('mirror')}
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all"
            style={{
              background: mode === 'mirror' ? 'rgba(255,255,255,0.07)' : 'transparent',
              boxShadow: mode === 'mirror' ? '0 0 0 1.5px rgba(255,255,255,0.15)' : '0 0 0 1px var(--border)',
              border: 'none', cursor: 'pointer',
            }}
          >
            <RadioDot active={mode === 'mirror'} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-white block mb-1">Mirror folder structure</span>
              <span className="text-xs block mb-2.5" style={{ color: 'var(--muted)' }}>
                Creates a sibling folder with the same directory tree — converted files only
              </span>
              <div
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--surface-2)' }}
                onClick={e => e.stopPropagation()}
              >
                <span className="text-xs" style={{ color: 'var(--muted)', flexShrink: 0 }}>Folder name</span>
                <input
                  className="flex-1 text-xs bg-transparent outline-none text-white min-w-0"
                  value={mirrorName}
                  onChange={e => setMirrorName(e.target.value)}
                  onFocus={() => setMode('mirror')}
                  placeholder={`${defaultName} converted`}
                  style={{ border: 'none' }}
                />
              </div>
              {mode === 'mirror' && (
                <p className="text-xs mt-1.5 opacity-60" style={{ color: 'var(--muted)' }}>
                  e.g. <code style={{ fontSize: 10 }}>…/{mirrorName || `${defaultName} converted`}/Deep/track.aiff</code>
                </p>
              )}
            </div>
          </button>

          {/* Subfolder */}
          <button
            onClick={() => setMode('subfolder')}
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all"
            style={{
              background: mode === 'subfolder' ? 'rgba(255,255,255,0.07)' : 'transparent',
              boxShadow: mode === 'subfolder' ? '0 0 0 1.5px rgba(255,255,255,0.15)' : '0 0 0 1px var(--border)',
              border: 'none', cursor: 'pointer',
            }}
          >
            <RadioDot active={mode === 'subfolder'} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-white block mb-1">New folder inside source</span>
              <span className="text-xs block mb-2.5" style={{ color: 'var(--muted)' }}>
                Creates a subfolder inside each source directory
              </span>
              {/* Editable name — only interactive when this mode is active */}
              <div
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--surface-2)' }}
                onClick={e => e.stopPropagation()}
              >
                <span className="text-xs" style={{ color: 'var(--muted)', flexShrink: 0 }}>Folder name</span>
                <input
                  className="flex-1 text-xs bg-transparent outline-none text-white min-w-0"
                  value={subfolderName}
                  onChange={e => setSubfolderName(e.target.value)}
                  onFocus={() => setMode('subfolder')}
                  placeholder={defaultName}
                  style={{ border: 'none' }}
                />
              </div>
              {mode === 'subfolder' && (
                <p className="text-xs mt-1.5 opacity-60" style={{ color: 'var(--muted)' }}>
                  e.g. <code style={{ fontSize: 10 }}>…/source/{subfolderName || defaultName}/track.aiff</code>
                </p>
              )}
            </div>
          </button>

          {/* Custom folder */}
          <button
            onClick={handlePickFolder}
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all"
            style={{
              background: mode === 'folder' ? 'rgba(255,255,255,0.07)' : 'transparent',
              boxShadow: mode === 'folder' ? '0 0 0 1.5px rgba(255,255,255,0.15)' : '0 0 0 1px var(--border)',
              border: 'none', cursor: 'pointer',
            }}
          >
            <RadioDot active={mode === 'folder'} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-white block mb-1">Choose a folder</span>
              {customFolder && mode === 'folder' ? (
                <span className="text-xs font-mono truncate block" style={{ color: 'var(--accent)' }}>
                  {customFolder}
                </span>
              ) : (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Pick any folder — sub-folder tree is preserved
                </span>
              )}
            </div>
            <span className="text-xs flex-shrink-0 self-center" style={{ color: 'var(--accent)' }}>Browse →</span>
          </button>

          {/* Replace */}
          <button
            onClick={() => setMode('replace')}
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all"
            style={{
              background: mode === 'replace' ? 'rgba(245,158,11,0.06)' : 'transparent',
              boxShadow: mode === 'replace'
                ? '0 0 0 1.5px rgba(245,158,11,0.4)'
                : '0 0 0 1px var(--border)',
              border: 'none', cursor: 'pointer',
            }}
          >
            <RadioDot active={mode === 'replace'} warning />
            <div className="flex-1 min-w-0">
              <span
                className="text-sm font-medium block mb-1"
                style={{ color: mode === 'replace' ? 'var(--warning)' : 'var(--text)' }}
              >
                Replace originals
              </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                Overwrites source files — ensure you have a backup first
              </span>
            </div>
          </button>
        </div>

        {/* Normalization */}
        <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setNormalize(!normalize)}
            className="flex items-center gap-2 w-full text-left"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div
              className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center"
              style={{
                border: `1.5px solid ${normalize ? 'var(--accent)' : 'rgba(255,255,255,0.3)'}`,
                background: normalize ? 'var(--accent)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              {normalize && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span className="text-sm font-medium text-white">Normalize loudness</span>
          </button>
          {normalize && (
            <div className="mt-2.5 ml-6">
              <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
                Two-pass EBU R128 analysis measures each file's loudness, then applies
                a single constant gain to reach the target. No limiting or compression —
                transients and dynamics are fully preserved.
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
                After conversion, you'll see a detailed loudness report showing
                before/after LUFS and the exact gain applied to each track.
              </p>
              <div
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--surface-2)' }}
              >
                <span className="text-xs" style={{ color: 'var(--muted)', flexShrink: 0 }}>Target</span>
                <select
                  value={normalizeLufs}
                  onChange={e => setNormalizeLufs(Number(e.target.value))}
                  className="text-xs bg-transparent outline-none text-white"
                  style={{ border: 'none', cursor: 'pointer' }}
                >
                  <option value={-11} style={{ background: '#1a1a1a' }}>-11 LUFS (loud — club standard)</option>
                  <option value={-14} style={{ background: '#1a1a1a' }}>-14 LUFS (balanced — Spotify/YouTube)</option>
                  <option value={-16} style={{ background: '#1a1a1a' }}>-16 LUFS (conservative — Apple Music)</option>
                  <option value={-18} style={{ background: '#1a1a1a' }}>-18 LUFS (quiet — dynamic music)</option>
                </select>
              </div>
            </div>
          )}
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
            onClick={handleConvert}
            disabled={mode === 'folder' && !customFolder}
            className="btn btn-primary text-sm font-semibold"
            style={{ height: 36, minWidth: 120, opacity: (mode === 'folder' && !customFolder) ? 0.4 : 1 }}
          >
            {mode === 'replace' ? '⚠ Replace & fix' : `Fix ${fixableCount} track${fixableCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function RadioDot({ active, warning }: { active: boolean; warning?: boolean }) {
  const color = warning ? 'var(--warning)' : 'white'
  return (
    <div
      className="flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5"
      style={{
        borderColor: active ? color : 'rgba(255,255,255,0.2)',
        background: active ? color : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      {active && (
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: warning ? '#1a1a1a' : 'var(--bg)' }} />
      )}
    </div>
  )
}
