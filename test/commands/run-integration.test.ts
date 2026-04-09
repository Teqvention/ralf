import { describe, it, expect, vi } from "vitest"
import { runCommand } from "../../src/commands/run.js"

describe("runCommand integration", () => {
  it("processes multiple issues end-to-end emitting correct UI events in sequence", async () => {
    const issues = [
      { number: 1, title: "Auth feature", body: "Add login" },
      { number: 2, title: "Dashboard", body: "Build dashboard" },
    ]

    const callLog: string[] = []

    const state = {
      getIssuesInOrder: vi.fn().mockResolvedValue(issues),
      acquireLock: vi.fn(async () => { callLog.push("acquireLock") }),
      releaseLock: vi.fn(async () => { callLog.push("releaseLock") }),
      preflight: vi.fn(async () => { callLog.push("preflight"); return [] }),
      markStuck: vi.fn().mockResolvedValue(undefined),
      startIssue: vi.fn(async (issue: { number: number }) => {
        callLog.push(`startIssue:${issue.number}`)
      }),
    }

    const session = {
      continue: vi.fn(async () => {}),
      run: vi.fn(),
      tokens: { input: 0, output: 0 },
      sessionId: "sess-e2e",
    }

    // Issue 1 emits: plan-ready → question → slice-complete → review-verdict → complete
    // Issue 2 emits: slice-complete → complete
    const processor = {
      processIssue: vi.fn(async function* (issue: { number: number }) {
        callLog.push(`processIssue:${issue.number}`)
        if (issue.number === 1) {
          yield { type: "plan-ready" as const, behaviors: [{ name: "user can log in", type: "unit" }] }
          yield { type: "question" as const, questions: [{ id: "q1", text: "Which auth provider?" }] }
          yield { type: "slice-complete" as const, slice: 1, total: 2 }
          yield { type: "review-verdict" as const, verdict: "approved" as const }
          yield { type: "complete" as const, summary: { issue: 1 } }
        } else {
          yield { type: "slice-complete" as const, slice: 1, total: 1 }
          yield { type: "complete" as const, summary: { issue: 2 } }
        }
      }),
    }

    const uiLog: { method: string; type: string }[] = []

    const ui = {
      emit: vi.fn((event: unknown) => {
        uiLog.push({ method: "emit", type: (event as { type: string }).type })
      }),
      prompt: vi.fn((event: unknown) => {
        const e = event as { type: string }
        uiLog.push({ method: "prompt", type: e.type })
        if (e.type === "plan-approval") return "approved"
        if (e.type === "questions") return "Use OAuth2"
        return undefined
      }),
      countdown: vi.fn((event: unknown) => {
        uiLog.push({ method: "countdown", type: (event as { type: string }).type })
      }),
      collapseLastIssue: vi.fn(),
      onInterrupt: vi.fn(),
      removeInterrupt: vi.fn(),
      waitForRateLimit: vi.fn(),
    }

    const config = {
      issueTimeoutMinutes: 0, // disable timeout to keep test synchronous
    }

    await runCommand({
      config,
      state,
      processor,
      ui,
      session,
    })

    // Full lifecycle: preflight → lock → startIssue per issue → process → unlock
    expect(callLog).toEqual([
      "preflight",
      "acquireLock",
      "startIssue:1",
      "processIssue:1",
      "startIssue:2",
      "processIssue:2",
      "releaseLock",
    ])

    // Extract the sequence of UI interactions by type
    expect(uiLog).toEqual([
      // Issue 1: plan-ready → prompt returns "approved", countdown skipped
      { method: "prompt", type: "plan-approval" },
      // Issue 1: question → prompt
      { method: "prompt", type: "questions" },
      // Issue 1: slice-complete → emit
      { method: "emit", type: "slice-complete" },
      // Issue 1: review-verdict → emit
      { method: "emit", type: "review-verdict" },
      // Issue 1: complete → emit
      { method: "emit", type: "complete" },
      // Issue 2: slice-complete → emit
      { method: "emit", type: "slice-complete" },
      // Issue 2: complete → emit
      { method: "emit", type: "complete" },
    ])

    // Question answers were fed back to the agent session
    expect(session.continue).toHaveBeenCalledWith("Use OAuth2")

    // review-verdict emit includes normalized notes field
    const reviewCall = ui.emit.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === "review-verdict",
    )
    expect(reviewCall).toBeDefined()
    expect((reviewCall![0] as { notes: string }).notes).toBe("")
  })
})
