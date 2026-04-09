import { describe, it, expect, vi, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runCommand } from "../../src/commands/run.js"
import { createProjectState } from "../../src/project-state/index.js"

describe("runCommand lock lifecycle (e2e)", () => {
  let tempDir: string

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("acquires lock before processing and releases lock in finally block even on error", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-run-lock-e2e-"))
    mkdirSync(join(tempDir, ".ralf"), { recursive: true })

    const lockPath = join(tempDir, ".ralf", ".lock")

    const state = createProjectState({ projectDir: tempDir })

    // Override getIssuesInOrder to return one issue
    state.getIssuesInOrder = async () => [
      { number: 1, title: "Broken", body: "Fails during processing" },
    ]

    // Override preflight/startIssue/markStuck as no-ops
    state.preflight = async () => []
    state.startIssue = async () => {}
    state.markStuck = async () => {}

    let lockExistedDuringProcessing = false

    const processor = {
      processIssue: vi.fn(async function* () {
        // Verify lock file exists while processing
        lockExistedDuringProcessing = existsSync(lockPath)
        throw new Error("unexpected crash during processing")
      }),
    }

    const ui = {
      emit: vi.fn(),
      prompt: vi.fn(),
      countdown: vi.fn(),
      collapseLastIssue: vi.fn(),
      onInterrupt: vi.fn(),
      removeInterrupt: vi.fn(),
      waitForRateLimit: vi.fn(),
    }

    const config = { issueTimeoutMinutes: 0 }

    await expect(
      runCommand({ config, state, processor, ui }),
    ).rejects.toThrow("unexpected crash during processing")

    // Lock file existed while processing was active
    expect(lockExistedDuringProcessing).toBe(true)

    // Lock file was cleaned up despite the error (finally block)
    expect(existsSync(lockPath)).toBe(false)
  })
})
