import { useState } from 'react'
import { useStore } from '../store'
import type { CDJModel } from '../../../../shared/ipc-types'
import { MODEL_LABELS, MODEL_DESCRIPTIONS } from '../../../../shared/ipc-types'

const MODELS: { id: CDJModel; year: string; badge?: string }[] = [
  { id: 'cdj-3000',     year: '2020–present', badge: 'Latest' },
  { id: 'cdj-2000nxs2', year: '2017–present', badge: 'Most common' },
  { id: 'cdj-2000nxs',  year: '2014–2017' },
  { id: 'cdj-2000',     year: '2009–2014' },
  { id: 'all',          year: 'All models',   badge: 'Safest' },
]

export default function Onboarding() {
  const [selected, setSelected] = useState<CDJModel>('cdj-2000nxs2')
  const { completeOnboarding } = useStore()

  return (
    <div
      className="flex flex-col items-center justify-center h-full px-8 animate-fade-in"
      style={{ background: 'var(--bg)' }}
    >
      {/* Logo */}
      <div className="mb-12 text-center">
        <h1 className="font-cal text-5xl text-white tracking-tight mb-3">DJCheck</h1>
        <p className="text-base" style={{ color: 'var(--muted)' }}>
          Local CDJ audio compatibility checker — fast, private, open-source.
        </p>
      </div>

      {/* Question */}
      <div className="mb-8 text-center">
        <h2 className="font-cal text-2xl text-white mb-2">Which CDJ do you play on?</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          This sets which checks to run. You can change it at any time.
        </p>
      </div>

      {/* Model cards */}
      <div className="flex flex-col gap-3 w-full max-w-md mb-10">
        {MODELS.map(m => (
          <button
            key={m.id}
            onClick={() => setSelected(m.id)}
            className="flex items-center gap-4 px-5 py-4 rounded-xl text-left transition-all duration-150"
            style={{
              background: selected === m.id ? 'rgba(255,255,255,0.08)' : 'var(--surface)',
              boxShadow: selected === m.id
                ? '0 0 0 1.5px rgba(255,255,255,0.25), var(--shadow-md)'
                : 'var(--shadow-sm)',
              transform: selected === m.id ? 'scale(1.01)' : 'scale(1)',
            }}
          >
            {/* Radio dot */}
            <div
              className="flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center"
              style={{
                borderColor: selected === m.id ? '#fff' : 'rgba(255,255,255,0.25)',
                background: selected === m.id ? '#fff' : 'transparent',
              }}
            >
              {selected === m.id && (
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--bg)' }} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-medium text-white text-sm">{MODEL_LABELS[m.id]}</span>
                {m.badge && (
                  <span className="pill pill-accent text-xs">{m.badge}</span>
                )}
              </div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {m.year} · {MODEL_DESCRIPTIONS[m.id]}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => completeOnboarding(selected)}
        className="btn btn-primary px-8 h-11 text-sm font-semibold rounded-lg"
      >
        Get started →
      </button>

      <p className="mt-6 text-xs" style={{ color: 'var(--muted)' }}>
        100% local — your tracks never leave your machine
      </p>
    </div>
  )
}
