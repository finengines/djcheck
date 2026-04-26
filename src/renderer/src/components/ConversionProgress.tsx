import { useStore } from '../store'

export default function ConversionProgress() {
  const { conversionProgress, conversionRunning, cancelConversion, tracks } = useStore()

  const progressEntries = [...conversionProgress.entries()]
  const currentEntry = progressEntries.find(([, p]) => p.percent < 100 && p.stage !== 'done')
  const doneCount = progressEntries.filter(([, p]) => p.percent >= 100 || p.stage === 'done').length
  const totalCount = progressEntries.length

  const currentTrack = currentEntry ? tracks.get(currentEntry[0]) : null
  const currentProgress = currentEntry ? currentEntry[1] : null

  const overallPercent = totalCount > 0
    ? Math.round((doneCount / totalCount) * 100)
    : 0

  const stageLabel = currentProgress?.stage === 'preparing' ? 'Preparing…'
    : currentProgress?.stage === 'converting' ? 'Converting…'
    : currentProgress?.stage === 'writing-tags' ? 'Writing tags…'
    : 'Processing…'

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 flex-shrink-0 animate-fade-in"
      style={{
        background: 'var(--surface)',
        boxShadow: '0 -1px 0 var(--border)',
      }}
    >
      {/* Progress info */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white">
            {currentTrack ? currentTrack.fileName : stageLabel}
          </span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {doneCount}/{totalCount} tracks
          </span>
        </div>
        <div className="progress-bar w-full">
          <div className="progress-bar-fill" style={{ width: `${overallPercent}%` }} />
        </div>
      </div>

      {/* Current track progress */}
      {currentProgress && (
        <div className="flex-shrink-0 text-xs font-semibold tabular-nums" style={{ color: 'var(--muted)' }}>
          {currentProgress.percent}%
        </div>
      )}

      {/* Cancel */}
      {conversionRunning && (
        <button
          onClick={cancelConversion}
          className="btn btn-ghost text-xs flex-shrink-0"
          style={{ height: 28 }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
