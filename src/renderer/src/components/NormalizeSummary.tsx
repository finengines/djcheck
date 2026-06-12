import { useStore } from '../store'

function formatLufs(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

function formatGain(db: number): string {
  if (db > 0) return `+${db.toFixed(1)} dB`
  if (db < 0) return `${db.toFixed(1)} dB`
  return '0 dB'
}

export default function NormalizeSummary() {
  const { normalizeComplete, dismissNormalizeResult } = useStore()
  if (!normalizeComplete) return null

  const succeeded = normalizeComplete.results.filter(r => r.success).length
  const failed = normalizeComplete.results.filter(r => !r.success).length
  const withLoudness = normalizeComplete.results.filter(r => r.success && r.loudness)
  const normalized = withLoudness.filter(r => r.loudness && !r.loudness.skipped)
  const skipped = withLoudness.filter(r => r.loudness && r.loudness.skipped)

  const avgGain = normalized.length > 0
    ? normalized.reduce((sum, r) => sum + (r.loudness?.gainDb ?? 0), 0) / normalized.length
    : 0
  const avgInputLufs = normalized.length > 0
    ? normalized.reduce((sum, r) => sum + (r.loudness?.inputLufs ?? 0), 0) / normalized.length
    : 0

  return (
    <div
      className="flex flex-col gap-2 px-4 py-3 flex-shrink-0 animate-fade-in"
      style={{
        background: 'var(--surface)',
        boxShadow: '0 -1px 0 var(--border)',
        maxHeight: '40vh',
        overflowY: 'auto',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-cal text-sm text-white">Normalization complete</span>
            {succeeded > 0 && (
              <span className="pill pill-success text-xs">✓ {succeeded} done</span>
            )}
            {failed > 0 && (
              <span className="pill pill-error text-xs">✗ {failed} failed</span>
            )}
          </div>

          {/* Summary stats */}
          <div className="flex gap-4 mt-1">
            <div>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>Normalized</span>
              <p className="text-sm font-medium text-white">{normalized.length}</p>
            </div>
            {normalized.length > 0 && (
              <>
                <div>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Avg input</span>
                  <p className="text-sm font-medium text-white">{formatLufs(avgInputLufs)} LUFS</p>
                </div>
                <div>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Avg gain</span>
                  <p className="text-sm font-medium" style={{ color: avgGain >= 0 ? 'var(--accent)' : 'var(--warning)' }}>
                    {formatGain(avgGain)}
                  </p>
                </div>
              </>
            )}
            {skipped.length > 0 && (
              <div>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>Already at target</span>
                <p className="text-sm font-medium text-white">{skipped.length}</p>
              </div>
            )}
          </div>

          {failed > 0 && (
            <div className="flex flex-col gap-0.5 mt-1">
              {normalizeComplete.results.filter(r => !r.success).map((r, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--error)' }}>
                  ✗ {r.filePath.split('/').pop()}: {r.error}
                </p>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={dismissNormalizeResult}
          className="btn btn-ghost text-xs flex-shrink-0"
          style={{ height: 28 }}
        >
          Dismiss
        </button>
      </div>

      {/* Per-track details */}
      {withLoudness.length > 0 && (
        <details open className="text-xs">
          <summary className="cursor-pointer" style={{ color: 'var(--muted)' }}>
            Per-track loudness details
          </summary>
          <div className="mt-2 flex flex-col gap-1" style={{ maxHeight: 150, overflowY: 'auto' }}>
            {withLoudness.map((r, i) => {
              const l = r.loudness!
              const fileName = r.filePath.split('/').pop() || r.filePath
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 px-2 py-1 rounded"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <span className="flex-1 truncate text-white" style={{ minWidth: 0 }}>
                    {fileName}
                  </span>
                  <span style={{ color: 'var(--muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {formatLufs(l.inputLufs)} → {formatLufs(l.outputLufs)} LUFS
                  </span>
                  <span
                    style={{
                      color: l.gainDb >= 0 ? 'var(--accent)' : 'var(--warning)',
                      flexShrink: 0,
                      fontVariantNumeric: 'tabular-nums',
                      width: 64,
                      textAlign: 'right',
                    }}
                  >
                    {l.skipped ? '— skipped' : formatGain(l.gainDb)}
                  </span>
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}
