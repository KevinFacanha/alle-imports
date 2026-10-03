export const MLB_ABC_REFETCH_INTERVAL_MS = 5 * 60 * 1_000

interface VisibilitySource {
  visibilityState: string
  addEventListener: (type: "visibilitychange", listener: () => void) => void
  removeEventListener: (type: "visibilitychange", listener: () => void) => void
}

interface AutoRefreshOptions {
  refresh: () => void
  visibility: VisibilitySource
  setIntervalFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void
}

export function startMlbAbcAutoRefresh({
  refresh,
  visibility,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: AutoRefreshOptions): () => void {
  const timer = setIntervalFn(refresh, MLB_ABC_REFETCH_INTERVAL_MS)
  const onVisibilityChange = () => {
    if (visibility.visibilityState === "visible") refresh()
  }
  visibility.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    clearIntervalFn(timer)
    visibility.removeEventListener("visibilitychange", onVisibilityChange)
  }
}
