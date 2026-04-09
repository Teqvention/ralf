import { describe, it, expect, vi } from "vitest"
import { revertCommand } from "../../src/commands/revert.js"

describe("revertCommand", () => {
  it("reverts all commits matching feat(#N): pattern, deletes branch, and resets label to todo", async () => {
    const commits = [
      { hash: "abc123", message: "feat(#42): add login form" },
      { hash: "def456", message: "feat(#42): add validation" },
    ]

    const mockState = {
      findCommitsForIssue: vi.fn().mockResolvedValue(commits),
      revertIssue: vi.fn().mockResolvedValue(undefined),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      resetLabel: vi.fn().mockResolvedValue(undefined),
    }

    const mockUI = {
      emit: vi.fn(),
      prompt: vi.fn().mockResolvedValue("confirmed"),
      countdown: vi.fn(),
      collapseLastIssue: vi.fn(),
      onInterrupt: vi.fn(),
      removeInterrupt: vi.fn(),
      waitForRateLimit: vi.fn(),
    }

    const config = {
      repo: "org/repo",
      projectNumber: 1,
      statuses: {
        todo: "Ready",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        stuck: "Stuck",
      },
    }

    await revertCommand({ config, state: mockState, ui: mockUI, issueNumber: 42 })

    // All matching commits should be reverted
    expect(mockState.revertIssue).toHaveBeenCalledWith(42)

    // Branch for the issue should be deleted
    expect(mockState.deleteBranch).toHaveBeenCalledWith(42)

    // Label should be reset back to todo status
    expect(mockState.resetLabel).toHaveBeenCalledWith(42, "Ready")
  })
})
