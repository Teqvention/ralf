import { describe, it, expect, vi } from "vitest"
import { revertCommand } from "../../src/commands/revert.js"

describe("revertCommand", () => {
  it("prompts for confirmation before executing revert", async () => {
    const mockState = {
      findCommitsForIssue: vi.fn().mockResolvedValue([
        { hash: "abc123", message: "feat(#42): add login form" },
      ]),
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

    // Must prompt for confirmation before doing any revert
    expect(mockUI.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "confirm-revert",
        issueNumber: 42,
      }),
    )

    // Confirmation was given, so revert should proceed
    expect(mockState.revertIssue).toHaveBeenCalledWith(42)
  })
})
