import { describe, it, expect, vi } from "vitest"
import { runCommand } from "../../src/commands/run.js"

describe("runCommand", () => {
  it("processes each issue from ProjectState through IssueProcessor in order", async () => {
    const issues = [
      { number: 1, title: "First issue", body: "body 1" },
      { number: 2, title: "Second issue", body: "body 2" },
      { number: 3, title: "Third issue", body: "body 3" },
    ]

    const processedIssues: { number: number; title: string }[] = []

    const mockProjectState = {
      getIssuesInOrder: vi.fn().mockResolvedValue(issues),
      acquireLock: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      preflight: vi.fn().mockResolvedValue([]),
      markStuck: vi.fn().mockResolvedValue(undefined),
      startIssue: vi.fn().mockResolvedValue(undefined),
    }

    const mockProcessor = {
      processIssue: vi.fn(async function* (issue: { number: number; title: string }) {
        processedIssues.push({ number: issue.number, title: issue.title })
        yield { type: "complete" as const, summary: { issue: issue.number } }
      }),
    }

    const mockUI = {
      emit: vi.fn(),
      prompt: vi.fn(),
      countdown: vi.fn(),
      collapseLastIssue: vi.fn(),
      onInterrupt: vi.fn(),
      removeInterrupt: vi.fn(),
      waitForRateLimit: vi.fn(),
    }

    const config = {
      repo: "org/repo",
      projectNumber: 1,
      checks: [{ name: "test", command: "pnpm test" }],
      statuses: {
        todo: "Ready",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        stuck: "Stuck",
      },
      agents: { tdd: { runtime: "mock" as const }, review: { runtime: "mock" as const } },
      maxIterationsPerIssue: 3,
      issueTimeoutMinutes: 30,
    }

    await runCommand({
      config,
      state: mockProjectState,
      processor: mockProcessor,
      ui: mockUI,
    })

    expect(mockProjectState.getIssuesInOrder).toHaveBeenCalled()
    expect(mockProcessor.processIssue).toHaveBeenCalledTimes(3)

    // Verify issues were processed in the order returned by ProjectState
    expect(processedIssues).toEqual([
      { number: 1, title: "First issue" },
      { number: 2, title: "Second issue" },
      { number: 3, title: "Third issue" },
    ])
  })

  it("maps plan-ready event to plan-approval prompt and auto-approves on countdown expiry", async () => {
    const issues = [{ number: 10, title: "Plan issue", body: "body" }]
    const behaviors = [{ name: "user can log in", type: "unit" as const }]

    const mockProjectState = {
      getIssuesInOrder: vi.fn().mockResolvedValue(issues),
      acquireLock: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      preflight: vi.fn().mockResolvedValue([]),
      markStuck: vi.fn().mockResolvedValue(undefined),
      startIssue: vi.fn().mockResolvedValue(undefined),
    }

    const mockProcessor = {
      processIssue: vi.fn(async function* () {
        yield { type: "plan-ready" as const, behaviors }
        yield { type: "complete" as const, summary: { issue: 10 } }
      }),
    }

    const mockUI = {
      emit: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      countdown: vi.fn().mockResolvedValue("expired"),
      collapseLastIssue: vi.fn(),
      onInterrupt: vi.fn(),
      removeInterrupt: vi.fn(),
      waitForRateLimit: vi.fn(),
    }

    const config = {
      repo: "org/repo",
      projectNumber: 1,
      checks: [{ name: "test", command: "pnpm test" }],
      statuses: {
        todo: "Ready",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        stuck: "Stuck",
      },
      agents: { tdd: { runtime: "mock" as const }, review: { runtime: "mock" as const } },
      maxIterationsPerIssue: 3,
      issueTimeoutMinutes: 30,
    }

    await runCommand({
      config,
      state: mockProjectState,
      processor: mockProcessor,
      ui: mockUI,
    })

    // plan-ready event should trigger a plan-approval prompt, not just an emit
    expect(mockUI.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "plan-approval", behaviors })
    )

    // countdown should be called for the auto-approve timer
    expect(mockUI.countdown).toHaveBeenCalled()

    // Processing should continue after auto-approve (complete event emitted)
    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete" })
    )
  })

  it("maps review-verdict and slice-complete events to TerminalUI.emit calls", async () => {
    const issues = [{ number: 7, title: "Slice issue", body: "body" }]

    const mockProjectState = {
      getIssuesInOrder: vi.fn().mockResolvedValue(issues),
      acquireLock: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      preflight: vi.fn().mockResolvedValue([]),
      markStuck: vi.fn().mockResolvedValue(undefined),
      startIssue: vi.fn().mockResolvedValue(undefined),
    }

    const mockProcessor = {
      processIssue: vi.fn(async function* () {
        yield { type: "slice-complete" as const, slice: 2, total: 3 }
        yield { type: "review-verdict" as const, verdict: "approved" as const }
        yield { type: "complete" as const, summary: { issue: 7 } }
      }),
    }

    const mockUI = {
      emit: vi.fn(),
      prompt: vi.fn(),
      countdown: vi.fn(),
      collapseLastIssue: vi.fn(),
      onInterrupt: vi.fn(),
      removeInterrupt: vi.fn(),
      waitForRateLimit: vi.fn(),
    }

    const config = {
      repo: "org/repo",
      projectNumber: 1,
      checks: [{ name: "test", command: "pnpm test" }],
      statuses: {
        todo: "Ready",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        stuck: "Stuck",
      },
      agents: { tdd: { runtime: "mock" as const }, review: { runtime: "mock" as const } },
      maxIterationsPerIssue: 3,
      issueTimeoutMinutes: 30,
    }

    await runCommand({
      config,
      state: mockProjectState,
      processor: mockProcessor,
      ui: mockUI,
    })

    // slice-complete should be emitted with slice progress data
    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "slice-complete", slice: 2, total: 3 })
    )

    // review-verdict should be emitted as a UIEvent with notes field (mapped from IssueEvent)
    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "review-verdict", verdict: "approved", notes: expect.any(String) })
    )

    // These events should NOT trigger prompt (they are fire-and-forget)
    const promptTypes = mockUI.prompt.mock.calls.map((call: unknown[]) => (call[0] as { type: string }).type)
    expect(promptTypes).not.toContain("slice-complete")
    expect(promptTypes).not.toContain("review-verdict")
  })

  it("maps question event to TerminalUI questions prompt and feeds answers back via AgentSession.continue", async () => {
    const issues = [{ number: 5, title: "Question issue", body: "body" }]
    const questions = [
      { id: "q1", text: "Which database adapter?" },
      { id: "q2", text: "Should we add caching?" },
    ]
    const userAnswers = "Use PostgreSQL adapter. Yes, add Redis caching."

    const mockProjectState = {
      getIssuesInOrder: vi.fn().mockResolvedValue(issues),
      acquireLock: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      preflight: vi.fn().mockResolvedValue([]),
      markStuck: vi.fn().mockResolvedValue(undefined),
      startIssue: vi.fn().mockResolvedValue(undefined),
    }

    const mockSession = {
      run: vi.fn().mockResolvedValue({ result: null, questions: null, raw: "", tokensIn: 0, tokensOut: 0, duration: 0 }),
      continue: vi.fn().mockResolvedValue({ result: null, questions: null, raw: "", tokensIn: 0, tokensOut: 0, duration: 0 }),
      tokens: { input: 0, output: 0 },
      sessionId: "sess-123",
    }

    const mockProcessor = {
      processIssue: vi.fn(async function* () {
        yield { type: "question" as const, questions }
        yield { type: "complete" as const, summary: { issue: 5 } }
      }),
    }

    const mockUI = {
      emit: vi.fn(),
      prompt: vi.fn().mockResolvedValue(userAnswers),
      countdown: vi.fn(),
      collapseLastIssue: vi.fn(),
      onInterrupt: vi.fn(),
      removeInterrupt: vi.fn(),
      waitForRateLimit: vi.fn(),
    }

    const config = {
      repo: "org/repo",
      projectNumber: 1,
      checks: [{ name: "test", command: "pnpm test" }],
      statuses: {
        todo: "Ready",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        stuck: "Stuck",
      },
      agents: { tdd: { runtime: "mock" as const }, review: { runtime: "mock" as const } },
      maxIterationsPerIssue: 3,
      issueTimeoutMinutes: 30,
    }

    await runCommand({
      config,
      state: mockProjectState,
      processor: mockProcessor,
      session: mockSession,
      ui: mockUI,
    })

    // question event should trigger a questions prompt to the user
    expect(mockUI.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "questions", questions })
    )

    // user's answers should be fed back to the agent session via continue
    expect(mockSession.continue).toHaveBeenCalledWith(userAnswers)
  })
})
