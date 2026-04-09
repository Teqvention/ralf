import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { acquireLock } from "../src/project-state/index.js"

describe("acquireLock", () => {
  let tempDir: string

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("creates .ralf/.lock file with PID and timestamp", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-lock-test-"))
    mkdirSync(join(tempDir, ".ralf"), { recursive: true })

    await acquireLock({ projectDir: tempDir })

    const lockPath = join(tempDir, ".ralf", ".lock")
    const lockContent = JSON.parse(readFileSync(lockPath, "utf-8"))

    expect(lockContent.pid).toBe(process.pid)
    expect(typeof lockContent.timestamp).toBe("string")
    expect(new Date(lockContent.timestamp).getTime()).not.toBeNaN()
  })
})
