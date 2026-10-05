import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { noSaleStaleBanner } from "./no-sale-data-coverage.js"

describe("noSaleStaleBanner", () => {
  it("shows the history cutoff and stale days when order data is stale", () => {
    assert.deepEqual(
      noSaleStaleBanner(
        {
          dataThrough: "2026-10-03T15:00:00.000Z",
          isDataCurrent: false,
          staleDays: 2,
        },
        () => "03/10/2026",
      ),
      {
        title: "Dados de pedidos até 03/10/2026",
        detail: "2 dias de defasagem",
      },
    )
  })

  it("does not show a stale warning for current data", () => {
    assert.equal(
      noSaleStaleBanner(
        {
          dataThrough: "2026-10-05T15:00:00.000Z",
          isDataCurrent: true,
          staleDays: 0,
        },
        () => "05/10/2026",
      ),
      null,
    )
  })
})
