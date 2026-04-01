import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadPrompt, hydrate, loadRalfMd } from "../src/prompts.js"

describe("hydrate", () => {
  it("replaces single variable", () => {
    expect(hydrate("Hello {{NAME}}", { NAME: "World" })).toBe("Hello World")
  })

  it("replaces multiple variables", () => {
    const template = "{{A}} and {{B}}"
    expect(hydrate(template, { A: "foo", B: "bar" })).toBe("foo and bar")
  })

  it("replaces all occurrences of the same variable", () => {
    const template = "{{X}} is {{X}}"
    expect(hydrate(template, { X: "42" })).toBe("42 is 42")
  })

  it("leaves unmatched variables as-is", () => {
    expect(hydrate("{{A}} {{B}}", { A: "yes" })).toBe("yes {{B}}")
  })

  it("handles empty vars", () => {
    expect(hydrate("Hello {{NAME}}", {})).toBe("Hello {{NAME}}")
  })

  it("handles empty template", () => {
    expect(hydrate("", { A: "value" })).toBe("")
  })

  it("handles multiline templates", () => {
    const template = "Line 1: {{A}}\nLine 2: {{B}}\nLine 3: {{A}}"
    expect(hydrate(template, { A: "x", B: "y" })).toBe("Line 1: x\nLine 2: y\nLine 3: x")
  })
})

describe("loadPrompt", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("loads from .ralf/prompts/ when available", () => {
    const promptsDir = join(tempDir, ".ralf", "prompts")
    mkdirSync(promptsDir, { recursive: true })
    writeFileSync(join(promptsDir, "plan.md"), "Custom plan: {{ISSUE_TITLE}}")

    const result = loadPrompt("plan", tempDir)
    expect(result).toBe("Custom plan: {{ISSUE_TITLE}}")
  })

  it("falls back to built-in prompts/", () => {
    // No .ralf/prompts/ in tempDir, so it should fall back to built-in
    const result = loadPrompt("plan", tempDir)
    expect(result).toContain("TDD Planning")
    expect(result).toContain("{{ISSUE_TITLE}}")
  })

  it("throws for unknown prompt name", () => {
    expect(() => loadPrompt("nonexistent-prompt-xyz", tempDir)).toThrow("not found")
  })
})

describe("loadRalfMd", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("loads from .ralf/RALF.md when present", () => {
    const ralfDir = join(tempDir, ".ralf")
    mkdirSync(ralfDir, { recursive: true })
    writeFileSync(join(ralfDir, "RALF.md"), "# Project rules")

    expect(loadRalfMd(tempDir)).toBe("# Project rules")
  })

  it("loads from RALF.md in project root when .ralf/ missing", () => {
    writeFileSync(join(tempDir, "RALF.md"), "# Root rules")

    expect(loadRalfMd(tempDir)).toBe("# Root rules")
  })

  it("prefers .ralf/RALF.md over root RALF.md", () => {
    const ralfDir = join(tempDir, ".ralf")
    mkdirSync(ralfDir, { recursive: true })
    writeFileSync(join(ralfDir, "RALF.md"), "inner")
    writeFileSync(join(tempDir, "RALF.md"), "outer")

    expect(loadRalfMd(tempDir)).toBe("inner")
  })

  it("returns empty string when no RALF.md exists", () => {
    expect(loadRalfMd(tempDir)).toBe("")
  })
})
