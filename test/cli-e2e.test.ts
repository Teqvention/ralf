import { describe, it, expect } from "vitest"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const binRalf = join(__dirname, "..", "bin", "ralf.js")

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const child = fork(binRalf, args, {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    })

    child.stdout!.on("data", (data: Buffer) => { stdout += data.toString() })
    child.stderr!.on("data", (data: Buffer) => { stderr += data.toString() })
    child.on("exit", (code) => resolve({ stdout, stderr, code }))
  })
}

describe("bin/ralf.js entry point", () => {
  it("delegates to cli.ts so help text lists all four commands including revert and init", async () => {
    const { stdout } = await runCli(["--help"])

    expect(stdout).toContain("run")
    expect(stdout).toContain("status")
    expect(stdout).toContain("revert")
    expect(stdout).toContain("init")
  }, 15_000)
})
