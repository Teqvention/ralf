/**
 * Crash recovery and git helpers.
 *
 * Pure functions for determining which behaviors are already committed
 * and for selective git staging.
 */
import { execaSync } from "execa"

/**
 * Check which behaviors have already been committed on the current branch.
 * Uses git log --grep to find commits matching the behavior name pattern.
 *
 * Returns a Set of behavior names that already have commits.
 */
export function getCompletedBehaviors(
  issueNum: number,
  behaviorNames: string[],
): Set<string> {
  const completed = new Set<string>()
  for (const name of behaviorNames) {
    const pattern = `feat(#${issueNum}): ${name}`
    try {
      const result = execaSync("git", ["log", "--oneline", "--grep", pattern])
      if (result.stdout.trim()) {
        completed.add(name)
      }
    } catch {
      // git log failed — treat as not completed
    }
  }
  return completed
}

/**
 * Stage files selectively — tracked files + new files in source directories.
 * Never uses `git add -A` which could stage debug files, env files, etc.
 */
export function selectiveStage(): void {
  // Stage modified tracked files
  execaSync("git", ["add", "-u"])

  // Stage new files in expected source directories
  const sourceDirs = ["src/", "test/", "tests/", "lib/"]
  for (const dir of sourceDirs) {
    try {
      execaSync("git", ["add", dir])
    } catch {
      // Directory might not exist, that's fine
    }
  }
}

/**
 * Check if a branch exists locally.
 */
export function branchExists(name: string): boolean {
  try {
    execaSync("git", ["rev-parse", "--verify", name])
    return true
  } catch {
    return false
  }
}
