import { describe, it, expect } from "vitest"
import { TokenTracker } from "../src/tokens.js"

describe("TokenTracker", () => {
  it("tracks per-issue usage", () => {
    const tracker = new TokenTracker()
    tracker.startIssue(42)
    tracker.record("plan", 1000, 500)
    tracker.record("red", 800, 300, "login")
    tracker.record("green", 900, 400, "login")

    const usage = tracker.getIssueUsage(42)
    expect(usage.input).toBe(2700)
    expect(usage.output).toBe(1200)
  })

  it("tracks multiple issues separately", () => {
    const tracker = new TokenTracker()
    tracker.startIssue(1)
    tracker.record("plan", 1000, 500)

    tracker.startIssue(2)
    tracker.record("plan", 2000, 800)

    expect(tracker.getIssueUsage(1)).toEqual({ input: 1000, output: 500 })
    expect(tracker.getIssueUsage(2)).toEqual({ input: 2000, output: 800 })
  })

  it("returns zero for unknown issue", () => {
    const tracker = new TokenTracker()
    expect(tracker.getIssueUsage(99)).toEqual({ input: 0, output: 0 })
  })

  it("calculates grand total across issues", () => {
    const tracker = new TokenTracker()
    tracker.startIssue(1)
    tracker.record("plan", 1000, 500)
    tracker.startIssue(2)
    tracker.record("plan", 2000, 800)

    const total = tracker.getGrandTotal()
    expect(total.input).toBe(3000)
    expect(total.output).toBe(1300)
  })

  it("formats issue usage as readable string", () => {
    const tracker = new TokenTracker()
    tracker.startIssue(1)
    tracker.record("plan", 1500, 750)

    const formatted = tracker.formatIssueUsage(1)
    expect(formatted).toContain("1.5k in")
    expect(formatted).toContain("750 out")
  })

  it("formats grand total with M suffix for large numbers", () => {
    const tracker = new TokenTracker()
    tracker.startIssue(1)
    tracker.record("plan", 1_500_000, 500_000)

    const formatted = tracker.formatGrandTotal()
    expect(formatted).toContain("1.5M in")
    expect(formatted).toContain("500.0k out")
  })
})
