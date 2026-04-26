export default function TitleBar() {
  return (
    <div
      className="titlebar-drag flex items-center justify-between px-4 flex-shrink-0"
      style={{ height: 40, background: 'var(--bg)' }}
    >
      <div className="titlebar-no-drag flex items-center gap-2" style={{ marginLeft: 72 }}>
        <span
          className="font-cal text-sm tracking-tight"
          style={{ color: 'var(--muted)', letterSpacing: '0.01em' }}
        >
          DJCheck
        </span>
      </div>
      <div className="titlebar-no-drag" />
    </div>
  )
}
