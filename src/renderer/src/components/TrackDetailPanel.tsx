import type { TrackAnalysis } from '../../../../shared/ipc-types'
import IssueTag from './IssueTag'

interface Props {
  track: TrackAnalysis
  onClose: () => void
  onFix: (id: string) => void
  convertedPath?: string
  conversionRunning: boolean
}

export default function TrackDetailPanel({ track, onClose, onFix, convertedPath, conversionRunning }: Props) {
  const errors = track.issues.filter(i => i.severity === 'error')
  const warnings = track.issues.filter(i => i.severity === 'warning')
  const allFixable = errors.filter(i => i.canAutoFix).length
  const isFixed = !!convertedPath

  return (
    <div
      className="flex flex-col animate-fade-in"
      style={{
        width: 320,
        flexShrink: 0,
        background: 'var(--surface)',
        boxShadow: '-1px 0 0 var(--border)',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ boxShadow: 'inset 0 -1px 0 var(--border)' }}
      >
        <h3 className="font-cal text-sm text-white">Track Details</h3>
        <button
          onClick={onClose}
          className="btn btn-ghost w-7 h-7 p-0 text-lg"
          style={{ fontSize: 18, color: 'var(--muted)' }}
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-5 p-4">
        {/* File info */}
        <section>
          <SectionLabel>File</SectionLabel>
          <p className="text-sm text-white font-medium break-all leading-snug">{track.fileName}</p>
          <p className="text-xs mt-1 break-all leading-relaxed" style={{ color: 'var(--muted)' }}>
            {track.filePath}
          </p>
        </section>

        {/* Technical info */}
        <section>
          <SectionLabel>Specifications</SectionLabel>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <InfoRow label="Format" value={track.format.toUpperCase()} />
            {track.sampleRate && <InfoRow label="Sample rate" value={`${(track.sampleRate / 1000).toFixed(1)} kHz`} />}
            {track.bitDepth && <InfoRow label="Bit depth" value={`${track.bitDepth}-bit`} />}
            {track.channels && <InfoRow label="Channels" value={track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Stereo' : `${track.channels} ch`} />}
            {track.bitrate && <InfoRow label="Bitrate" value={`${Math.round(track.bitrate / 1000)} kbps`} />}
            {track.codec && <InfoRow label="Codec" value={track.codec} />}
            {track.hasArtwork && <InfoRow label="Artwork" value={track.artworkFormat?.toUpperCase() ?? 'Yes'} warn={track.artworkFormat === 'png'} />}
          </div>
        </section>

        {/* Issues */}
        {errors.length > 0 && (
          <section>
            <SectionLabel>Errors ({errors.length})</SectionLabel>
            <div className="flex flex-col gap-3">
              {errors.map(issue => (
                <div key={issue.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <IssueTag issue={issue} />
                    {issue.isLossless && (
                      <span className="text-xs" style={{ color: 'var(--success)', fontSize: 10 }}>
                        lossless fix
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {issue.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {warnings.length > 0 && (
          <section>
            <SectionLabel>Warnings ({warnings.length})</SectionLabel>
            <div className="flex flex-col gap-3">
              {warnings.map(issue => (
                <div key={issue.id} className="flex flex-col gap-1.5">
                  <IssueTag issue={issue} />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {issue.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Fix button */}
        {isFixed ? (
          <div className="flex flex-col gap-2">
            <div className="pill pill-success text-xs self-start">✓ Fixed</div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Output: <span className="text-white">{convertedPath!.split('/').pop()}</span>
            </p>
            <button
              onClick={() => window.djcheck.revealInFinder(convertedPath!)}
              className="btn btn-dark text-xs w-full"
              style={{ height: 32 }}
            >
              Show in Finder
            </button>
          </div>
        ) : allFixable > 0 ? (
          <button
            onClick={() => onFix(track.id)}
            disabled={conversionRunning}
            className="btn btn-primary w-full text-sm"
            style={{ height: 36 }}
          >
            Fix {allFixable} issue{allFixable !== 1 ? 's' : ''}
          </button>
        ) : null}

        {errors.some(i => !i.canAutoFix) && (
          <div
            className="rounded-lg px-3 py-2.5 text-xs leading-relaxed"
            style={{ background: 'rgba(239,68,68,0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            {errors.filter(i => !i.canAutoFix).map(i => i.description).join(' ')}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-2"
       style={{ color: 'var(--muted)', letterSpacing: '0.07em', fontSize: 10 }}>
      {children}
    </p>
  )
}

function InfoRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: warn ? 'var(--warning)' : 'var(--text)' }}>
        {value}
      </span>
    </>
  )
}
