# ralf

A CLI tool that orchestrates AI agents through a deterministic TDD development loop. Takes a GitHub issue and turns it into tested, reviewed, merged code — autonomously.

## How it works

Ralf processes one GitHub issue at a time through a strict pipeline:

```
Plan → RED → GREEN → commit → RED → GREEN → commit → ... → Review → Merge
```

1. **Plan** — An agent reads the issue, researches relevant docs, explores the codebase, and outputs a list of behaviors to implement as vertical slices.

2. **RED** (per behavior) — An agent writes exactly one failing test. The CLI runs checks — the test *must fail* (RED Gate). If it passes, something is wrong and the agent retries.

3. **GREEN** (per behavior) — An agent writes the minimal implementation to make the test pass. The CLI runs all checks — everything *must pass* (GREEN Gate). On success, changes are committed.

4. **Review** — An agent reviews the full diff. It can only approve or reject with specific fix items. It never writes code.

5. **Merge** — On approval, the feature branch is merged into `dev` and the issue is closed.

If the review returns NEEDS_FIXES, a targeted GREEN-FIX call addresses only the flagged items (not a full re-implementation). After 3 failed iterations, the issue is marked `stuck`.

## Usage

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` in PATH)
- [GitHub CLI](https://cli.github.com/) (`gh` in PATH, authenticated)
- A GitHub repo with issues labeled `todo`

### Install

```bash
cd ralf
npm install
```

### Run a single issue

```bash
tsx ralf.ts run 42
```

This will:
- Run pre-flight checks (git, gh, claude)
- Load config from `.ralf/config.json` (or use defaults)
- Create branch `ralf/42` from `dev`
- Run the full Plan → RED/GREEN → Review pipeline
- Merge to `dev` on approval, or mark `stuck` after 3 iterations

### Check status

```bash
tsx ralf.ts status
```

Shows issue counts per label (todo, in-progress, in-review, done, stuck).

## Configuration

Create `.ralf/config.json` in the target project:

```json
{
  "repo": "YourOrg/your-repo",
  "checks": [
    { "name": "typecheck", "command": "pnpm typecheck" },
    { "name": "lint", "command": "pnpm lint" },
    { "name": "test", "command": "pnpm test" }
  ],
  "maxIterationsPerIssue": 3,
  "labels": {
    "todo": "todo",
    "inProgress": "in-progress",
    "inReview": "in-review",
    "done": "done",
    "stuck": "stuck"
  }
}
```

Without a config file, ralf defaults to `Teqvention/ralf` as repo and `pnpm typecheck/lint/test` as checks.

## Customizing prompts

Prompt templates live in `prompts/` (built-in) and can be overridden per-project by placing files in `.ralf/prompts/`:

| File | Phase | Purpose |
|------|-------|---------|
| `plan.md` | Plan | Research, explore codebase, output behavior list |
| `red.md` | RED | Write one failing test for a behavior |
| `green.md` | GREEN | Implement minimal code to pass the test |
| `green-fix.md` | GREEN-FIX | Fix specific review items (NEEDS_FIXES) |
| `review.md` | Review | Approve or reject with actionable feedback |

Templates use `{{VAR}}` placeholders (e.g. `{{ISSUE_TITLE}}`, `{{ARCH_BRIEF}}`). To customize, copy a template to `.ralf/prompts/` and edit it — ralf checks there first before falling back to built-in.

You can also create `.ralf/RALF.md` with project-specific context (stack conventions, coding rules, documentation URLs). This gets injected into every prompt as `{{RALF_MD}}`.

## Crash recovery

If ralf crashes mid-run (e.g. at behavior 3 of 5), behaviors 1-2 are already committed. On restart, ralf detects existing commits via `git log --grep` and skips completed behaviors. It also reuses existing feature branches instead of failing on branch creation.

## Git strategy

- Works on `dev` branch, never `main`
- Feature branch per issue (`ralf/42`) created from `dev`
- Commits after each GREEN Gate with `feat(#42): behavior name`
- Selective staging (`git add -u` + source dirs only, never `git add -A`)
- Auto-merges to `dev` after approved review
- Stuck issues keep their branch for manual inspection

## Running tests

```bash
npm test
```

74 tests covering validation, config, prompt loading, preflight checks, crash recovery, and git operations (using real temp repos).
