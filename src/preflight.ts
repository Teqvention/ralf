/**
 * Pre-flight checks — verify required tools are available.
 */
import { execaSync } from "execa"

export interface PreflightCheck {
  name: string
  ok: boolean
  message: string
}

export function checkCommand(name: string, args: string[], displayName: string): PreflightCheck {
  try {
    execaSync(name, args)
    return { name: displayName, ok: true, message: "available" }
  } catch {
    return { name: displayName, ok: false, message: `${displayName} not found. Install it and try again.` }
  }
}

export function runPreflight(): PreflightCheck[] {
  const checks: PreflightCheck[] = []

  checks.push(checkCommand("git", ["--version"], "git"))
  checks.push(checkCommand("gh", ["--version"], "gh CLI"))
  checks.push(checkCommand("claude", ["--version"], "claude CLI"))

  // Check we're in a git repo
  try {
    execaSync("git", ["status"])
    checks.push({ name: "git repo", ok: true, message: "in a git repository" })
  } catch {
    checks.push({ name: "git repo", ok: false, message: "Not inside a git repository" })
  }

  return checks
}

export function preflightPassed(checks: PreflightCheck[]): boolean {
  return checks.every((c) => c.ok)
}
