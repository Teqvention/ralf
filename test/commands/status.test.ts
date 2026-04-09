import { describe, it, expect, vi } from "vitest"
import { statusCommand } from "../../src/commands/status.js"

describe("statusCommand", () => {
  it("fetches issue counts and emits status event with counts per label", async () => {
    const counts: Record<string, number> = {
      "Ready": 3,
      "In Progress": 2,
      "In Review": 1,
      "Done": 5,
      "Stuck": 0,
    }

    const mockState = {
      getStatusCounts: vi.fn().mockResolvedValue(counts),
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
      statuses: {
        todo: "Ready",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        stuck: "Stuck",
      },
    }

    await statusCommand({ config, state: mockState, ui: mockUI })

    expect(mockState.getStatusCounts).toHaveBeenCalled()
    expect(mockUI.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        counts,
      }),
    )
  })
})
