import { describe, it, expect, vi } from "vitest"
import { runCommand } from "../src/commands/run.js"

describe("runCommand timeout", () => {
  it("marks issue stuck when processIssue exceeds timeout", async () => {
    const issue = { number: 1, title: "Test issue", body: "body" }

    const stuckCalls: { issue: typeof issue; reason: string }[] = []

    const state = {
      getIssuesInOrder: async () => [issue],
      acquireLock: async () => {},
      releaseLock: vi.fn(async () => {}),
      preflight: async () => [],
      markStuck: async (i: typeof issue, reason: string) => {
        stuckCalls.push({ issue: i, reason })
      },
      startIssue: async () => {},
    }

    // Generator that never completes — simulates a hung issue
    const processor = {
      async *processIssue() {
        await new Promise(() => {}) // never resolves
      },
    }

    const emitted: unknown[] = []
    const ui = {
      emit: (event: unknown) => emitted.push(event),
      prompt: () => {},
      countdown: () => {},
      collapseLastIssue: () => {},
      onInterrupt: () => {},
      removeInterrupt: () => {},
      waitForRateLimit: () => {},
    }

    vi.useFakeTimers()

    const timeoutMinutes = 2
    const done = runCommand({
      config: { issueTimeoutMinutes: timeoutMinutes },
      state,
      processor,
      ui,
    })

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(timeoutMinutes * 60 * 1000 + 1)

    await done

    expect(stuckCalls).toHaveLength(1)
    expect(stuckCalls[0].issue).toBe(issue)
    expect(stuckCalls[0].reason).toMatch(/timeout/i)
    expect(state.releaseLock).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
