import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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

  it("succeeds with --force when lock exists and owning process is alive", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-lock-test-"))
    const ralfDir = join(tempDir, ".ralf")
    mkdirSync(ralfDir, { recursive: true })

    // Write a lock file owned by the current process (definitely alive)
    const lockPath = join(ralfDir, ".lock")
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      timestamp: new Date().toISOString(),
    }))

    // Without force, this would throw — but force overrides the active lock
    await acquireLock({ projectDir: tempDir, force: true })

    const lockContent = JSON.parse(readFileSync(lockPath, "utf-8"))
    expect(lockContent.pid).toBe(process.pid)
    expect(typeof lockContent.timestamp).toBe("string")
  })

  it("throws descriptive error when lock exists and owning process is alive", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-lock-test-"))
    const ralfDir = join(tempDir, ".ralf")
    mkdirSync(ralfDir, { recursive: true })

    // Write a lock file owned by the current process (which is definitely alive)
    const lockPath = join(ralfDir, ".lock")
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      timestamp: new Date().toISOString(),
    }))

    const error = await acquireLock({ projectDir: tempDir }).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/lock/i)
    expect((error as Error).message).toMatch(String(process.pid))
  })
})
