import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { validateConfig, loadConfig, defineConfig, ConfigError } from "../src/config.js"

// --- validateConfig ---

describe("validateConfig", () => {
  const minimal = {
    repo: "Teqvention/ralf",
    checks: [{ name: "test", command: "pnpm test" }],
  }

  it("accepts minimal valid config", () => {
    const config = validateConfig(minimal)
    expect(config.repo).toBe("Teqvention/ralf")
    expect(config.checks).toHaveLength(1)
    expect(config.maxIterationsPerIssue).toBe(3) // default
    expect(config.labels.todo).toBe("todo") // default
    expect(config.agents.tdd.runtime).toBe("claude") // default
  })

  it("accepts full config", () => {
    const full = {
      repo: "org/project",
      checks: [
        { name: "typecheck", command: "pnpm typecheck" },
        { name: "lint", command: "pnpm lint" },
        { name: "test", command: "pnpm test" },
      ],
      labels: {
        todo: "backlog",
        inProgress: "wip",
        inReview: "review",
        done: "shipped",
        stuck: "blocked",
      },
      agents: {
        tdd: { runtime: "claude" as const },
        review: { runtime: "codex" as const },
      },
      maxIterationsPerIssue: 5,
    }
    const config = validateConfig(full)
    expect(config.repo).toBe("org/project")
    expect(config.checks).toHaveLength(3)
    expect(config.labels.todo).toBe("backlog")
    expect(config.agents.review.runtime).toBe("codex")
    expect(config.maxIterationsPerIssue).toBe(5)
  })

  it("rejects missing repo", () => {
    expect(() => validateConfig({ checks: [{ name: "t", command: "t" }] }))
      .toThrow(ConfigError)
  })

  it("rejects invalid repo format", () => {
    expect(() => validateConfig({ repo: "invalid", checks: [{ name: "t", command: "t" }] }))
      .toThrow("owner/repo")
  })

  it("rejects empty checks", () => {
    expect(() => validateConfig({ repo: "a/b", checks: [] }))
      .toThrow(ConfigError)
  })

  it("rejects missing checks", () => {
    expect(() => validateConfig({ repo: "a/b" }))
      .toThrow(ConfigError)
  })

  it("rejects maxIterationsPerIssue > 10", () => {
    expect(() => validateConfig({ ...minimal, maxIterationsPerIssue: 99 }))
      .toThrow(ConfigError)
  })

  it("rejects maxIterationsPerIssue < 1", () => {
    expect(() => validateConfig({ ...minimal, maxIterationsPerIssue: 0 }))
      .toThrow(ConfigError)
  })

  it("rejects invalid agent runtime", () => {
    expect(() => validateConfig({
      ...minimal,
      agents: { tdd: { runtime: "gpt" } },
    })).toThrow(ConfigError)
  })

  it("rejects non-integer maxIterationsPerIssue", () => {
    expect(() => validateConfig({ ...minimal, maxIterationsPerIssue: 2.5 }))
      .toThrow(ConfigError)
  })

  it("rejects null input", () => {
    expect(() => validateConfig(null)).toThrow(ConfigError)
  })
})

// --- defineConfig ---

describe("defineConfig", () => {
  it("passes through config object", () => {
    const input = {
      repo: "a/b",
      checks: [{ name: "test", command: "npm test" }],
    }
    expect(defineConfig(input)).toBe(input)
  })
})

// --- loadConfig ---

describe("loadConfig", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralf-config-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("loads valid config from .ralf/config.json", () => {
    const ralfDir = join(tempDir, ".ralf")
    mkdirSync(ralfDir, { recursive: true })
    writeFileSync(join(ralfDir, "config.json"), JSON.stringify({
      repo: "Teqvention/ralf",
      checks: [{ name: "test", command: "vitest run" }],
    }))

    const config = loadConfig(tempDir)
    expect(config.repo).toBe("Teqvention/ralf")
  })

  it("throws when config file missing", () => {
    expect(() => loadConfig(tempDir)).toThrow(ConfigError)
    expect(() => loadConfig(tempDir)).toThrow("not found")
  })

  it("throws on invalid JSON", () => {
    const ralfDir = join(tempDir, ".ralf")
    mkdirSync(ralfDir, { recursive: true })
    writeFileSync(join(ralfDir, "config.json"), "not json{{{")

    expect(() => loadConfig(tempDir)).toThrow(ConfigError)
    expect(() => loadConfig(tempDir)).toThrow("Failed to parse")
  })

  it("throws on invalid config shape", () => {
    const ralfDir = join(tempDir, ".ralf")
    mkdirSync(ralfDir, { recursive: true })
    writeFileSync(join(ralfDir, "config.json"), JSON.stringify({ repo: "bad" }))

    expect(() => loadConfig(tempDir)).toThrow(ConfigError)
  })
})
