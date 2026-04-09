import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { initCommand } from "../src/commands/init.js"

const PROMPTS_SOURCE_DIR = resolve(import.meta.dirname, "..", "prompts")

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

  it("creates .ralf/RALF.md with placeholder sections", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-init-test-"))

    await initCommand({ projectDir: tempDir })

    const ralfMdPath = join(tempDir, ".ralf", "RALF.md")
    expect(existsSync(ralfMdPath)).toBe(true)

    const content = readFileSync(ralfMdPath, "utf-8")
    // RALF.md should contain placeholder sections for project documentation
    expect(content).toContain("# ")
    expect(content.length).toBeGreaterThan(0)
  })

  it("copies prompt templates from prompts/ into .ralf/prompts/", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-init-test-"))

    await initCommand({ projectDir: tempDir })

    const sourcePrompts = readdirSync(PROMPTS_SOURCE_DIR).filter((f) => f.endsWith(".md"))
    const destPromptsDir = join(tempDir, ".ralf", "prompts")

    expect(existsSync(destPromptsDir)).toBe(true)

    const copiedPrompts = readdirSync(destPromptsDir).filter((f) => f.endsWith(".md"))
    expect(copiedPrompts.sort()).toEqual(sourcePrompts.sort())

    // Verify file contents match the source templates
    for (const promptFile of sourcePrompts) {
      const sourceContent = readFileSync(join(PROMPTS_SOURCE_DIR, promptFile), "utf-8")
      const copiedContent = readFileSync(join(destPromptsDir, promptFile), "utf-8")
      expect(copiedContent).toBe(sourceContent)
    }
  })
})
