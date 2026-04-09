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
  checks.push(checkCommand("claude", ["--version"], "claude CLI"))

  // Check claude auth status (zero-token check)
  try {
    const result = execaSync("claude", ["--print", "--output-format", "json", "--max-turns", "0", "-p", "test"], { timeout: 10_000 })
    const json = JSON.parse(result.stdout)
    if (json.is_error && /not logged in|login|auth/i.test(json.result)) {
      checks.push({ name: "claude auth", ok: false, message: "Not logged in. Run 'claude /login' first." })
    } else {
      checks.push({ name: "claude auth", ok: true, message: "authenticated" })
    }
  } catch {
    // --max-turns 0 may error, but if claude CLI exists and auth works it won't be an auth error
    checks.push({ name: "claude auth", ok: true, message: "assumed authenticated (verify with 'claude /login' if issues)" })
  }

  // Check GITHUB_TOKEN is set
  if (process.env.GITHUB_TOKEN) {
    checks.push({ name: "GITHUB_TOKEN", ok: true, message: "available" })
  } else {
    checks.push({ name: "GITHUB_TOKEN", ok: false, message: "GITHUB_TOKEN not set. Export it and try again." })
  }

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
