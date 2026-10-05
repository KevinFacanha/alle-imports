import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  formatAbcCurrency,
  formatAbcPercentage,
  formatSignedAbcPercentage,
} from "./mlb-sales-abc-format.js"

describe("MLB ABC formatting", () => {
  it("formats BRL values and invalid inputs", () => {
    assert.equal(formatAbcCurrency("5000"), "R$ 5.000,00")
    assert.equal(formatAbcCurrency("-2000.5"), "-R$ 2.000,50")
    assert.equal(formatAbcCurrency("invalid"), "—")
  })

  it("formats percentages with two pt-BR decimal places and an explicit positive sign", () => {
    assert.equal(formatAbcPercentage(59.375), "59,38%")
    assert.equal(formatSignedAbcPercentage(59.375), "+59,38%")
    assert.equal(formatSignedAbcPercentage(-40), "-40,00%")
    assert.equal(formatSignedAbcPercentage(null), "—")
  })
})
