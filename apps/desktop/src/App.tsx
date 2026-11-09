import { useStore } from './store'
import { StartScreen } from './screens/StartScreen'
import { Wizard } from './screens/Wizard'
import { Workspace } from './Workspace'

export default function App() {
  const screen = useStore((s) => s.screen)
  const toast = useStore((s) => s.toast)
  return (
    <>
      {screen === 'start' && <StartScreen />}
      {screen === 'wizard' && <Wizard />}
      {screen === 'workspace' && <Workspace />}
      {toast && (
        <div key={toast.key} className={`toast ${toast.kind === 'err' ? 'err' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </>
  )
}
