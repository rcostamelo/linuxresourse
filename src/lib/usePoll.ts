import { useEffect, useRef, useState } from 'react'

// Deduplica requisições concorrentes para a mesma função de API no mesmo ciclo
const inflightMap = new WeakMap<() => Promise<unknown>, Promise<unknown>>()

function callDedup<T>(fn: () => Promise<T>): Promise<T> {
  const existing = inflightMap.get(fn) as Promise<T> | undefined
  if (existing) return existing
  const p = fn().finally(() => {
    inflightMap.delete(fn)
  })
  inflightMap.set(fn, p)
  return p
}

export function usePoll<T>(fn: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let alive = true
    let timer: number
    const scheduleNext = () => {
      if (!alive) return
      // Alinha os timers de mesma cadência (ex: 2000ms) para dispararem juntos,
      // evitando múltiplos re-renders espaçados a cada ciclo de telemetria.
      const delay = ms >= 1000 && ms <= 10000 ? ms - (Date.now() % ms) + 20 : ms
      timer = window.setTimeout(tick, Math.max(250, delay))
    }
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        scheduleNext()
        return
      }
      try {
        const d = await callDedup(fnRef.current)
        if (alive) {
          setData(d)
          setError(null)
        }
      } catch (e) {
        if (alive) setError(String((e as Error).message || e))
      }
      scheduleNext()
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [ms])

  return { data, error }
}
