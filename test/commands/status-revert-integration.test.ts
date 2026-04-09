import { describe, it, expect, vi } from "vitest"
import { statusCommand } from "../../src/commands/status.js"
import { revertCommand } from "../../src/commands/revert.js"

describe("status and revert commands with shared mock state", () => {
  it("status shows counts, then revert reverts an issue and status reflects the change", async () => {
    // Shared mutable counts simulate real project state
    const counts: Record<string, number> = {
      "Ready": 3,
      "In Progress": 1,
      "In Review": 0,
      "Done": 5,
      "Stuck": 0,
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

    const eventLog: { command: string; event: { type: string } }[] = []

    // --- Phase 1: statusCommand shows initial counts ---

    const statusState = {
      getStatusCounts: vi.fn(async () => ({ ...counts })),
    }

    const statusUI = {
      emit: vi.fn((event: unknown) => {
        eventLog.push({ command: "status", event: event as { type: string } })
      }),
    }

    await statusCommand({ config, state: statusState, ui: statusUI })

    // Status emitted with all labels including zero-count ones
    expect(statusUI.emit).toHaveBeenCalledWith({
      type: "status",
      counts: {
        "Ready": 3,
        "In Progress": 1,
        "In Review": 0,
        "Done": 5,
        "Stuck": 0,
      },
    })

    // --- Phase 2: revertCommand reverts issue #7 ---

    const commits = [
      { hash: "aaa111", message: "feat(#7): add trending endpoint" },
      { hash: "bbb222", message: "feat(#7): add trending tests" },
    ]

    const revertState = {
      findCommitsForIssue: vi.fn().mockResolvedValue(commits),
      revertIssue: vi.fn(async () => {
        // Simulate state change: issue moves from Done back to Ready
        counts["Done"] -= 1
        counts["Ready"] += 1
      }),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      resetLabel: vi.fn().mockResolvedValue(undefined),
    }

    const revertUI = {
      emit: vi.fn((event: unknown) => {
        eventLog.push({ command: "revert", event: event as { type: string } })
      }),
      prompt: vi.fn().mockResolvedValue("confirmed"),
    }

    await revertCommand({ config, state: revertState, ui: revertUI, issueNumber: 7 })

    // Revert executed the full sequence: revert → delete branch → reset label
    expect(revertState.revertIssue).toHaveBeenCalledWith(7)
    expect(revertState.deleteBranch).toHaveBeenCalledWith(7)
    expect(revertState.resetLabel).toHaveBeenCalledWith(7, "Ready")

    // User was prompted for confirmation
    expect(revertUI.prompt).toHaveBeenCalledWith({ type: "confirm-revert", issueNumber: 7 })

    // --- Phase 3: statusCommand reflects the updated counts ---

    const statusState2 = {
      getStatusCounts: vi.fn(async () => ({ ...counts })),
    }

    const statusUI2 = {
      emit: vi.fn((event: unknown) => {
        eventLog.push({ command: "status", event: event as { type: string } })
      }),
    }

    await statusCommand({ config, state: statusState2, ui: statusUI2 })

    // Counts now reflect the revert: Done decreased, Ready increased
    expect(statusUI2.emit).toHaveBeenCalledWith({
      type: "status",
      counts: {
        "Ready": 4,
        "In Progress": 1,
        "In Review": 0,
        "Done": 4,
        "Stuck": 0,
      },
    })

    // Full event sequence across all three phases
    const eventTypes = eventLog.map(e => `${e.command}:${e.event.type}`)
    expect(eventTypes).toEqual([
      "status:status",
      "revert:revert-complete",  // revert emits completion event with summary
      "status:status",
    ])
  })
})
