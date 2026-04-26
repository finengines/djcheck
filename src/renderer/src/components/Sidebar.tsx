import { useState } from 'react'
import { useStore, useTrackStats } from '../store'
import PlayerSelector from './PlayerSelector'
import type { CDJModel, OutputFormat } from '@shared/ipc-types'

const OUTPUT_FORMATS: { id: OutputFormat; label: string; sublabel: string }[] = [
  { id: 'aiff-24', label: 'AIFF 24-bit', sublabel: 'Lossless · Full metadata · Universal' },
  { id: 'aiff-16', label: 'AIFF 16-bit', sublabel: 'Lossless · Dithered · Widest compat.' },
  { id: 'wav-24',  label: 'WAV 24-bit',  sublabel: 'Lossless · No CDJ artwork display' },
  { id: 'wav-16',  label: 'WAV 16-bit',  sublabel: 'Lossless · Dithered · Universal' },
  { id: 'mp3-320', label: 'MP3 320kbps', sublabel: 'Lossy · Smallest · ID3v2.3 tags' },
]

export default function Sidebar() {
  const { settings, updateSettings, rekordboxXmlPath, setRekordboxXmlPath } = useStore()
  const stats = useTrackStats()
  const [showFormatInfo, setShowFormatInfo] = useState(false)

  const pickXml = async () => {
    const xml = await window.djcheck.pickRekordboxXml()
    if (xml) setRekordboxXmlPath(xml)
  }

  return (
    <div
      className="flex flex-col flex-shrink-0 py-4 px-3 gap-5"
      style={{
        width: 240,
        background: 'var(--surface)',
        boxShadow: '1px 0 0 var(--border)',
        overflowY: 'auto',
      }}
    >
      {/* CDJ Model */}
      <section>
        <SectionLabel>CDJ Target</SectionLabel>
        <PlayerSelector
          value={settings.targetModel}
          onChange={(m: CDJModel) => updateSettings({ targetModel: m })}
        />
      </section>

      {/* Stats */}
      {stats.total > 0 && (
        <section>
          <SectionLabel>Library</SectionLabel>
          <div className="flex flex-col gap-1">
            <StatRow label="Total" value={stats.total} />
            <StatRow label="Issues" value={stats.issues} color="var(--error)" />
            <StatRow label="Clean" value={stats.clean} color="var(--success)" />
            {stats.converted > 0 && <StatRow label="Fixed" value={stats.converted} color="var(--accent)" />}
          </div>
        </section>
      )}

      {/* Output format */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionLabel>Output Format</SectionLabel>
          <button
            onClick={() => setShowFormatInfo(!showFormatInfo)}
            className="text-xs"
            style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {showFormatInfo ? 'hide' : "what's best?"}
          </button>
        </div>

        {showFormatInfo && (
          <div
            className="text-xs rounded-lg p-3 mb-3 leading-relaxed animate-fade-in"
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
          >
            <strong style={{ color: 'var(--text)' }}>AIFF 24-bit</strong> is recommended — lossless, supports metadata &amp; artwork, plays on every CDJ back to CDJ-900. MP3 sources always stay as MP3 regardless of this setting.
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {OUTPUT_FORMATS.map(f => (
            <button
              key={f.id}
              onClick={() => updateSettings({ outputFormat: f.id })}
              className="flex flex-col gap-0.5 px-3 py-2 rounded-lg text-left transition-all"
              style={{
                background: settings.outputFormat === f.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                boxShadow: settings.outputFormat === f.id ? '0 0 0 1px rgba(255,255,255,0.12)' : 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <span className="text-xs font-medium text-white">{f.label}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{f.sublabel}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Dithering toggle */}
      {(settings.outputFormat === 'aiff-16' || settings.outputFormat === 'wav-16') && (
        <section className="animate-fade-in">
          <SectionLabel>Dithering</SectionLabel>
          <div
            className="text-xs rounded-lg p-3 leading-relaxed"
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
          >
            TPDF dithering is applied when reducing to 16-bit. Masks quantization noise with inaudible broadband noise — better than truncation.
          </div>
        </section>
      )}

      {/* Rekordbox XML */}
      <section>
        <SectionLabel>rekordbox.xml</SectionLabel>
        <button
          onClick={pickXml}
          className="w-full btn btn-dark text-xs rounded-lg justify-start gap-2"
          style={{ height: 32 }}
        >
          <XmlIcon />
          <span className="truncate" style={{ color: rekordboxXmlPath ? 'var(--accent)' : 'var(--muted)' }}>
            {rekordboxXmlPath ? rekordboxXmlPath.split('/').pop() : 'Import XML…'}
          </span>
        </button>
        {rekordboxXmlPath && (
          <>
            <p className="mt-1.5 text-xs px-1 leading-relaxed" style={{ color: 'var(--muted)' }}>
              Hot cues &amp; loops will be preserved after conversion.
            </p>
            <button
              onClick={() => setRekordboxXmlPath(null)}
              className="mt-1 text-xs w-full text-center"
              style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Remove
            </button>
          </>
        )}
        {!rekordboxXmlPath && (
          <p className="mt-1.5 text-xs px-1 leading-relaxed" style={{ color: 'var(--muted)' }}>
            Optional. Preserves hot cues &amp; loops when files are converted.
          </p>
        )}
      </section>

      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div className="text-xs text-center" style={{ color: 'var(--muted)', opacity: 0.5 }}>
        DJCheck v0.1.0
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-2 px-1"
       style={{ color: 'var(--muted)', letterSpacing: '0.08em', fontSize: 10 }}>
      {children}
    </p>
  )
}

function StatRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-xs font-semibold tabular-nums" style={{ color: color ?? 'var(--text)' }}>
        {value}
      </span>
    </div>
  )
}

function XmlIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M5 6l2 2-2 2M8.5 10h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
