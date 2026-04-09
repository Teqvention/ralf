import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initCommand } from "../src/commands/init.js"

describe("initCommand", () => {
  let tempDir: string

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("creates .ralf/ directory with config.json from template", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-init-test-"))

    await initCommand({ projectDir: tempDir })

    const configPath = join(tempDir, ".ralf", "config.json")
    expect(existsSync(configPath)).toBe(true)

    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    // Template config should have the required fields with placeholder values
    expect(config).toHaveProperty("repo")
    expect(config).toHaveProperty("projectNumber")
    expect(config).toHaveProperty("checks")
    expect(Array.isArray(config.checks)).toBe(true)
  })
})
