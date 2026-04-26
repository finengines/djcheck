import { memo } from 'react'
import type { TrackAnalysis, ConversionProgress } from '../../../../shared/ipc-types'
import IssueTag from './IssueTag'

const FORMAT_COLORS: Record<string, string> = {
  wav:  '#60a5fa',
  aiff: '#34d399',
  mp3:  '#f472b6',
  aac:  '#a78bfa',
  alac: '#34d399',
  flac: '#fb923c',
  ogg:  '#94a3b8',
  unknown: '#6b7280',
}

interface Props {
  track: TrackAnalysis
  isSelected: boolean
  conversionProgress?: ConversionProgress
  convertedPath?: string
  onToggleSelect: (id: string) => void
  onFix: (id: string) => void
  onReveal: (path: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(secs: number | null): string {
  if (!secs) return ''
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const TrackRow = memo(function TrackRow({
  track,
  isSelected,
  conversionProgress,
  convertedPath,
  onToggleSelect,
  onFix,
  onReveal,
}: Props) {
  const errors = track.issues.filter(i => i.severity === 'error')
  const warnings = track.issues.filter(i => i.severity === 'warning')
  const isAnalyzing = track.status === 'analyzing'
  const isConverting = !!conversionProgress && conversionProgress.percent < 100
  const isFixed = !!convertedPath
  const formatColor = FORMAT_COLORS[track.format] ?? '#6b7280'
  const hasErrors = errors.length > 0

  return (
    <div
      className="flex items-center gap-3 px-4 transition-colors group"
      style={{
        height: 68,
        background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
        boxShadow: 'inset 0 -1px 0 var(--border)',
        cursor: 'default',
      }}
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggleSelect(track.id)}
        className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all"
        style={{
          background: isSelected ? 'var(--text)' : 'transparent',
          border: `1.5px solid ${isSelected ? 'var(--text)' : 'rgba(255,255,255,0.2)'}`,
          cursor: 'pointer',
        }}
      >
        {isSelected && (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 4l2 2 4-4" stroke="#242424" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Format badge */}
      <span
        className="flex-shrink-0 text-center font-semibold rounded"
        style={{
          fontSize: 10,
          width: 36,
          padding: '2px 0',
          background: `${formatColor}22`,
          color: formatColor,
          border: `1px solid ${formatColor}44`,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
        }}
      >
        {track.format === 'unknown' ? '?' : track.format}
      </span>

      {/* Name + tech info */}
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          {isAnalyzing ? (
            <span className="text-sm truncate" style={{ color: 'var(--muted)' }}>
              {track.fileName}
            </span>
          ) : (
            <span
              className="text-sm font-medium truncate"
              style={{ color: hasErrors ? 'var(--text)' : isFixed ? '#86efac' : 'var(--text)' }}
              title={track.filePath}
            >
              {track.fileName}
            </span>
          )}
        </div>

        {/* Tech info row */}
        {!isAnalyzing && (
          <div className="flex items-center gap-2 flex-wrap">
            {track.sampleRate && (
              <TechChip>{(track.sampleRate / 1000).toFixed(1)} kHz</TechChip>
            )}
            {track.bitDepth && (
              <TechChip>{track.bitDepth}-bit</TechChip>
            )}
            {track.channels && (
              <TechChip>{track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Stereo' : `${track.channels}ch`}</TechChip>
            )}
            {track.bitrate && track.format === 'mp3' && (
              <TechChip>{Math.round(track.bitrate / 1000)} kbps</TechChip>
            )}
            {track.fileSize > 0 && (
              <TechChip>{formatSize(track.fileSize)}</TechChip>
            )}
          </div>
        )}
      </div>

      {/* Issues */}
      <div className="flex items-center gap-1.5 flex-shrink-0 max-w-xs">
        {isAnalyzing && (
          <div className="flex items-center gap-1.5">
            <div className="animate-spin w-3 h-3 rounded-full" style={{ border: '1.5px solid rgba(255,255,255,0.1)', borderTopColor: 'rgba(255,255,255,0.5)' }} />
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Analysing…</span>
          </div>
        )}

        {isConverting && (
          <div className="flex flex-col gap-1 min-w-0" style={{ width: 120 }}>
            <span className="text-xs" style={{ color: 'var(--muted)', fontSize: 10 }}>
              {conversionProgress.stage === 'converting' ? 'Converting…' : 'Writing tags…'}
            </span>
            <div className="progress-bar w-full">
              <div className="progress-bar-fill" style={{ width: `${conversionProgress.percent}%` }} />
            </div>
          </div>
        )}

        {!isAnalyzing && !isConverting && isFixed && (
          <span className="pill pill-success text-xs">✓ Fixed</span>
        )}

        {!isAnalyzing && !isConverting && !isFixed && track.status === 'done' && (
          <>
            {errors.slice(0, 2).map(i => (
              <IssueTag key={i.id} issue={i} compact />
            ))}
            {errors.length > 2 && (
              <span className="pill pill-error text-xs">+{errors.length - 2}</span>
            )}
            {errors.length === 0 && warnings.slice(0, 1).map(i => (
              <IssueTag key={i.id} issue={i} compact />
            ))}
            {errors.length === 0 && warnings.length === 0 && (
              <span className="pill pill-success text-xs">✓ Clean</span>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ width: 100 }}
      >
        {isFixed && convertedPath && (
          <button
            onClick={() => onReveal(convertedPath)}
            className="btn btn-ghost text-xs"
            style={{ height: 26, fontSize: 11 }}
            title="Show in Finder"
          >
            Show
          </button>
        )}
        {!isFixed && hasErrors && !isAnalyzing && !isConverting && (
          <button
            onClick={() => onFix(track.id)}
            className="btn btn-primary text-xs"
            style={{ height: 26, fontSize: 11 }}
          >
            Fix
          </button>
        )}
        {!isAnalyzing && (
          <button
            onClick={() => onReveal(track.filePath)}
            className="btn btn-ghost text-xs"
            style={{ height: 26, fontSize: 11 }}
            title="Reveal in Finder"
          >
            ⋯
          </button>
        )}
      </div>
    </div>
  )
})

function TechChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-xs"
      style={{ color: 'var(--muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
    >
      {children}
    </span>
  )
}

export default TrackRow
