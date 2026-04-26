import { useStore } from '../store'

export default function ConversionSummary() {
  const { conversionComplete, dismissConversionResult } = useStore()
  if (!conversionComplete) return null

  const succeeded = conversionComplete.results.filter(r => r.success).length
  const failed = conversionComplete.results.filter(r => !r.success).length
  const rekordbox = conversionComplete.rekordbox

  return (
    <div
      className="flex flex-col gap-2 px-4 py-3 flex-shrink-0 animate-fade-in"
      style={{
        background: 'var(--surface)',
        boxShadow: '0 -1px 0 var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-cal text-sm text-white">Conversion complete</span>
            {succeeded > 0 && (
              <span className="pill pill-success text-xs">✓ {succeeded} fixed</span>
            )}
            {failed > 0 && (
              <span className="pill pill-error text-xs">✗ {failed} failed</span>
            )}
          </div>

          {rekordbox && rekordbox.updatedCount > 0 && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              rekordbox.xml updated — {rekordbox.updatedCount} track path{rekordbox.updatedCount !== 1 ? 's' : ''} updated.{' '}
              <span style={{ color: 'var(--text)' }}>Import <code>rekordbox_djcheck.xml</code> into rekordbox.</span>
            </p>
          )}

          {rekordbox?.hotCueWarnings && rekordbox.hotCueWarnings.length > 0 && (
            <div className="flex flex-col gap-0.5 mt-1">
              {rekordbox.hotCueWarnings.map((w, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--warning)' }}>⚠ {w}</p>
              ))}
            </div>
          )}

          {failed > 0 && (
            <div className="flex flex-col gap-0.5 mt-1">
              {conversionComplete.results.filter(r => !r.success).map((r, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--error)' }}>
                  ✗ {r.error}
                </p>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={dismissConversionResult}
          className="btn btn-ghost text-xs flex-shrink-0"
          style={{ height: 28 }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
