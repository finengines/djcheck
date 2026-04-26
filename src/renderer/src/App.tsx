import { useEffect } from 'react'
import { useStore } from './store'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'

export default function App() {
  const { settingsLoaded, showOnboarding, loadSettings } = useStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  if (!settingsLoaded) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg)' }}>
        <div className="animate-spin w-6 h-6 rounded-full border-2 border-white/10 border-t-white/60" />
      </div>
    )
  }

  if (showOnboarding) return <Onboarding />
  return <Home />
}
