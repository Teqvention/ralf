import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execaSync } from "execa"
import { getCompletedBehaviors, selectiveStage, branchExists } from "../src/recovery.js"

// Helper: create a temp git repo and cd into it
function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ralf-git-test-"))
  execaSync("git", ["init"], { cwd: dir })
  execaSync("git", ["config", "user.email", "test@test.com"], { cwd: dir })
  execaSync("git", ["config", "user.name", "Test"], { cwd: dir })
  // Create initial commit
  writeFileSync(join(dir, "README.md"), "# Test")
  execaSync("git", ["add", "."], { cwd: dir })
  execaSync("git", ["commit", "-m", "initial"], { cwd: dir })
  return dir
}

describe("getCompletedBehaviors", () => {
  let origCwd: string
  let tempDir: string

  beforeEach(() => {
    origCwd = process.cwd()
    tempDir = createTempGitRepo()
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns empty set when no commits match", () => {
    const result = getCompletedBehaviors(42, ["User can login", "User can logout"])
    expect(result.size).toBe(0)
  })

  it("finds committed behaviors", () => {
    // Create commits matching the pattern
    writeFileSync(join(tempDir, "auth.ts"), "// login")
    execaSync("git", ["add", "."])
    execaSync("git", ["commit", "-m", "feat(#42): User can login"])

    const result = getCompletedBehaviors(42, ["User can login", "User can logout"])
    expect(result.has("User can login")).toBe(true)
    expect(result.has("User can logout")).toBe(false)
  })

  it("finds multiple committed behaviors", () => {
    writeFileSync(join(tempDir, "auth.ts"), "// login")
    execaSync("git", ["add", "."])
    execaSync("git", ["commit", "-m", "feat(#10): Behavior A"])

    writeFileSync(join(tempDir, "auth2.ts"), "// logout")
    execaSync("git", ["add", "."])
    execaSync("git", ["commit", "-m", "feat(#10): Behavior B"])

    const result = getCompletedBehaviors(10, ["Behavior A", "Behavior B", "Behavior C"])
    expect(result.has("Behavior A")).toBe(true)
    expect(result.has("Behavior B")).toBe(true)
    expect(result.has("Behavior C")).toBe(false)
  })

  it("does not match different issue numbers", () => {
    writeFileSync(join(tempDir, "x.ts"), "x")
    execaSync("git", ["add", "."])
    execaSync("git", ["commit", "-m", "feat(#99): Some behavior"])

    const result = getCompletedBehaviors(42, ["Some behavior"])
    expect(result.size).toBe(0)
  })
})

describe("selectiveStage", () => {
  let origCwd: string
  let tempDir: string

  beforeEach(() => {
    origCwd = process.cwd()
    tempDir = createTempGitRepo()
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("stages modified tracked files", () => {
    // Modify the tracked README
    writeFileSync(join(tempDir, "README.md"), "# Updated")
    selectiveStage()

    const status = execaSync("git", ["status", "--porcelain"]).stdout
    // M (staged) not ?M (unstaged)
    expect(status).toContain("M  README.md")
  })

  it("stages new files in src/", () => {
    mkdirSync(join(tempDir, "src"))
    writeFileSync(join(tempDir, "src", "app.ts"), "// new")
    selectiveStage()

    const status = execaSync("git", ["status", "--porcelain"]).stdout
    expect(status).toContain("A  src/app.ts")
  })

  it("stages new files in test/", () => {
    mkdirSync(join(tempDir, "test"))
    writeFileSync(join(tempDir, "test", "app.test.ts"), "// test")
    selectiveStage()

    const status = execaSync("git", ["status", "--porcelain"]).stdout
    expect(status).toContain("A  test/app.test.ts")
  })

  it("does NOT stage files in root (not in source dirs)", () => {
    writeFileSync(join(tempDir, "debug.log"), "debug output")
    selectiveStage()

    const status = execaSync("git", ["status", "--porcelain"]).stdout
    expect(status).toContain("?? debug.log")
  })
})

describe("branchExists", () => {
  let origCwd: string
  let tempDir: string

  beforeEach(() => {
    origCwd = process.cwd()
    tempDir = createTempGitRepo()
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns true for existing branch", () => {
    execaSync("git", ["checkout", "-b", "feature"])
    execaSync("git", ["checkout", "master"])
    expect(branchExists("feature")).toBe(true)
  })

  it("returns false for non-existing branch", () => {
    expect(branchExists("nonexistent")).toBe(false)
  })
})
