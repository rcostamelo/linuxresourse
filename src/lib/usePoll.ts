import { useEffect, useRef, useState } from 'react'

export function usePoll<T>(fn: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let alive = true
    let timer: number
    const tick = async () => {
      try {
        const d = await fnRef.current()
        if (alive) {
          setData(d)
          setError(null)
        }
      } catch (e) {
        if (alive) setError(String((e as Error).message || e))
      }
      if (alive) timer = window.setTimeout(tick, ms)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [ms])

  return { data, error }
}
