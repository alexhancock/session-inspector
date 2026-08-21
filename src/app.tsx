import { useCallback, useState } from 'react'
import { Session, UnknownSessionError, parseSessionText, readSessionFile } from './session'
import { Landing, Demo } from './ui/landing'
import { Inspector } from './ui/inspector'
import gooseText from '../example-sessions/goose-threejs-earth-session.json?raw'
import claudeText from '../example-sessions/claude-code-threejs-earth-session.jsonl?raw'

const DEMOS: Demo[] = [
  {
    id: 'claude-code',
    agent: 'Claude Code',
    name: 'Spinning earth',
    fileName: 'claude-code-threejs-earth-session.jsonl',
    text: claudeText,
  },
  {
    id: 'goose',
    agent: 'goose',
    name: 'ThreeJS earth',
    fileName: 'goose-threejs-earth-session.json',
    text: gooseText,
  },
]

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const guard = useCallback((run: () => Session) => {
    try {
      setSession(run())
      setError(null)
    } catch (e) {
      setError(
        e instanceof UnknownSessionError
          ? e.message
          : `That file could not be read: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setBusy(false)
    }
  }, [])

  const onFiles = useCallback(
    async (files: File[]) => {
      const file = files[0]
      if (!file) return
      setBusy(true)
      try {
        const parsed = await readSessionFile(file)
        setSession(parsed)
        setError(null)
      } catch (e) {
        setError(
          e instanceof UnknownSessionError
            ? e.message
            : `That file could not be read: ${e instanceof Error ? e.message : String(e)}`,
        )
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  if (session) return <Inspector session={session} onReset={() => setSession(null)} />

  return (
    <Landing
      demos={DEMOS}
      error={error}
      busy={busy}
      onFiles={onFiles}
      onDemo={(d) => guard(() => parseSessionText(d.text, d.fileName))}
    />
  )
}
