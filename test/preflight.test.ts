import { describe, it, expect } from "vitest"
import { checkCommand, preflightPassed, type PreflightCheck } from "../src/preflight.js"

describe("checkCommand", () => {
  it("returns ok for a command that exists", () => {
    // git should exist on any dev machine
    const result = checkCommand("git", ["--version"], "git")
    expect(result.ok).toBe(true)
    expect(result.name).toBe("git")
  })

  it("returns not ok for a command that doesn't exist", () => {
    const result = checkCommand("this-command-does-not-exist-xyz", ["--version"], "fake-tool")
    expect(result.ok).toBe(false)
    expect(result.message).toContain("not found")
  })
})

describe("preflightPassed", () => {
  it("returns true when all checks pass", () => {
    const checks: PreflightCheck[] = [
      { name: "git", ok: true, message: "ok" },
      { name: "GITHUB_TOKEN", ok: true, message: "ok" },
    ]
    expect(preflightPassed(checks)).toBe(true)
  })

  it("returns false when any check fails", () => {
    const checks: PreflightCheck[] = [
      { name: "git", ok: true, message: "ok" },
      { name: "GITHUB_TOKEN", ok: false, message: "not found" },
    ]
    expect(preflightPassed(checks)).toBe(false)
  })

  it("returns true for empty checks", () => {
    expect(preflightPassed([])).toBe(true)
  })
})
