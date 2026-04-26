import { useStore, useFilteredTracks, useTrackStats } from '../store'
import type { FilterMode } from '../store'

const FILTERS: { id: FilterMode; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'issues',    label: 'Issues' },
  { id: 'clean',     label: 'Clean' },
  { id: 'converted', label: 'Fixed' },
]

export default function Toolbar() {
  const {
    filterMode, setFilterMode,
    searchQuery, setSearchQuery,
    selectedIds, selectAll, selectIssued, deselectAll,
    startConversion, analysisRunning,
    clearTracks, tracks,
    conversionRunning,
  } = useStore()

  const filtered = useFilteredTracks()
  const stats = useTrackStats()

  const hasSelected = selectedIds.size > 0
  const selectedWithIssues = [...selectedIds].filter(id => {
    const t = tracks.get(id)
    return t && t.issues.some(i => i.severity === 'error')
  }).length

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
      style={{
        height: 52,
        boxShadow: '0 1px 0 var(--border)',
        background: 'var(--bg)',
      }}
    >
      {/* Search */}
      <div className="relative flex-shrink-0" style={{ width: 220 }}>
        <SearchIcon />
        <input
          type="text"
          placeholder="Search tracks…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-3 text-sm rounded-lg outline-none"
          style={{
            height: 32,
            background: 'var(--surface)',
            color: 'var(--text)',
            boxShadow: 'var(--shadow-sm)',
            border: 'none',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0 }}
          >
            ×
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-1">
        {FILTERS.map(f => {
          const count = f.id === 'all' ? stats.total
            : f.id === 'issues' ? stats.issues
            : f.id === 'clean' ? stats.clean
            : stats.converted
          if (f.id === 'converted' && stats.converted === 0) return null
          return (
            <button
              key={f.id}
              onClick={() => setFilterMode(f.id)}
              className="pill transition-all"
              style={{
                background: filterMode === f.id ? 'rgba(255,255,255,0.12)' : 'var(--surface)',
                color: filterMode === f.id ? 'var(--text)' : 'var(--muted)',
                boxShadow: filterMode === f.id ? '0 0 0 1px rgba(255,255,255,0.12)' : 'var(--shadow-sm)',
                cursor: 'pointer',
                border: 'none',
                fontWeight: filterMode === f.id ? 600 : 400,
                padding: '3px 10px',
              }}
            >
              {f.label}
              <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 2 }}>{count}</span>
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Selection controls */}
      {hasSelected ? (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {selectedIds.size} selected
          </span>
          <button onClick={deselectAll} className="btn btn-ghost text-xs" style={{ height: 28 }}>
            Deselect
          </button>
          {selectedWithIssues > 0 && (
            <button
              onClick={() => startConversion()}
              disabled={conversionRunning}
              className="btn btn-primary text-xs"
              style={{ height: 28 }}
            >
              Fix {selectedWithIssues} track{selectedWithIssues !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {stats.issues > 0 && (
            <>
              <button onClick={selectIssued} className="btn btn-ghost text-xs" style={{ height: 28 }}>
                Select issues
              </button>
              <button
                onClick={() => { selectIssued(); setTimeout(() => startConversion(), 50) }}
                disabled={conversionRunning || analysisRunning}
                className="btn btn-primary text-xs"
                style={{ height: 28 }}
              >
                Fix all issues ({stats.issues})
              </button>
            </>
          )}
          <button onClick={clearTracks} className="btn btn-ghost text-xs" style={{ height: 28 }}>
            Clear
          </button>
        </div>
      )}

      {/* Add more */}
      <button
        onClick={async () => {
          const paths = await window.djcheck.pickAudioFiles()
          if (paths.length > 0) useStore.getState().startAnalysis(paths)
        }}
        disabled={analysisRunning}
        className="btn btn-dark text-xs"
        style={{ height: 28 }}
      >
        + Add files
      </button>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
      width="13" height="13" viewBox="0 0 16 16" fill="none"
      style={{ color: 'var(--muted)' }}
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
