import { describe, it, expect, vi } from "vitest"
import { revertCommand } from "../../src/commands/revert.js"

describe("revertCommand", () => {
  it("aborts without changes when user declines confirmation", async () => {
    const mockState = {
      findCommitsForIssue: vi.fn().mockResolvedValue([
        { hash: "abc123", message: "feat(#42): add login form" },
      ]),
      revertIssue: vi.fn().mockResolvedValue(undefined),
    }

    const mockUI = {
      emit: vi.fn(),
      prompt: vi.fn().mockResolvedValue("declined"),
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

    // Should still prompt for confirmation
    expect(mockUI.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "confirm-revert",
        issueNumber: 42,
      }),
    )

    // User declined — revert must NOT be executed
    expect(mockState.revertIssue).not.toHaveBeenCalled()

    // Should emit an abort event so the UI can inform the user
    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "revert-aborted",
        issueNumber: 42,
      }),
    )
  })
})
