import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadPrompt, hydrate, parseFrontmatter, loadRalfMd } from "../src/prompts.js"

describe("parseFrontmatter", () => {
  it("extracts requires from YAML frontmatter", () => {
    const raw = "---\nrequires: [A, B, C]\n---\nBody here"
    const { requires, body } = parseFrontmatter(raw)
    expect(requires).toEqual(["A", "B", "C"])
    expect(body).toBe("Body here")
  })

  it("returns empty requires when no frontmatter", () => {
    const { requires, body } = parseFrontmatter("Just a body")
    expect(requires).toEqual([])
    expect(body).toBe("Just a body")
  })

  it("returns empty requires when frontmatter has no requires field", () => {
    const raw = "---\ntitle: test\n---\nBody"
    const { requires, body } = parseFrontmatter(raw)
    expect(requires).toEqual([])
    expect(body).toBe("Body")
  })
})

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

  it("handles empty vars on template without frontmatter", () => {
    expect(hydrate("Hello {{NAME}}", {})).toBe("Hello {{NAME}}")
  })

  it("handles empty template", () => {
    expect(hydrate("", { A: "value" })).toBe("")
  })

  it("handles multiline templates", () => {
    const template = "Line 1: {{A}}\nLine 2: {{B}}\nLine 3: {{A}}"
    expect(hydrate(template, { A: "x", B: "y" })).toBe("Line 1: x\nLine 2: y\nLine 3: x")
  })

  it("strips frontmatter from output", () => {
    const template = "---\nrequires: [NAME]\n---\nHello {{NAME}}"
    expect(hydrate(template, { NAME: "World" })).toBe("Hello World")
  })

  it("throws when required variable is missing", () => {
    const template = "---\nrequires: [A, B]\n---\n{{A}} {{B}}"
    expect(() => hydrate(template, { A: "yes" })).toThrow("Missing required prompt variables: B")
  })

  it("throws listing all missing variables", () => {
    const template = "---\nrequires: [X, Y, Z]\n---\ncontent"
    expect(() => hydrate(template, {})).toThrow("Missing required prompt variables: X, Y, Z")
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

describe("prompt contract", () => {
  const PROMPT_NAMES = ["plan", "red", "green", "green-fix", "review"]

  for (const name of PROMPT_NAMES) {
    it(`${name}.md — frontmatter requires matches {{VAR}} usage`, () => {
      const raw = loadPrompt(name, "nonexistent-dir-to-force-builtin")
      const { requires, body } = parseFrontmatter(raw)
      const usedVars = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
      const uniqueUsed = [...new Set(usedVars)]

      // Every declared var should appear in the body
      for (const req of requires) {
        expect(uniqueUsed, `${name}.md declares {{${req}}} in requires but never uses it`).toContain(req)
      }

      // Every used var should be declared in requires
      for (const used of uniqueUsed) {
        expect(requires, `${name}.md uses {{${used}}} but doesn't declare it in requires`).toContain(used)
      }
    })
  }
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
