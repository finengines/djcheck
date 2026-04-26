import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { immer } from 'zustand/middleware/immer'
import type {
  TrackAnalysis,
  CDJModel,
  ConversionProgress,
  OutputFormat,
  AppSettings,
  ConversionOptions,
} from '@shared/ipc-types'

export type FilterMode = 'all' | 'issues' | 'clean' | 'converted'

export interface ConversionCompletePayload {
  results: Array<{ trackId: string; success: boolean; outputPath?: string; error?: string }>
  rekordbox: {
    updatedCount: number
    outputXmlPath: string | null
    hotCueWarnings: string[]
    error?: string
  } | null
}

interface AppState {
  // Settings
  settings: AppSettings
  settingsLoaded: boolean
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>

  // Onboarding
  showOnboarding: boolean
  completeOnboarding: (model: CDJModel) => Promise<void>

  // Analysis
  tracks: Map<string, TrackAnalysis>
  analysisRunning: boolean
  analysisTotal: number
  analysisDone: number
  filterMode: FilterMode
  searchQuery: string
  selectedIds: Set<string>

  startAnalysis: (filePaths: string[]) => void
  cancelAnalysis: () => void
  clearTracks: () => void
  addPendingTrack: (trackId: string) => void
  updateTrack: (result: TrackAnalysis) => void
  finishAnalysis: () => void
  setFilterMode: (mode: FilterMode) => void
  setSearchQuery: (q: string) => void
  toggleSelect: (id: string) => void
  selectAll: () => void
  selectIssued: () => void
  deselectAll: () => void

  // Conversion
  conversionRunning: boolean
  conversionProgress: Map<string, ConversionProgress>
  conversionComplete: ConversionCompletePayload | null
  convertedPaths: Map<string, string> // trackId → output path

  startConversion: (trackIds?: string[]) => void
  cancelConversion: () => void
  updateConversionProgress: (progress: ConversionProgress) => void
  handleConversionResult: (result: { trackId: string; success: boolean; outputPath?: string; error?: string }) => void
  handleConversionComplete: (payload: ConversionCompletePayload) => void
  dismissConversionResult: () => void

  // Output / Rekordbox
  outputFolder: string | null
  rekordboxXmlPath: string | null
  setOutputFolder: (p: string | null) => void
  setRekordboxXmlPath: (p: string | null) => void

  // Drag state
  isDragOver: boolean
  setDragOver: (v: boolean) => void
}

export const useStore = create<AppState>()(
  immer((set, get) => ({
    // ─── Settings ─────────────────────────────────────────────────────────────
    settings: {
      targetModel: 'cdj-2000nxs2',
      outputFormat: 'aiff-24',
      outputMode: 'folder',
      outputFolder: null,
      onboardingComplete: false,
      applyDither: true,
    },
    settingsLoaded: false,
    loadSettings: async () => {
      const s = await window.djcheck.getSettings()
      set(state => {
        state.settings = s
        state.settingsLoaded = true
        state.showOnboarding = !s.onboardingComplete
      })
    },
    updateSettings: async (patch) => {
      const updated = await window.djcheck.setSettings(patch)
      set(state => { state.settings = updated })
    },

    // ─── Onboarding ───────────────────────────────────────────────────────────
    showOnboarding: false,
    completeOnboarding: async (model) => {
      await get().updateSettings({ targetModel: model, onboardingComplete: true })
      set(state => { state.showOnboarding = false })
    },

    // ─── Analysis ─────────────────────────────────────────────────────────────
    tracks: new Map(),
    analysisRunning: false,
    analysisTotal: 0,
    analysisDone: 0,
    filterMode: 'all',
    searchQuery: '',
    selectedIds: new Set(),

    startAnalysis: (filePaths) => {
      set(state => {
        state.analysisRunning = true
        state.analysisTotal = filePaths.length
        state.analysisDone = 0
      })

      const unsubs: Array<() => void> = []

      unsubs.push(window.djcheck.onAnalysisProgress((trackId) => {
        get().addPendingTrack(trackId)
      }))

      unsubs.push(window.djcheck.onAnalysisResult((result) => {
        get().updateTrack(result)
        set(state => { state.analysisDone++ })
      }))

      unsubs.push(window.djcheck.onAnalysisComplete(() => {
        get().finishAnalysis()
        unsubs.forEach(u => u())
      }))

      window.djcheck.analyzeFiles({
        filePaths,
        targetModel: get().settings.targetModel,
      })
    },

    cancelAnalysis: () => {
      window.djcheck.cancelAnalysis()
      set(state => { state.analysisRunning = false })
    },

    clearTracks: () => {
      set(state => {
        state.tracks = new Map()
        state.selectedIds = new Set()
        state.analysisDone = 0
        state.analysisTotal = 0
        state.conversionComplete = null
      })
    },

    addPendingTrack: (trackId) => {
      set(state => {
        state.tracks.set(trackId, {
          id: trackId, filePath: '', fileName: 'Analysing…', fileSize: 0,
          format: 'unknown', sampleRate: null, bitDepth: null, channels: null,
          bitrate: null, duration: null, codec: null, issues: [], status: 'analyzing',
        })
      })
    },

    updateTrack: (result) => {
      set(state => { state.tracks.set(result.id, result) })
    },

    finishAnalysis: () => {
      set(state => { state.analysisRunning = false })
    },

    setFilterMode: (mode) => set(state => { state.filterMode = mode }),
    setSearchQuery: (q) => set(state => { state.searchQuery = q }),

    toggleSelect: (id) => set(state => {
      if (state.selectedIds.has(id)) state.selectedIds.delete(id)
      else state.selectedIds.add(id)
    }),
    selectAll: () => set(state => {
      state.selectedIds = new Set(state.tracks.keys())
    }),
    selectIssued: () => set(state => {
      state.selectedIds = new Set(
        [...state.tracks.values()]
          .filter(t => t.issues.some(i => i.severity === 'error'))
          .map(t => t.id)
      )
    }),
    deselectAll: () => set(state => { state.selectedIds = new Set() }),

    // ─── Conversion ───────────────────────────────────────────────────────────
    conversionRunning: false,
    conversionProgress: new Map(),
    conversionComplete: null,
    convertedPaths: new Map(),

    startConversion: (trackIds) => {
      const state = get()
      const ids = trackIds ?? [...state.selectedIds]
      if (ids.length === 0) return

      const tracks = ids
        .map(id => state.tracks.get(id))
        .filter(Boolean)
        .filter(t => t!.issues.length > 0) as TrackAnalysis[]

      if (tracks.length === 0) return

      const options: ConversionOptions = {
        outputFormat: state.settings.outputFormat as OutputFormat,
        outputMode: state.settings.outputMode,
        outputFolder: state.outputFolder ?? undefined,
        rekordboxXmlPath: state.rekordboxXmlPath ?? undefined,
        applyDither: state.settings.applyDither,
      }

      set(s => {
        s.conversionRunning = true
        s.conversionProgress = new Map()
        s.conversionComplete = null
      })

      const unsubs: Array<() => void> = []

      unsubs.push(window.djcheck.onConversionProgress((progress) => {
        get().updateConversionProgress(progress)
      }))

      unsubs.push(window.djcheck.onConversionResult((result) => {
        get().handleConversionResult(result)
      }))

      unsubs.push(window.djcheck.onConversionComplete((payload) => {
        get().handleConversionComplete(payload as ConversionCompletePayload)
        unsubs.forEach(u => u())
      }))

      window.djcheck.convertTracks({
        tracks: tracks.map(t => ({ trackId: t.id, filePath: t.filePath, issues: t.issues })),
        targetModel: state.settings.targetModel,
        options,
      })
    },

    cancelConversion: () => {
      window.djcheck.cancelConversion()
      set(state => { state.conversionRunning = false })
    },

    updateConversionProgress: (progress) => {
      set(state => { state.conversionProgress.set(progress.trackId, progress) })
    },

    handleConversionResult: (result) => {
      set(state => {
        if (result.outputPath) {
          state.convertedPaths.set(result.trackId, result.outputPath)
        }
      })
    },

    handleConversionComplete: (payload) => {
      set(state => {
        state.conversionRunning = false
        state.conversionComplete = payload
      })
    },

    dismissConversionResult: () => {
      set(state => { state.conversionComplete = null })
    },

    // ─── Output / Rekordbox ───────────────────────────────────────────────────
    outputFolder: null,
    rekordboxXmlPath: null,
    setOutputFolder: (p) => set(state => { state.outputFolder = p }),
    setRekordboxXmlPath: (p) => set(state => { state.rekordboxXmlPath = p }),

    // ─── Drag ─────────────────────────────────────────────────────────────────
    isDragOver: false,
    setDragOver: (v) => set(state => { state.isDragOver = v }),
  }))
)

// Derived selectors
export function useFilteredTracks(): TrackAnalysis[] {
  // useShallow does a shallow-equality check so a new array with the same items
  // (same references, same order) won't trigger a re-render.
  return useStore(
    useShallow((state) => {
      const { tracks, filterMode, searchQuery, convertedPaths } = state
      let result = [...tracks.values()].filter(t => t.status === 'done' || t.status === 'analyzing')

      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        result = result.filter(t =>
          t.fileName.toLowerCase().includes(q) ||
          t.filePath.toLowerCase().includes(q)
        )
      }

      switch (filterMode) {
        case 'issues':
          return result.filter(t => t.issues.some(i => i.severity === 'error'))
        case 'clean':
          return result.filter(t => t.issues.filter(i => i.severity === 'error').length === 0 && t.status === 'done')
        case 'converted':
          return result.filter(t => convertedPaths.has(t.id))
        default:
          return result
      }
    })
  )
}

export function useTrackStats() {
  // useShallow does a shallow key/value comparison on the returned object so
  // identical numbers don't cause a re-render even though the object is new.
  return useStore(
    useShallow((state) => {
      const all = [...state.tracks.values()].filter(t => t.status === 'done')
      const issues = all.filter(t => t.issues.some(i => i.severity === 'error'))
      const clean = all.filter(t => t.issues.filter(i => i.severity === 'error').length === 0)
      const converted = [...state.convertedPaths.keys()].length
      return { total: all.length, issues: issues.length, clean: clean.length, converted }
    })
  )
}
