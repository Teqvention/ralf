#!/usr/bin/env tsx

import { execa, execaSync } from "execa"
import {
  parseResultTag,
  validatePlan,
  validateReview,
  validateRedGreen,
  type PlanResult,
  type ReviewResult,
} from "./src/validation.js"
import { runPreflight, preflightPassed } from "./src/preflight.js"
import { loadPrompt, hydrate, loadRalfMd } from "./src/prompts.js"
import { loadConfig, type RalfConfig } from "./src/config.js"
import { getCompletedBehaviors, selectiveStage, branchExists } from "./src/recovery.js"

// Fallback defaults when no .ralf/config.json exists
const FALLBACK_REPO = "Teqvention/ralf"
const FALLBACK_CHECKS = ["npm run typecheck", "npm run lint", "npm run test"]
const FALLBACK_MAX_ITER = 3
const FALLBACK_LABELS = { todo: "todo", inProgress: "in-progress", inReview: "in-review", done: "done", stuck: "stuck" }

type Issue = { title: string; body: string }
type Labels = typeof FALLBACK_LABELS

// --- helpers ---

async function claude(prompt: string): Promise<string> {
  console.log("  ◌ calling claude...")
  const { stdout } = await execa("claude", [
    "--print",
    "--dangerously-skip-permissions",
    "-p",
    prompt,
  ], { timeout: 30 * 60 * 1000 })
  return stdout
}

function gh(...args: string[]): string {
  return execaSync("gh", args).stdout
}

function git(...args: string[]): string {
  return execaSync("git", args).stdout
}

function runChecks(config: RalfConfig | null): { ok: boolean; errors: string } {
  const checks = config
    ? config.checks.map((c) => c.command)
    : FALLBACK_CHECKS
  const errors: string[] = []
  for (const cmd of checks) {
    try {
      execaSync(cmd, { shell: true })
      console.log("  ✔ " + cmd)
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string; message?: string }
      console.log("  ✘ " + cmd)
      errors.push(cmd + ":\n" + (err.stderr || err.stdout || err.message || "unknown error"))
    }
  }
  return { ok: errors.length === 0, errors: errors.join("\n\n") }
}

function fetchIssue(n: number, repo: string): Issue {
  return JSON.parse(gh("issue", "view", String(n), "--repo", repo, "--json", "title,body")) as Issue
}

function setLabel(n: number, label: string, repo: string, labels: Labels): void {
  const allLabels = [labels.todo, labels.inProgress, labels.inReview, labels.done, labels.stuck].join(",")
  try {
    gh("issue", "edit", String(n), "--repo", repo,
      "--remove-label", allLabels,
      "--add-label", label)
  } catch { /* label might not exist yet */ }
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// --- prompts ---

function planPrompt(issue: Issue, ralfMd: string): string {
  return hydrate(loadPrompt("plan"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
  })
}

function redPrompt(issue: Issue, behavior: { name: string; type: string }, allBehaviors: string, archBrief: string, ralfMd: string): string {
  return hydrate(loadPrompt("red"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    ARCH_BRIEF: archBrief,
    BEHAVIOR_NAME: behavior.name,
    BEHAVIOR_TYPE: behavior.type,
    ALL_BEHAVIORS: allBehaviors,
  })
}

function greenPrompt(issue: Issue, behavior: { name: string }, errors: string, archBrief: string, ralfMd: string): string {
  const errorsSection = errors
    ? "## PREVIOUS FAILURES — FIX THESE FIRST\n\nThe last attempt failed checks. Fix these errors before doing anything else:\n\n" + errors
    : ""
  return hydrate(loadPrompt("green"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    ARCH_BRIEF: archBrief,
    BEHAVIOR_NAME: behavior.name,
    ERRORS_SECTION: errorsSection,
  })
}

function greenFixPrompt(issue: Issue, fixItems: string[], archBrief: string, ralfMd: string): string {
  const fixList = fixItems.map((item, i) => (i + 1) + ". " + item).join("\n")
  return hydrate(loadPrompt("green-fix"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    ARCH_BRIEF: archBrief,
    FIX_ITEMS: fixList,
  })
}

function reviewPrompt(issue: Issue, diff: string, ralfMd: string): string {
  return hydrate(loadPrompt("review"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    DIFF: diff,
  })
}

// --- main loop (broken into phases) ---

function buildArchBrief(plan: PlanResult): string {
  if (!plan.architecture) return "No architecture brief available."
  const a = plan.architecture
  const docLines = a.docFindings?.map((d) => "  - " + d).join("\n")
  return [
    "Approach: " + a.approach,
    a.relevantFiles?.length ? "Relevant files: " + a.relevantFiles.join(", ") : "",
    a.newFiles?.length ? "New files: " + a.newFiles.join(", ") : "",
    a.patterns?.length ? "Patterns: " + a.patterns.join("; ") : "",
    docLines ? "Doc findings:\n" + docLines : "",
  ].filter(Boolean).join("\n")
}

function ensureDevBranch(): void {
  try {
    git("checkout", "dev")
    git("pull", "origin", "dev")
  } catch {
    git("checkout", "-b", "dev")
    git("push", "-u", "origin", "dev")
  }
}

function resolveConfig(): { config: RalfConfig | null; repo: string; maxIter: number; labels: Labels } {
  let config: RalfConfig | null = null
  try {
    config = loadConfig()
    console.log("  ✔ config loaded: " + config.repo)
  } catch {
    console.log("  ⚠ No .ralf/config.json found, using defaults (repo: " + FALLBACK_REPO + ")")
  }
  return {
    config,
    repo: config?.repo ?? FALLBACK_REPO,
    maxIter: config?.maxIterationsPerIssue ?? FALLBACK_MAX_ITER,
    labels: config?.labels ?? FALLBACK_LABELS,
  }
}

function validateAgentOutput(raw: unknown, phase: string): void {
  if (!raw) return
  try {
    validateRedGreen(raw)
  } catch (e) {
    console.log("  ⚠ " + phase + " output invalid: " + formatError(e))
  }
}

async function runPlanPhase(issue: Issue, ralfMd: string, issueNum: number, labels: Labels, repo: string): Promise<PlanResult | null> {
  console.log("\n◌ plan...")
  const planOut = await claude(planPrompt(issue, ralfMd))
  const planRaw = parseResultTag(planOut)
  if (planRaw == null) {
    console.log("✘ Plan failed — no <result> tag found in output")
    console.log("  Raw output (first 500 chars): " + planOut.slice(0, 500))
    setLabel(issueNum, labels.stuck, repo, labels)
    return null
  }

  try {
    return validatePlan(planRaw)
  } catch (e) {
    console.log("✘ Plan failed — invalid output: " + formatError(e))
    console.log("  Raw JSON: " + JSON.stringify(planRaw, null, 2).slice(0, 500))
    setLabel(issueNum, labels.stuck, repo, labels)
    return null
  }
}

function logPlan(plan: PlanResult): void {
  console.log("✔ plan — " + plan.behaviors.length + " behaviors:")
  for (const b of plan.behaviors) {
    const icon = b.type === "e2e" ? "🔗" : "•"
    console.log("  " + icon + " " + b.name)
  }
  if (plan.architecture) {
    console.log("  approach: " + plan.architecture.approach)
    if (plan.architecture.docFindings?.length) {
      console.log("  research: " + plan.architecture.docFindings.length + " findings")
    }
  }
}

async function runRedPhase(issue: Issue, behavior: { name: string; type: string }, plan: PlanResult, archBrief: string, ralfMd: string, config: RalfConfig | null): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const redOut = await claude(redPrompt(issue, behavior, JSON.stringify(plan.behaviors, null, 2), archBrief, ralfMd))
    validateAgentOutput(parseResultTag(redOut), "RED")

    const testCheck = runChecks(config)
    if (testCheck.ok) {
      console.log("  ⚠ RED Gate FAILED — test passed unexpectedly")
      if (attempt === 0) console.log("  retrying...")
      continue
    }
    console.log("  ✔ RED Gate — test fails correctly")
    return true
  }
  return false
}

async function runGreenPhase(issue: Issue, behavior: { name: string }, archBrief: string, ralfMd: string, config: RalfConfig | null, issueNum: number): Promise<boolean> {
  let errors = ""
  for (let attempt = 0; attempt < 2; attempt++) {
    const greenOut = await claude(greenPrompt(issue, behavior, errors, archBrief, ralfMd))
    validateAgentOutput(parseResultTag(greenOut), "GREEN")

    const checks = runChecks(config)
    if (checks.ok) {
      selectiveStage()
      git("commit", "-m", "feat(#" + issueNum + "): " + behavior.name)
      console.log("  ✔ GREEN Gate — committed")
      return true
    }
    errors = checks.errors
    console.log("  ⚠ GREEN Gate FAILED, retrying...")
  }
  return false
}

async function runTddSlices(issue: Issue, plan: PlanResult, archBrief: string, ralfMd: string, config: RalfConfig | null, issueNum: number): Promise<void> {
  const completed = getCompletedBehaviors(issueNum, plan.behaviors.map((b) => b.name))
  if (completed.size > 0) {
    console.log("  ⊘ crash recovery: " + completed.size + " behaviors already committed, skipping")
  }

  for (let i = 0; i < plan.behaviors.length; i++) {
    const behavior = plan.behaviors[i]
    const progress = (i + 1) + "/" + plan.behaviors.length

    if (completed.has(behavior.name)) {
      console.log("\n  ⊘ skip " + progress + ": " + behavior.name + " (already committed)")
      continue
    }

    console.log("\n◌ red " + progress + ": " + behavior.name)
    const redPassed = await runRedPhase(issue, behavior, plan, archBrief, ralfMd, config)
    if (!redPassed) {
      console.log("  ⚠ Skipping behavior — could not write failing test")
      continue
    }

    console.log("\n◌ green " + progress + ": " + behavior.name)
    const greenPassed = await runGreenPhase(issue, behavior, archBrief, ralfMd, config, issueNum)
    if (!greenPassed) {
      console.log("  ⚠ GREEN Gate failed after retries — continuing to next behavior")
    }
  }
}

interface ReviewContext {
  issue: Issue
  ralfMd: string
  archBrief: string
  config: RalfConfig | null
  issueNum: number
  branchName: string
  maxIter: number
  labels: Labels
  repo: string
}

async function runReviewLoop(ctx: ReviewContext): Promise<void> {
  for (let iter = 1; iter <= ctx.maxIter; iter++) {
    const iterSuffix = iter > 1 ? " (iteration " + iter + "/" + ctx.maxIter + ")" : ""
    console.log("\n◌ review" + iterSuffix + "...")
    setLabel(ctx.issueNum, ctx.labels.inReview, ctx.repo, ctx.labels)

    let diff: string
    try { diff = git("diff", "dev...HEAD") }
    catch { diff = git("diff", "HEAD~1") }

    const reviewOut = await claude(reviewPrompt(ctx.issue, diff, ctx.ralfMd))
    const reviewRaw = parseResultTag(reviewOut)

    if (reviewRaw == null) {
      console.log("  ✘ Review failed — no <result> tag found")
      continue
    }

    let review: ReviewResult
    try {
      review = validateReview(reviewRaw)
    } catch (e) {
      console.log("  ✘ Review failed — invalid output: " + formatError(e))
      continue
    }

    if (review.verdict === "approved") {
      mergeAndClose(ctx.issueNum, ctx.branchName, review.notes || "", ctx.labels, ctx.repo)
      return
    }

    logNeedsFixes(review.fixItems)

    if (iter < ctx.maxIter) {
      await runGreenFix(ctx.issue, review.fixItems, ctx.archBrief, ctx.ralfMd, ctx.config, ctx.issueNum)
    }
  }

  setLabel(ctx.issueNum, ctx.labels.stuck, ctx.repo, ctx.labels)
  console.log("\n⚠ Issue #" + ctx.issueNum + " stuck after " + ctx.maxIter + " iterations")
}

function mergeAndClose(issueNum: number, branchName: string, notes: string, labels: Labels, repo: string): void {
  console.log("  ✔ APPROVED: " + notes)
  git("checkout", "dev")
  git("merge", branchName)
  git("branch", "-d", branchName)
  git("push", "origin", "dev")
  setLabel(issueNum, labels.done, repo, labels)
  gh("issue", "close", String(issueNum), "--repo", repo)
  console.log("\n✔ Issue #" + issueNum + " complete → merged to dev, pushed")
}

function logNeedsFixes(fixItems: string[]): void {
  console.log("  ✘ NEEDS_FIXES:")
  for (const item of fixItems) {
    console.log("    - " + item)
  }
}

async function runGreenFix(issue: Issue, fixItems: string[], archBrief: string, ralfMd: string, config: RalfConfig | null, issueNum: number): Promise<void> {
  console.log("\n◌ green-fix (fixing " + fixItems.length + " items)...")
  const fixOut = await claude(greenFixPrompt(issue, fixItems, archBrief, ralfMd))
  validateAgentOutput(parseResultTag(fixOut), "GREEN-FIX")

  const fixChecks = runChecks(config)
  if (fixChecks.ok) {
    selectiveStage()
    git("commit", "-m", "fix(#" + issueNum + "): address review feedback")
    console.log("  ✔ GREEN-FIX — committed")
  } else {
    console.log("  ⚠ GREEN-FIX checks failed — retrying review...")
  }
}

// --- main entry ---

async function run(issueNum: number): Promise<void> {
  console.log("\n◌ Pre-flight checks...")
  const preflight = runPreflight()
  for (const check of preflight) {
    const icon = check.ok ? "✔" : "✘"
    console.log("  " + icon + " " + check.name + ": " + check.message)
  }
  if (!preflightPassed(preflight)) {
    console.log("\n✘ Pre-flight failed. Fix the issues above and retry.")
    process.exit(1)
  }

  const { config, repo, maxIter, labels } = resolveConfig()
  const issue = fetchIssue(issueNum, repo)
  const ralfMd = loadRalfMd()
  const branchName = "ralf/" + issueNum

  console.log("\n▶ Starting issue #" + issueNum + ": " + issue.title)

  ensureDevBranch()

  if (branchExists(branchName)) {
    git("checkout", branchName)
    console.log("  → resumed existing branch: " + branchName)
  } else {
    git("checkout", "-b", branchName)
  }
  setLabel(issueNum, labels.inProgress, repo, labels)
  console.log("  → branch: " + branchName + " (from dev)")
  console.log("  → label: in-progress")

  const plan = await runPlanPhase(issue, ralfMd, issueNum, labels, repo)
  if (!plan) return
  logPlan(plan)

  const archBrief = buildArchBrief(plan)
  await runTddSlices(issue, plan, archBrief, ralfMd, config, issueNum)
  await runReviewLoop({ issue, ralfMd, archBrief, config, issueNum, branchName, maxIter, labels, repo })
}

// --- status ---

function status(): void {
  let config: RalfConfig | null = null
  try { config = loadConfig() } catch { /* use defaults */ }
  const repo = config?.repo ?? FALLBACK_REPO
  const labels = config?.labels ?? FALLBACK_LABELS
  const labelValues = [labels.todo, labels.inProgress, labels.inReview, labels.done, labels.stuck]

  console.log("\n┌─ ralf status ─────────────────┐")
  for (const label of labelValues) {
    const issues = JSON.parse(gh("issue", "list", "--repo", repo, "--label", label, "--json", "number", "--limit", "100")) as unknown[]
    const count = String(issues.length).padStart(3)
    console.log("│  " + label.padEnd(12) + " " + count + " │")
  }
  console.log("└───────────────────────────────┘")
}

// --- cli ---

const [cmd, arg] = process.argv.slice(2)

try {
  if (cmd === "run" && arg) {
    await run(Number.parseInt(arg.replace("#", ""), 10))
  } else if (cmd === "status") {
    status()
  } else {
    console.log("Usage:")
    console.log("  tsx ralf.ts run <issue-number>")
    console.log("  tsx ralf.ts status")
  }
} catch (e: unknown) {
  console.error("\n✘ Fatal error: " + formatError(e))
  process.exit(1)
}
