import { useCallback, useEffect, useRef, useState } from 'react'
import { Session, UnknownSessionError, parseSessionText, readSessionFile } from './session/session'
import { Landing, Demo } from './ui/landing'
import { Inspector } from './ui/inspector'
import gooseText from '../example-sessions/goose-threejs-earth-session.json?raw'
import claudeText from '../example-sessions/claude-code-threejs-earth-session.jsonl?raw'

const DEMOS: Demo[] = [
  { id: 'claude-code', agent: 'Claude Code', fileName: 'claude-code-threejs-earth-session.jsonl', text: claudeText },
  { id: 'goose', agent: 'goose', fileName: 'goose-threejs-earth-session.json', text: gooseText },
]

const INSPECTING = { inspecting: true }

const inspecting = () => (window.history.state as { inspecting?: boolean } | null)?.inspecting === true

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const opened = useRef<Session | null>(null)

  useEffect(() => {
    const onPop = () => setSession(inspecting() ? opened.current : null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const show = useCallback((next: Session) => {
    opened.current = next
    setSession(next)
    setError(null)
    if (inspecting()) window.history.replaceState(INSPECTING, '')
    else window.history.pushState(INSPECTING, '')
  }, [])

  const fail = useCallback((e: unknown) => {
    setError(
      e instanceof UnknownSessionError
        ? e.message
        : `That file could not be read: ${e instanceof Error ? e.message : String(e)}`,
    )
  }, [])

  const onFiles = useCallback(
    async (files: File[]) => {
      const file = files[0]
      if (!file) return
      setBusy(true)
      try {
        show(await readSessionFile(file))
      } catch (e) {
        fail(e)
      } finally {
        setBusy(false)
      }
    },
    [show, fail],
  )

  const onDemo = useCallback(
    (demo: Demo) => {
      try {
        show(parseSessionText(demo.text, demo.fileName))
      } catch (e) {
        fail(e)
      }
    },
    [show, fail],
  )

  const onReset = useCallback(() => {
    if (inspecting()) window.history.back()
    else setSession(null)
  }, [])

  if (session) return <Inspector session={session} onReset={onReset} />

  return <Landing demos={DEMOS} error={error} busy={busy} onFiles={onFiles} onDemo={onDemo} />
}
