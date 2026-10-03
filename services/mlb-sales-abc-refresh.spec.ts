import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  MLB_ABC_REFETCH_INTERVAL_MS,
  startMlbAbcAutoRefresh,
} from "./mlb-sales-abc-refresh.js"

describe("startMlbAbcAutoRefresh", () => {
  it("refetches periodically and when the tab becomes visible, without a reload", () => {
    let refreshes = 0
    let intervalCallback: (() => void) | undefined
    let intervalDelay = 0
    let visibilityCallback: (() => void) | undefined
    let cleared = false
    const visibility = {
      visibilityState: "hidden",
      addEventListener: (_type: "visibilitychange", listener: () => void) => {
        visibilityCallback = listener
      },
      removeEventListener: (_type: "visibilitychange", listener: () => void) => {
        if (visibilityCallback === listener) visibilityCallback = undefined
      },
    }

    const cleanup = startMlbAbcAutoRefresh({
      refresh: () => {
        refreshes += 1
      },
      visibility,
      setIntervalFn: (callback, delay) => {
        intervalCallback = callback
        intervalDelay = delay
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearIntervalFn: () => {
        cleared = true
      },
    })

    assert.equal(intervalDelay, MLB_ABC_REFETCH_INTERVAL_MS)
    intervalCallback?.()
    visibilityCallback?.()
    assert.equal(refreshes, 1)

    visibility.visibilityState = "visible"
    visibilityCallback?.()
    assert.equal(refreshes, 2)

    cleanup()
    assert.equal(cleared, true)
    assert.equal(visibilityCallback, undefined)
  })
})
