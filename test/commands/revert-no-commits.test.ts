import { describe, it, expect, vi } from "vitest"
import { revertCommand } from "../../src/commands/revert.js"

describe("revertCommand", () => {
  it("emits error event when issue has no matching commits", async () => {
    const mockState = {
      findCommitsForIssue: vi.fn().mockResolvedValue([]),
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

    await revertCommand({ config, state: mockState, ui: mockUI, issueNumber: 99 })

    // Should emit an error event indicating no commits were found
    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        issueNumber: 99,
        message: expect.stringContaining("no commits"),
      }),
    )

    // Should NOT attempt to revert, delete branch, or reset label
    expect(mockState.revertIssue).not.toHaveBeenCalled()
    expect(mockState.deleteBranch).not.toHaveBeenCalled()
    expect(mockState.resetLabel).not.toHaveBeenCalled()
  })
})
