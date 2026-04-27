import type { CDJModel } from '@shared/ipc-types'
import { MODEL_LABELS } from '@shared/ipc-types'

const MODELS: CDJModel[] = ['all', 'cdj-3000x', 'cdj-3000', 'cdj-2000nxs2', 'cdj-2000nxs', 'cdj-2000']

const SHORT_LABELS: Record<CDJModel, string> = {
  'cdj-3000x':    '3000X',
  'cdj-3000':     'CDJ-3000',
  'cdj-2000nxs2': 'NXS2',
  'cdj-2000nxs':  'NXS',
  'cdj-2000':     'CDJ-2000',
  'all':          'All CDJs',
}

interface Props {
  value: CDJModel
  onChange: (m: CDJModel) => void
}

export default function PlayerSelector({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {MODELS.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          title={MODEL_LABELS[m]}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all text-xs"
          style={{
            background: value === m ? 'rgba(255,255,255,0.1)' : 'transparent',
            boxShadow: value === m ? '0 0 0 1px rgba(255,255,255,0.15)' : 'none',
            color: value === m ? 'var(--text)' : 'var(--muted)',
            border: 'none',
            cursor: 'pointer',
            fontWeight: value === m ? 600 : 400,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: value === m ? 'var(--text)' : 'transparent', border: value === m ? 'none' : '1px solid rgba(255,255,255,0.2)' }}
          />
          {SHORT_LABELS[m]}
          {m === 'all' && (
            <span className="pill pill-accent ml-auto" style={{ fontSize: 9, padding: '1px 5px' }}>Rec</span>
          )}
        </button>
      ))}
    </div>
  )
}
