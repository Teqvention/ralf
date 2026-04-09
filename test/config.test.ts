import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { validateConfig, loadConfig, defineConfig, ConfigError } from "../src/config.js"

// --- validateConfig ---

describe("validateConfig", () => {
  const minimal = {
    repo: "Teqvention/ralf",
    projectNumber: 1,
    checks: [{ name: "test", command: "pnpm test" }],
  }

  it("accepts minimal valid config", () => {
    const config = validateConfig(minimal)
    expect(config.repo).toBe("Teqvention/ralf")
    expect(config.projectNumber).toBe(1)
    expect(config.checks).toHaveLength(1)
    expect(config.maxIterationsPerIssue).toBe(3) // default
    expect(config.statuses.todo).toBe("Ready") // default
    expect(config.agents.tdd.runtime).toBe("claude") // default
  })

  it("accepts full config", () => {
    const full = {
      repo: "org/project",
      projectNumber: 3,
      checks: [
        { name: "typecheck", command: "pnpm typecheck" },
        { name: "lint", command: "pnpm lint" },
        { name: "test", command: "pnpm test" },
      ],
      statuses: {
        todo: "Backlog",
        inProgress: "WIP",
        inReview: "Review",
        done: "Shipped",
        stuck: "Blocked",
      },
      agents: {
        tdd: { runtime: "claude" as const },
        review: { runtime: "codex" as const },
      },
      maxIterationsPerIssue: 5,
    }
    const config = validateConfig(full)
    expect(config.repo).toBe("org/project")
    expect(config.projectNumber).toBe(3)
    expect(config.checks).toHaveLength(3)
    expect(config.statuses.todo).toBe("Backlog")
    expect(config.agents.review.runtime).toBe("codex")
    expect(config.maxIterationsPerIssue).toBe(5)
  })

  it("rejects missing repo", () => {
    expect(() => validateConfig({ projectNumber: 1, checks: [{ name: "t", command: "t" }] }))
      .toThrow(ConfigError)
  })

  it("rejects invalid repo format", () => {
    expect(() => validateConfig({ repo: "invalid", projectNumber: 1, checks: [{ name: "t", command: "t" }] }))
      .toThrow("owner/repo")
  })

  it("rejects empty checks", () => {
    expect(() => validateConfig({ repo: "a/b", projectNumber: 1, checks: [] }))
      .toThrow(ConfigError)
  })

  it("rejects missing checks", () => {
    expect(() => validateConfig({ repo: "a/b", projectNumber: 1 }))
      .toThrow(ConfigError)
  })

  it("rejects missing projectNumber", () => {
    expect(() => validateConfig({ repo: "a/b", checks: [{ name: "t", command: "t" }] }))
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

  it("uses default statuses when not provided", () => {
    const config = validateConfig(minimal)
    expect(config.statuses).toEqual({
      todo: "Ready",
      inProgress: "In progress",
      inReview: "In review",
      done: "Done",
      stuck: "Backlog",
    })
  })
})

// --- defineConfig ---

describe("defineConfig", () => {
  it("passes through config object", () => {
    const input = {
      repo: "a/b",
      projectNumber: 1,
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
      projectNumber: 1,
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
