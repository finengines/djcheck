import { useCallback } from 'react'
import { useStore, useFilteredTracks } from '../store'
import TrackRow from './TrackRow'
import TrackDetailPanel from './TrackDetailPanel'
import { useState } from 'react'
import type { TrackAnalysis } from '../../../../shared/ipc-types'

export default function TrackList() {
  const {
    selectedIds,
    toggleSelect,
    startConversion,
    conversionProgress,
    convertedPaths,
    conversionRunning,
  } = useStore()

  const tracks = useFilteredTracks()
  const [detailTrack, setDetailTrack] = useState<TrackAnalysis | null>(null)

  const handleFix = useCallback((id: string) => {
    useStore.getState().toggleSelect(id)
    // Small delay to let selection update before conversion starts
    setTimeout(() => useStore.getState().startConversion([id]), 10)
  }, [])

  const handleReveal = useCallback((path: string) => {
    window.djcheck.revealInFinder(path)
  }, [])

  const handleRowClick = useCallback((track: TrackAnalysis) => {
    if (track.issues.length > 0) {
      setDetailTrack(prev => prev?.id === track.id ? null : track)
    }
  }, [])

  if (tracks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No tracks match this filter.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Track list */}
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto">
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 flex-shrink-0"
          style={{
            height: 32,
            boxShadow: 'inset 0 -1px 0 var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ width: 16 }} />
          <div style={{ width: 36 }} />
          <span className="flex-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--muted)', fontSize: 10, letterSpacing: '0.06em' }}>
            Track
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider flex-shrink-0"
                style={{ color: 'var(--muted)', fontSize: 10, letterSpacing: '0.06em', width: 200, textAlign: 'right' }}>
            Issues
          </span>
          <div style={{ width: 100 }} />
        </div>

        {/* Rows */}
        {tracks.map(track => (
          <div
            key={track.id}
            onClick={() => handleRowClick(track)}
            style={{ cursor: track.issues.length > 0 ? 'pointer' : 'default' }}
          >
            <TrackRow
              track={track}
              isSelected={selectedIds.has(track.id)}
              conversionProgress={conversionProgress.get(track.id)}
              convertedPath={convertedPaths.get(track.id)}
              onToggleSelect={(id) => { toggleSelect(id) }}
              onFix={handleFix}
              onReveal={handleReveal}
            />
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {detailTrack && (
        <TrackDetailPanel
          track={detailTrack}
          onClose={() => setDetailTrack(null)}
          onFix={(id) => {
            handleFix(id)
            setDetailTrack(null)
          }}
          convertedPath={convertedPaths.get(detailTrack.id)}
          conversionRunning={conversionRunning}
        />
      )}
    </div>
  )
}
