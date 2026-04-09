import { describe, it, expect, vi } from "vitest"
import { cli } from "../src/cli.js"

describe("cli", () => {
  it("routes 'run <number>' to runCommand with parsed issue number", async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined)

    await cli({
      argv: ["run", "42"],
      commands: {
        run: runCommand,
        status: vi.fn(),
        revert: vi.fn(),
        init: vi.fn(),
      },
    })

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 42 }),
    )
  })

  it("routes 'status' to statusCommand", async () => {
    const statusCommand = vi.fn().mockResolvedValue(undefined)

    await cli({
      argv: ["status"],
      commands: {
        run: vi.fn(),
        status: statusCommand,
        revert: vi.fn(),
        init: vi.fn(),
      },
    })

    expect(statusCommand).toHaveBeenCalledOnce()
  })

  it("routes 'revert <number>' to revertCommand with parsed issue number", async () => {
    const revertCommand = vi.fn().mockResolvedValue(undefined)

    await cli({
      argv: ["revert", "17"],
      commands: {
        run: vi.fn(),
        status: vi.fn(),
        revert: revertCommand,
        init: vi.fn(),
      },
    })

    expect(revertCommand).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 17 }),
    )
  })
})
