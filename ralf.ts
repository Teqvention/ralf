import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const envPath = resolve(import.meta.dirname, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { execa, execaSync } from "execa";
import {
  parseResultTag,
  validatePlan,
  validateReview,
  validateRedGreen,
  type PlanResult,
  type ReviewResult,
} from "./src/validation.js";
import { runPreflight, preflightPassed } from "./src/preflight.js";
import { loadPrompt, hydrate, loadRalfMd } from "./src/prompts.js";
import { loadConfig, type RalfConfig, type Statuses } from "./src/config.js";
import {
  getCompletedBehaviors,
  selectiveStage,
  branchExists,
} from "./src/recovery.js";
import * as github from "./src/github.js";
import { topologicalSort } from "./src/ordering.js";
import { TokenTracker } from "./src/tokens.js";

// Fallback defaults when no .ralf/config.json exists
const FALLBACK_REPO = "Teqvention/ralf";
const FALLBACK_CHECKS = ["npm run typecheck", "npm run lint", "npm run test"];
const FALLBACK_MAX_ITER = 3;
const FALLBACK_STATUSES: Statuses = {
  todo: "Ready",
  inProgress: "In progress",
  inReview: "In review",
  done: "Done",
  stuck: "Backlog",
};
const FALLBACK_PROJECT_NUMBER = 1;
const FALLBACK_TIMEOUT_MIN = 30;

type Issue = github.Issue;

// --- helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const USAGE_LIMIT_WAIT_MS = 10 * 60 * 1000; // 10 minutes
const USAGE_LIMIT_MAX_RETRIES = 5;

let sessionId: string | null = null;

const tokenTracker = new TokenTracker();

interface ClaudeResponse {
  result: string;
  tokensIn: number;
  tokensOut: number;
}

async function claude(prompt: string): Promise<ClaudeResponse> {
  for (let attempt = 0; attempt <= USAGE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const args = [
        "--print",
        "--dangerously-skip-permissions",
        "--output-format", "json",
        "--max-turns", "50",
      ];
      if (sessionId) args.push("--resume", sessionId);
      console.log("  ◌ calling claude..." + (sessionId ? " (session " + sessionId.slice(0, 8) + ")" : ""));

      const { stdout } = await execa("claude", args, { input: prompt, timeout: 30 * 60 * 1000 });
      const json = JSON.parse(stdout) as {
        result: string;
        session_id: string;
        is_error: boolean;
        input_tokens?: number;
        output_tokens?: number;
      };
      sessionId = json.session_id;
      if (json.is_error) {
        const isAuthError = /not logged in|login|auth/i.test(json.result);
        if (isAuthError) {
          throw new Error("Claude CLI not logged in. Run 'claude /login' first, then retry.");
        }
        throw new Error(json.result);
      }
      const tokensIn = json.input_tokens ?? 0;
      const tokensOut = json.output_tokens ?? 0;
      return { result: json.result, tokensIn, tokensOut };
    } catch (e: unknown) {
      const msg = formatError(e);
      const isUsageLimit =
        /usage.?limit|rate.?limit|too many requests|429|quota|overloaded/i.test(
          msg,
        );
      if (!isUsageLimit || attempt >= USAGE_LIMIT_MAX_RETRIES) throw e;

      const resumeTime = new Date(
        Date.now() + USAGE_LIMIT_WAIT_MS,
      ).toLocaleTimeString();
      console.log(
        "  ⚠ Usage limit hit — waiting 10m (retry " +
          (attempt + 1) +
          "/" +
          USAGE_LIMIT_MAX_RETRIES +
          ", resuming at " +
          resumeTime +
          ")",
      );
      await sleep(USAGE_LIMIT_WAIT_MS);
    }
  }
  throw new Error("unreachable");
}

function resetSession(): void {
  sessionId = null;
}

function git(...args: string[]): string {
  return execaSync("git", args).stdout;
}

function runChecks(config: RalfConfig | null): { ok: boolean; errors: string } {
  const checks = config ? config.checks.map((c) => c.command) : FALLBACK_CHECKS;
  const errors: string[] = [];
  for (const cmd of checks) {
    try {
      execaSync(cmd, { shell: true });
      console.log("  ✔ " + cmd);
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      console.log("  ✘ " + cmd);
      errors.push(
        cmd +
          ":\n" +
          (err.stderr || err.stdout || err.message || "unknown error"),
      );
    }
  }
  return { ok: errors.length === 0, errors: errors.join("\n\n") };
}

async function fetchIssue(n: number, repo: string): Promise<Issue> {
  return github.fetchIssue(n, repo);
}

async function setStatus(
  n: number,
  statusName: string,
  repo: string,
  projectNumber: number,
): Promise<void> {
  await github.setIssueStatus(n, statusName, repo, projectNumber);
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Extract a condensed issue summary for post-plan phases.
 * Keeps title + acceptance criteria, drops verbose context.
 */
function condensedIssue(issue: Issue): Issue {
  const body = issue.body;
  // Extract checkbox/acceptance criteria lines
  const criteria = body
    .split("\n")
    .filter((l) => /^\s*-\s*\[[ x]\]/i.test(l))
    .join("\n");
  const summary = criteria
    ? "Acceptance criteria:\n" + criteria
    : body.slice(0, 500);
  return { title: issue.title, body: summary };
}

// --- prompts ---

function planPrompt(issue: Issue, ralfMd: string): string {
  return hydrate(loadPrompt("plan"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
  });
}

function redPrompt(
  issue: Issue,
  behavior: { name: string; type: string },
  allBehaviors: string,
  archBrief: string,
  ralfMd: string,
  retryContext: string = "",
): string {
  return hydrate(loadPrompt("red"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    ARCH_BRIEF: archBrief,
    BEHAVIOR_NAME: behavior.name,
    BEHAVIOR_TYPE: behavior.type,
    ALL_BEHAVIORS: allBehaviors,
    RED_RETRY_CONTEXT: retryContext,
  });
}

function greenPrompt(
  issue: Issue,
  behavior: { name: string },
  errors: string,
  archBrief: string,
  ralfMd: string,
  testFiles: string = "",
): string {
  const errorsSection = errors
    ? "## PREVIOUS FAILURES — FIX THESE FIRST\n\nThe last attempt failed checks. Fix these errors before doing anything else:\n\n" +
      errors
    : "";
  return hydrate(loadPrompt("green"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    ARCH_BRIEF: archBrief,
    BEHAVIOR_NAME: behavior.name,
    ERRORS_SECTION: errorsSection,
    TEST_FILES: testFiles || "(explore the test directory to find the failing test)",
  });
}

function greenFixPrompt(
  issue: Issue,
  fixItems: string[],
  archBrief: string,
  ralfMd: string,
): string {
  const fixList = fixItems.map((item, i) => i + 1 + ". " + item).join("\n");
  return hydrate(loadPrompt("green-fix"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    ARCH_BRIEF: archBrief,
    FIX_ITEMS: fixList,
  });
}

const DIFF_MAX_LINES = 500;

function truncateDiff(diff: string): { diff: string; stat: string } {
  let stat: string;
  try {
    stat = git("diff", "--stat", "dev...HEAD");
  } catch {
    try {
      stat = git("diff", "--stat", "HEAD~1");
    } catch {
      stat = "(diff stat unavailable)";
    }
  }

  const lines = diff.split("\n");
  if (lines.length <= DIFF_MAX_LINES) {
    return { diff, stat };
  }

  const truncated = lines.slice(-DIFF_MAX_LINES).join("\n");
  return {
    diff: `(truncated — showing last ${DIFF_MAX_LINES} of ${lines.length} lines)\n\n${truncated}`,
    stat,
  };
}

function reviewPrompt(
  issue: Issue,
  diff: string,
  ralfMd: string,
  archBrief: string,
  planBehaviors: string,
): string {
  const { diff: truncatedDiff, stat } = truncateDiff(diff);
  return hydrate(loadPrompt("review"), {
    RALF_MD: ralfMd,
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body,
    DIFF: truncatedDiff,
    DIFF_STAT: stat,
    ARCH_BRIEF: archBrief,
    PLAN_BEHAVIORS: planBehaviors,
  });
}

// --- main loop (broken into phases) ---

function buildArchBrief(plan: PlanResult): string {
  if (!plan.architecture) return "No architecture brief available.";
  const a = plan.architecture;
  const docLines = a.docFindings?.map((d) => "  - " + d).join("\n");
  return [
    "Approach: " + a.approach,
    a.relevantFiles?.length
      ? "Relevant files: " + a.relevantFiles.join(", ")
      : "",
    a.newFiles?.length ? "New files: " + a.newFiles.join(", ") : "",
    a.patterns?.length ? "Patterns: " + a.patterns.join("; ") : "",
    docLines ? "Doc findings:\n" + docLines : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function commitIfDirty(issueNum: number, message: string): void {
  const status = git("status", "--porcelain");
  if (!status.trim()) return;
  selectiveStage();
  try {
    git("commit", "-m", message);
    console.log("  ✔ committed uncommitted changes before branch switch");
  } catch {
    // nothing to commit after staging
  }
}

function safeCheckout(branch: string, issueNum?: number): void {
  if (issueNum) {
    commitIfDirty(issueNum, "fix(#" + issueNum + "): auto-commit before branch switch");
  }
  git("checkout", branch);
}

function ensureDevBranch(issueNum?: number): void {
  if (branchExists("dev")) {
    safeCheckout("dev", issueNum);
    try { git("pull", "origin", "dev"); } catch { /* offline or no remote */ }
  } else {
    git("checkout", "-b", "dev");
    try { git("push", "-u", "origin", "dev"); } catch { /* offline */ }
  }
}

function resolveConfig(): {
  config: RalfConfig | null;
  repo: string;
  maxIter: number;
  statuses: Statuses;
  projectNumber: number;
  timeoutMs: number;
} {
  let config: RalfConfig | null = null;
  try {
    config = loadConfig();
    console.log("  ✔ config loaded: " + config.repo);
  } catch {
    console.log(
      "  ⚠ No .ralf/config.json found, using defaults (repo: " +
        FALLBACK_REPO +
        ")",
    );
  }
  const timeoutMin = config?.issueTimeoutMinutes ?? FALLBACK_TIMEOUT_MIN;
  return {
    config,
    repo: config?.repo ?? FALLBACK_REPO,
    maxIter: config?.maxIterationsPerIssue ?? FALLBACK_MAX_ITER,
    statuses: config?.statuses ?? FALLBACK_STATUSES,
    projectNumber: config?.projectNumber ?? FALLBACK_PROJECT_NUMBER,
    timeoutMs: timeoutMin * 60 * 1000,
  };
}

function validateAgentOutput(raw: unknown, phase: string): void {
  if (!raw) return;
  try {
    validateRedGreen(raw);
  } catch (e) {
    console.log("  ⚠ " + phase + " output invalid: " + formatError(e));
  }
}

async function runPlanPhase(
  issue: Issue,
  ralfMd: string,
  issueNum: number,
  statuses: Statuses,
  repo: string,
  projectNumber: number,
): Promise<PlanResult | null> {
  console.log("\n◌ plan...");
  const planResponse = await claude(planPrompt(issue, ralfMd));
  tokenTracker.record("plan", planResponse.tokensIn, planResponse.tokensOut);
  const planRaw = parseResultTag(planResponse.result);
  if (planRaw == null) {
    console.log("✘ Plan failed — no <result> tag found in output");
    console.log("  Raw output (first 500 chars): " + planResponse.result.slice(0, 500));
    await setStatus(issueNum, statuses.stuck, repo, projectNumber);
    return null;
  }

  try {
    return validatePlan(planRaw);
  } catch (e) {
    console.log("✘ Plan failed — invalid output: " + formatError(e));
    console.log(
      "  Raw JSON: " + JSON.stringify(planRaw, null, 2).slice(0, 500),
    );
    await setStatus(issueNum, statuses.stuck, repo, projectNumber);
    return null;
  }
}

function logPlan(plan: PlanResult): void {
  console.log("✔ plan — " + plan.behaviors.length + " behaviors:");
  for (const b of plan.behaviors) {
    const icon = b.type === "e2e" ? "🔗" : "•";
    console.log("  " + icon + " " + b.name);
  }
  if (plan.architecture) {
    console.log("  approach: " + plan.architecture.approach);
    if (plan.architecture.docFindings?.length) {
      console.log(
        "  research: " + plan.architecture.docFindings.length + " findings",
      );
    }
  }
}

async function runRedPhase(
  issue: Issue,
  behavior: { name: string; type: string },
  plan: PlanResult,
  archBrief: string,
  ralfMd: string,
  config: RalfConfig | null,
): Promise<{ passed: boolean; testFiles: string[] }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryContext = attempt > 0
      ? "## PREVIOUS ATTEMPT FAILED — TEST PASSED WHEN IT SHOULD HAVE FAILED\n\nThis means either:\n1. The behavior is already implemented — pick a different aspect to test\n2. Your test doesn't actually exercise the new behavior\n3. Your assertion is too weak\n\nWrite a DIFFERENT test that will genuinely fail."
      : "";
    const otherBehaviors = plan.behaviors
      .filter((b) => b.name !== behavior.name)
      .map((b) => "- " + b.name + " (" + b.type + ")")
      .join("\n");
    // Skip RALF.md on retries — already in session context
    const redResponse = await claude(
      redPrompt(
        issue,
        behavior,
        otherBehaviors,
        archBrief,
        attempt > 0 ? "" : ralfMd,
        retryContext,
      ),
    );
    tokenTracker.record("red", redResponse.tokensIn, redResponse.tokensOut, behavior.name);
    const redResult = parseResultTag(redResponse.result);
    validateAgentOutput(redResult, "RED");

    const testCheck = runChecks(config);
    if (testCheck.ok) {
      console.log("  ⚠ RED Gate FAILED — test passed unexpectedly");
      if (attempt === 0) console.log("  retrying...");
      continue;
    }
    console.log("  ✔ RED Gate — test fails correctly");
    const testFiles = (redResult as { testFiles?: string[] })?.testFiles ?? [];
    return { passed: true, testFiles };
  }
  return { passed: false, testFiles: [] };
}

async function runGreenPhase(
  issue: Issue,
  behavior: { name: string },
  archBrief: string,
  ralfMd: string,
  config: RalfConfig | null,
  issueNum: number,
  testFiles: string[] = [],
): Promise<boolean> {
  let errors = "";
  const testFilesStr = testFiles.length > 0 ? testFiles.join(", ") : "";
  for (let attempt = 0; attempt < 2; attempt++) {
    // Skip RALF.md on retries — already in session context
    const greenResponse = await claude(
      greenPrompt(issue, behavior, errors, archBrief, attempt > 0 ? "" : ralfMd, testFilesStr),
    );
    tokenTracker.record("green", greenResponse.tokensIn, greenResponse.tokensOut, behavior.name);
    validateAgentOutput(parseResultTag(greenResponse.result), "GREEN");

    const checks = runChecks(config);
    if (checks.ok) {
      selectiveStage();
      git("commit", "-m", "feat(#" + issueNum + "): " + behavior.name);
      console.log("  ✔ GREEN Gate — committed");
      return true;
    }
    errors = checks.errors;
    console.log("  ⚠ GREEN Gate FAILED, retrying...");
  }
  return false;
}

async function runTddSlices(
  issue: Issue,
  plan: PlanResult,
  archBrief: string,
  ralfMd: string,
  config: RalfConfig | null,
  issueNum: number,
): Promise<void> {
  const completed = getCompletedBehaviors(
    issueNum,
    plan.behaviors.map((b) => b.name),
  );
  if (completed.size > 0) {
    console.log(
      "  ⊘ crash recovery: " +
        completed.size +
        " behaviors already committed, skipping",
    );
  }

  for (let i = 0; i < plan.behaviors.length; i++) {
    const behavior = plan.behaviors[i];
    const progress = i + 1 + "/" + plan.behaviors.length;

    if (completed.has(behavior.name)) {
      console.log(
        "\n  ⊘ skip " +
          progress +
          ": " +
          behavior.name +
          " (already committed)",
      );
      continue;
    }

    console.log("\n◌ red " + progress + ": " + behavior.name);
    resetSession();
    const redResult = await runRedPhase(
      issue,
      behavior,
      plan,
      archBrief,
      ralfMd,
      config,
    );
    if (!redResult.passed) {
      console.log("  ⚠ Skipping behavior — could not write failing test");
      continue;
    }

    console.log("\n◌ green " + progress + ": " + behavior.name);
    resetSession();
    const greenPassed = await runGreenPhase(
      issue,
      behavior,
      archBrief,
      ralfMd,
      config,
      issueNum,
      redResult.testFiles,
    );
    if (!greenPassed) {
      console.log(
        "  ⚠ GREEN Gate failed after retries — continuing to next behavior",
      );
    }
  }
}

interface ReviewContext {
  issue: Issue;
  ralfMd: string;
  archBrief: string;
  planBehaviors: string;
  config: RalfConfig | null;
  issueNum: number;
  branchName: string;
  maxIter: number;
  statuses: Statuses;
  repo: string;
  projectNumber: number;
}

async function runReviewLoop(ctx: ReviewContext): Promise<void> {
  if (isReviewApproved(ctx.issueNum)) {
    console.log("\n  ⊘ review already approved — merging");
    await mergeAndClose(ctx.issueNum, ctx.branchName, "(previously approved)", ctx.statuses, ctx.repo, ctx.projectNumber);
    return;
  }

  for (let iter = 1; iter <= ctx.maxIter; iter++) {
    const iterSuffix =
      iter > 1 ? " (iteration " + iter + "/" + ctx.maxIter + ")" : "";
    console.log("\n◌ review" + iterSuffix + "...");
    resetSession();
    await setStatus(ctx.issueNum, ctx.statuses.inReview, ctx.repo, ctx.projectNumber);

    let diff: string;
    try {
      diff = git("diff", "dev...HEAD");
    } catch {
      diff = git("diff", "HEAD~1");
    }

    const reviewResponse = await claude(reviewPrompt(ctx.issue, diff, ctx.ralfMd, ctx.archBrief, ctx.planBehaviors));
    tokenTracker.record("review", reviewResponse.tokensIn, reviewResponse.tokensOut);
    const reviewRaw = parseResultTag(reviewResponse.result);

    if (reviewRaw == null) {
      console.log("  ✘ Review failed — no <result> tag found");
      continue;
    }

    let review: ReviewResult;
    try {
      review = validateReview(reviewRaw);
    } catch (e) {
      console.log("  ✘ Review failed — invalid output: " + formatError(e));
      continue;
    }

    if (review.verdict === "approved") {
      saveReviewApproved(ctx.issueNum, review.notes || "");
      selectiveStage();
      try { git("commit", "-m", "review(#" + ctx.issueNum + "): approved"); } catch { /* nothing to commit */ }
      await mergeAndClose(
        ctx.issueNum,
        ctx.branchName,
        review.notes || "",
        ctx.statuses,
        ctx.repo,
        ctx.projectNumber,
      );
      return;
    }

    logNeedsFixes(review.fixItems);

    if (iter < ctx.maxIter) {
      await runGreenFix(
        ctx.issue,
        review.fixItems,
        ctx.archBrief,
        ctx.ralfMd,
        ctx.config,
        ctx.issueNum,
      );
    }
  }

  await setStatus(ctx.issueNum, ctx.statuses.stuck, ctx.repo, ctx.projectNumber);
  console.log(
    "\n⚠ Issue #" +
      ctx.issueNum +
      " stuck after " +
      ctx.maxIter +
      " iterations",
  );
}

async function mergeAndClose(
  issueNum: number,
  branchName: string,
  notes: string,
  statuses: Statuses,
  repo: string,
  projectNumber: number,
): Promise<boolean> {
  console.log("  ✔ APPROVED: " + notes);
  safeCheckout("dev", issueNum);
  try {
    git("merge", branchName);
  } catch (e: unknown) {
    console.log("  ✘ Merge conflict on " + branchName + " → dev");
    console.log("  " + formatError(e));
    try { git("merge", "--abort"); } catch { /* already clean */ }
    safeCheckout(branchName);
    await setStatus(issueNum, statuses.stuck, repo, projectNumber);
    console.log("  ⚠ Issue #" + issueNum + " stuck — merge conflict needs manual resolution");
    return false;
  }
  git("branch", "-d", branchName);
  git("push", "origin", "dev");
  await setStatus(issueNum, statuses.done, repo, projectNumber);
  await github.closeIssue(issueNum, repo);
  console.log("\n✔ Issue #" + issueNum + " complete → merged to dev, pushed");
  console.log("  " + tokenTracker.formatIssueUsage(issueNum));
  return true;
}

function logNeedsFixes(fixItems: string[]): void {
  console.log("  ✘ NEEDS_FIXES:");
  for (const item of fixItems) {
    console.log("    - " + item);
  }
}

async function runGreenFix(
  issue: Issue,
  fixItems: string[],
  archBrief: string,
  ralfMd: string,
  config: RalfConfig | null,
  issueNum: number,
): Promise<void> {
  console.log("\n◌ green-fix (fixing " + fixItems.length + " items)...");
  resetSession();
  const fixResponse = await claude(
    greenFixPrompt(issue, fixItems, archBrief, ralfMd),
  );
  tokenTracker.record("green-fix", fixResponse.tokensIn, fixResponse.tokensOut);
  validateAgentOutput(parseResultTag(fixResponse.result), "GREEN-FIX");

  const fixChecks = runChecks(config);
  if (fixChecks.ok) {
    selectiveStage();
    git("commit", "-m", "fix(#" + issueNum + "): address review feedback");
    console.log("  ✔ GREEN-FIX — committed");
  } else {
    console.log("  ⚠ GREEN-FIX checks failed — retrying review...");
  }
}

// --- state persistence ---

function stateDir(issueNum: number): string {
  return join(".ralf", "state", String(issueNum));
}

function saveState(issueNum: number, name: string, data: unknown): void {
  const dir = stateDir(issueNum);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + ".json"), JSON.stringify(data, null, 2));
}

function loadState<T>(issueNum: number, name: string): T | null {
  const path = join(stateDir(issueNum), name + ".json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function savePlan(issueNum: number, plan: PlanResult): void {
  saveState(issueNum, "plan", plan);
}

function loadSavedPlan(issueNum: number): PlanResult | null {
  const raw = loadState(issueNum, "plan");
  if (!raw) return null;
  try {
    return validatePlan(raw);
  } catch {
    return null;
  }
}

function saveReviewApproved(issueNum: number, notes: string): void {
  saveState(issueNum, "review", { verdict: "approved", notes });
}

function isReviewApproved(issueNum: number): boolean {
  const raw = loadState<{ verdict: string }>(issueNum, "review");
  return raw?.verdict === "approved";
}

// --- main entry ---

async function runSingleIssue(
  issueNum: number,
  config: RalfConfig | null,
  repo: string,
  maxIter: number,
  statuses: Statuses,
  projectNumber: number,
): Promise<void> {
  resetSession();
  const issue = await fetchIssue(issueNum, repo);
  const ralfMd = loadRalfMd();
  const branchName = "ralf/" + issueNum;

  console.log("\n▶ Starting issue #" + issueNum + ": " + issue.title);

  ensureDevBranch(issueNum);

  if (branchExists(branchName)) {
    safeCheckout(branchName, issueNum);
    console.log("  → resumed existing branch: " + branchName);
  } else {
    git("checkout", "-b", branchName);
  }
  await setStatus(issueNum, statuses.inProgress, repo, projectNumber);
  console.log("  → branch: " + branchName + " (from dev)");
  console.log("  → status: In Progress");

  let plan = loadSavedPlan(issueNum);
  if (plan) {
    console.log("  ⊘ loaded saved plan (" + plan.behaviors.length + " behaviors)");
  } else {
    plan = await runPlanPhase(issue, ralfMd, issueNum, statuses, repo, projectNumber);
    if (!plan) return;
    savePlan(issueNum, plan);
    selectiveStage();
    try { git("commit", "-m", "plan(#" + issueNum + "): save plan to disk"); } catch { /* nothing to commit */ }
  }
  logPlan(plan);

  // Post-plan phases use condensed issue to reduce token waste
  const briefIssue = condensedIssue(issue);
  const archBrief = buildArchBrief(plan);
  const planBehaviors = plan.behaviors.map((b, i) => (i + 1) + ". " + b.name + " (" + b.type + ")").join("\n");
  await runTddSlices(briefIssue, plan, archBrief, ralfMd, config, issueNum);
  await runReviewLoop({
    issue: briefIssue,
    ralfMd,
    archBrief,
    planBehaviors,
    config,
    issueNum,
    branchName,
    maxIter,
    statuses,
    repo,
    projectNumber,
  });
}

async function runWithTimeout(
  issueNum: number,
  config: RalfConfig | null,
  repo: string,
  maxIter: number,
  statuses: Statuses,
  projectNumber: number,
  timeoutMs: number,
): Promise<void> {
  tokenTracker.startIssue(issueNum);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("ISSUE_TIMEOUT")), timeoutMs);
  });
  try {
    await Promise.race([
      runSingleIssue(issueNum, config, repo, maxIter, statuses, projectNumber),
      timeoutPromise,
    ]);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "ISSUE_TIMEOUT") {
      console.log("\n⚠ Issue #" + issueNum + " timed out after " + (timeoutMs / 60000) + " minutes");
      await setStatus(issueNum, statuses.stuck, repo, projectNumber);
      console.log("  → status: Stuck");
      return;
    }
    throw e;
  }
}

async function run(parentIssueNum: number): Promise<void> {
  console.log("\n◌ Pre-flight checks...");
  const preflight = runPreflight();
  for (const check of preflight) {
    const icon = check.ok ? "✔" : "✘";
    console.log("  " + icon + " " + check.name + ": " + check.message);
  }
  if (!preflightPassed(preflight)) {
    console.log("\n✘ Pre-flight failed. Fix the issues above and retry.");
    process.exit(1);
  }

  const { config, repo, maxIter, statuses, projectNumber, timeoutMs } = resolveConfig();

  const subIssues = await github.fetchSubIssues(parentIssueNum, repo);
  if (subIssues.length === 0) {
    console.log("\n✘ No sub-issues found for #" + parentIssueNum + ". Create sub-issues first.");
    process.exit(1);
  }

  // Filter out closed issues, then topological sort
  const openIssues = subIssues.filter((s) => s.state !== "closed");
  const skipped = subIssues.length - openIssues.length;

  let ordered;
  try {
    ordered = topologicalSort(openIssues);
  } catch (e: unknown) {
    console.log("  ⚠ " + formatError(e) + " — using original order");
    ordered = openIssues;
  }

  const parent = await fetchIssue(parentIssueNum, repo);
  console.log("\n▶ Parent issue #" + parentIssueNum + ": " + parent.title);
  if (skipped > 0) {
    console.log("  ⊘ skipping " + skipped + " already-closed issue(s)");
  }

  for (let i = 0; i < ordered.length; i++) {
    const sub = ordered[i];
    console.log("\n━━━ [" + (i + 1) + "/" + ordered.length + "] #" + sub.number + ": " + sub.title + " ━━━");
    await runWithTimeout(sub.number, config, repo, maxIter, statuses, projectNumber, timeoutMs);
  }

  console.log("\n✔ All " + ordered.length + " sub-issues processed.");
  console.log("  " + tokenTracker.formatGrandTotal());
}

// --- status ---

async function status(): Promise<void> {
  let config: RalfConfig | null = null;
  try {
    config = loadConfig();
  } catch {
    /* use defaults */
  }
  const repo = config?.repo ?? FALLBACK_REPO;
  const projectNumber = config?.projectNumber ?? FALLBACK_PROJECT_NUMBER;
  const statuses = config?.statuses ?? FALLBACK_STATUSES;

  const counts = await github.getStatusCounts(repo, projectNumber);

  console.log("\n┌─ ralf status ─────────────────┐");
  for (const statusName of [statuses.todo, statuses.inProgress, statuses.inReview, statuses.done, statuses.stuck]) {
    const count = String(counts[statusName] ?? 0).padStart(3);
    console.log("│  " + statusName.padEnd(12) + " " + count + " │");
  }
  console.log("└───────────────────────────────┘");
}

// --- cli ---

const [cmd, arg] = process.argv.slice(2);

try {
  if (cmd === "run" && arg) {
    await run(Number.parseInt(arg.replace("#", ""), 10));
  } else if (cmd === "status") {
    await status();
  } else {
    console.log("Usage:");
    console.log("  ralf run <issue-number>");
    console.log("  ralf status");
  }
} catch (e: unknown) {
  console.error("\n✘ Fatal error: " + formatError(e));
  process.exit(1);
}
