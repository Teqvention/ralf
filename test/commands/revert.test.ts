import { describe, it, expect, vi } from "vitest"
import { revertCommand } from "../../src/commands/revert.js"

function makeRevertFixtures(overrides?: {
  commits?: { hash: string; message: string }[];
  promptAnswer?: string;
}) {
  const commits = overrides?.commits ?? [
    { hash: "abc123", message: "feat(#42): add login form" },
  ]

  const mockState = {
    findCommitsForIssue: vi.fn().mockResolvedValue(commits),
    revertIssue: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    resetLabel: vi.fn().mockResolvedValue(undefined),
  }

  const mockUI = {
    emit: vi.fn(),
    prompt: vi.fn().mockResolvedValue(overrides?.promptAnswer ?? "confirmed"),
  }

  const config = {
    statuses: {
      todo: "Ready",
    },
  }

  return { mockState, mockUI, config }
}

describe("revertCommand", () => {
  it("prompts for confirmation before executing revert", async () => {
    const { mockState, mockUI, config } = makeRevertFixtures()

    await revertCommand({ config, state: mockState, ui: mockUI, issueNumber: 42 })

    expect(mockUI.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "confirm-revert",
        issueNumber: 42,
      }),
    )

    expect(mockState.revertIssue).toHaveBeenCalledWith(42)
  })

  it("aborts without changes when user declines confirmation", async () => {
    const { mockState, mockUI, config } = makeRevertFixtures({ promptAnswer: "declined" })

    await revertCommand({ config, state: mockState, ui: mockUI, issueNumber: 42 })

    expect(mockUI.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "confirm-revert",
        issueNumber: 42,
      }),
    )

    expect(mockState.revertIssue).not.toHaveBeenCalled()

    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "revert-aborted",
        issueNumber: 42,
      }),
    )
  })

  it("reverts all commits matching feat(#N): pattern, deletes branch, and resets label to todo", async () => {
    const commits = [
      { hash: "abc123", message: "feat(#42): add login form" },
      { hash: "def456", message: "feat(#42): add validation" },
    ]
    const { mockState, mockUI, config } = makeRevertFixtures({ commits })

    await revertCommand({ config, state: mockState, ui: mockUI, issueNumber: 42 })

    expect(mockState.revertIssue).toHaveBeenCalledWith(42)
    expect(mockState.deleteBranch).toHaveBeenCalledWith(42)
    expect(mockState.resetLabel).toHaveBeenCalledWith(42, "Ready")
  })

  it("emits error event when issue has no matching commits", async () => {
    const { mockState, mockUI, config } = makeRevertFixtures({ commits: [] })

    await revertCommand({ config, state: mockState, ui: mockUI, issueNumber: 99 })

    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        issueNumber: 99,
        message: expect.stringContaining("no commits"),
      }),
    )

    expect(mockState.revertIssue).not.toHaveBeenCalled()
    expect(mockState.deleteBranch).not.toHaveBeenCalled()
    expect(mockState.resetLabel).not.toHaveBeenCalled()
  })
})
