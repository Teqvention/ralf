/**
 * Token usage tracking.
 *
 * Tracks input/output tokens per phase, per issue, and grand total.
 */

export interface TokenUsage {
  input: number
  output: number
}

export interface PhaseUsage {
  phase: string
  behavior?: string
  input: number
  output: number
}

export class TokenTracker {
  private phases: PhaseUsage[] = []
  private issueUsages: Map<number, TokenUsage> = new Map()
  private currentIssue: number | null = null

  startIssue(issueNum: number): void {
    this.currentIssue = issueNum
    if (!this.issueUsages.has(issueNum)) {
      this.issueUsages.set(issueNum, { input: 0, output: 0 })
    }
  }

  record(phase: string, input: number, output: number, behavior?: string): void {
    this.phases.push({ phase, behavior, input, output })
    if (this.currentIssue !== null) {
      const usage = this.issueUsages.get(this.currentIssue)
      if (usage) {
        usage.input += input
        usage.output += output
      }
    }
  }

  getIssueUsage(issueNum: number): TokenUsage {
    return this.issueUsages.get(issueNum) ?? { input: 0, output: 0 }
  }

  getGrandTotal(): TokenUsage {
    let input = 0
    let output = 0
    for (const usage of this.issueUsages.values()) {
      input += usage.input
      output += usage.output
    }
    return { input, output }
  }

  formatIssueUsage(issueNum: number): string {
    const u = this.getIssueUsage(issueNum)
    return `tokens: ${formatCount(u.input)} in / ${formatCount(u.output)} out`
  }

  formatGrandTotal(): string {
    const u = this.getGrandTotal()
    return `Grand total tokens: ${formatCount(u.input)} in / ${formatCount(u.output)} out`
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return String(n)
}
