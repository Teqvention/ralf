/**
 * Dependency ordering for sub-issues.
 *
 * Parses `depends-on: #N` from issue bodies and returns
 * a topologically sorted processing order.
 */

export interface OrderableIssue {
  number: number
  title: string
  body: string
}

/**
 * Parse dependency references from an issue body.
 * Supports: `depends-on: #3`, `depends-on: #3, #4`, `depends-on: #3 #4`
 */
export function parseDependencies(body: string): number[] {
  const deps: number[] = []
  const pattern = /depends[- ]on:\s*((?:#\d+[\s,]*)+)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const refs = match[1].matchAll(/#(\d+)/g)
    for (const ref of refs) {
      deps.push(Number.parseInt(ref[1], 10))
    }
  }
  return [...new Set(deps)]
}

/**
 * Topological sort of issues based on `depends-on:` in their bodies.
 * Falls back to input order for issues without dependencies.
 * Throws if a cycle is detected.
 */
export function topologicalSort(issues: OrderableIssue[]): OrderableIssue[] {
  const issueMap = new Map(issues.map((i) => [i.number, i]))
  const issueNumbers = new Set(issues.map((i) => i.number))

  // Build adjacency: issue -> issues it depends on (only within our set)
  const deps = new Map<number, number[]>()
  for (const issue of issues) {
    const parsed = parseDependencies(issue.body).filter((d) => issueNumbers.has(d))
    deps.set(issue.number, parsed)
  }

  const visited = new Set<number>()
  const inStack = new Set<number>()
  const result: OrderableIssue[] = []

  function visit(num: number): void {
    if (visited.has(num)) return
    if (inStack.has(num)) {
      throw new Error(`Dependency cycle detected involving issue #${num}`)
    }
    inStack.add(num)
    for (const dep of deps.get(num) ?? []) {
      visit(dep)
    }
    inStack.delete(num)
    visited.add(num)
    const issue = issueMap.get(num)
    if (issue) result.push(issue)
  }

  for (const issue of issues) {
    visit(issue.number)
  }

  return result
}
