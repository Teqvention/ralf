# Ralf MVP — Bootstrap

## Context

Minimal ralf that processes ONE GitHub issue through Plan→RED→GREEN→Review. Used to build the real ralf from its own PRD (Teqvention/ralf#1). One file. No abstractions.

## The Script

`ralf.ts` — a single executable TypeScript file. ~200 lines. Run with `tsx ralf.ts run 42`.

```
tsx ralf.ts run 42   → Plan → RED → GREEN → Review → Merge
tsx ralf.ts status   → Issue counts
```

No npm package, no bin entry, no config system, no prompt templates. Everything inline or hardcoded. Just get the loop working.

## What It Does

1. Fetch issue #42 from GitHub via `gh issue view 42 --json title,body`
2. Create branch `ralf/42`, label `in-progress`
3. **Plan**: `claude --print -p "..."` → parse `<result>` for behaviors
4. **RED per behavior**: Agent writes test → run `pnpm test` → must FAIL
5. **GREEN per behavior**: Agent implements → run checks → must PASS → `git commit`
6. **Review**: Agent reviews diff → APPROVED → merge to main, or NEEDS_FIXES → loop
7. Stuck after 3 iterations → label `stuck`

## Key Details

- Agent: `claude --print --dangerously-skip-permissions -p "prompt"` (plain text output, not NDJSON)
- Sentinel: regex `<result>([\s\S]*?)<\/result>` from stdout
- No token tracking, no question handling, no HITL pauses (just runs)
- Checks: hardcoded `pnpm typecheck && pnpm lint && pnpm test`
- Git: direct `execa('git', [...])` and `execa('gh', [...])`
- Prompts: inline template strings in the script, no files
- Config: hardcoded `repo: 'Teqvention/ralf'`, `maxIterations: 3`

## Inline Prompts (embedded in the script)

**Plan prompt**: "You are analyzing GitHub issue #N. Read the issue and codebase. Output behaviors to test as `<result>{"status":"plan","behaviors":[{"name":"...","type":"unit|e2e"}]}</result>`"

**Red prompt**: "Write ONE failing test for: [behavior]. Output `<result>{"status":"complete","testFiles":["..."]}</result>`"

**Green prompt**: "Implement minimal code to pass the test. Previous errors: [errors]. Output `<result>{"status":"complete","filesChanged":["..."]}</result>`"

**Review prompt**: "Review this diff: [diff]. Output `<result>{"verdict":"approved|needs_fixes","fixItems?":["..."]}</result>`"

Each prompt gets the issue title+body and a RALF.md string (hardcoded or read from `.ralf/RALF.md` if it exists).

## Implementation

One step. Write `ralf.ts`. That's it.

```typescript
#!/usr/bin/env tsx
import { execaSync, execa } from 'execa'

const REPO = 'Teqvention/ralf'
const MAX_ITER = 3
const CHECKS = ['pnpm typecheck', 'pnpm lint', 'pnpm test']

// --- helpers ---

function claude(prompt: string): string {
  const { stdout } = execaSync('claude', ['--print', '--dangerously-skip-permissions', '-p', prompt])
  return stdout
}

function parseResult(output: string): any {
  const match = output.match(/<result>([\s\S]*?)<\/result>/)
  return match ? JSON.parse(match[1]) : null
}

function gh(...args: string[]) { return execaSync('gh', args).stdout }
function git(...args: string[]) { return execaSync('git', args).stdout }

function runChecks(): { ok: boolean; errors: string } {
  for (const cmd of CHECKS) {
    try { execaSync(cmd, { shell: true }) }
    catch (e: any) { return { ok: false, errors: `${cmd}: ${e.stderr}` } }
  }
  return { ok: true, errors: '' }
}

function fetchIssue(n: number) {
  return JSON.parse(gh('issue', 'view', String(n), '--repo', REPO, '--json', 'title,body'))
}

function setLabel(n: number, label: string) {
  try { gh('issue', 'edit', String(n), '--repo', REPO, '--remove-label', 'todo,in-progress,in-review,stuck', '--add-label', label) } catch {}
}

// --- main loop ---

async function run(issueNum: number) {
  const issue = fetchIssue(issueNum)
  const ralfMd = existsSync('.ralf/RALF.md') ? readFileSync('.ralf/RALF.md', 'utf-8') : ''
  
  git('checkout', '-b', `ralf/${issueNum}`)
  setLabel(issueNum, 'in-progress')
  
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    console.log(`\n─── #${issueNum} iter ${iter}/${MAX_ITER} ───`)
    
    // PLAN
    const planOut = claude(`Analyze this issue and plan TDD behaviors.\n\nIssue: ${issue.title}\n${issue.body}\n\nContext:\n${ralfMd}\n\nOutput: <result>{"status":"plan","behaviors":[{"name":"...","type":"unit|e2e"}]}</result>`)
    const plan = parseResult(planOut)
    console.log('Plan:', plan.behaviors.map(b => b.name))
    
    // RED + GREEN per behavior
    for (const behavior of plan.behaviors) {
      // RED
      console.log(`\n◌ red: ${behavior.name}`)
      const redOut = claude(`Write ONE failing test for: ${behavior.name}\n\nIssue: ${issue.title}\n${issue.body}\n\nContext:\n${ralfMd}\n\nOutput: <result>{"status":"complete","testFiles":["..."]}</result>`)
      const red = parseResult(redOut)
      
      const testCheck = runChecks()
      if (testCheck.ok) { console.log('⚠ RED Gate fail — test passed'); continue }
      console.log('✔ RED Gate — test fails')
      
      // GREEN
      console.log(`◌ green: ${behavior.name}`)
      let errors = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        const greenOut = claude(`Implement minimal code for: ${behavior.name}\n\nIssue: ${issue.title}\n${issue.body}\n\nContext:\n${ralfMd}\n${errors ? `\nFix these errors:\n${errors}` : ''}\n\nOutput: <result>{"status":"complete","filesChanged":["..."]}</result>`)
        
        const checks = runChecks()
        if (checks.ok) {
          git('add', '-A')
          git('commit', '-m', `feat(#${issueNum}): ${behavior.name}`)
          console.log('✔ GREEN Gate — committed')
          break
        }
        errors = checks.errors
        console.log('⚠ GREEN Gate fail, retrying...')
      }
    }
    
    // REVIEW
    const diff = git('diff', 'main...HEAD')
    const reviewOut = claude(`Review these changes.\n\nIssue: ${issue.title}\n${issue.body}\n\nDiff:\n${diff}\n\nContext:\n${ralfMd}\n\nOutput: <result>{"verdict":"approved|needs_fixes","fixItems?":["..."]}</result>`)
    const review = parseResult(reviewOut)
    
    if (review.verdict === 'approved') {
      git('checkout', 'main')
      git('merge', `ralf/${issueNum}`)
      git('branch', '-d', `ralf/${issueNum}`)
      setLabel(issueNum, 'done')
      gh('issue', 'close', String(issueNum), '--repo', REPO)
      console.log(`✔ #${issueNum} merged`)
      return
    }
    
    console.log('✘ NEEDS_FIXES:', review.fixItems)
  }
  
  setLabel(issueNum, 'stuck')
  console.log(`⚠ #${issueNum} stuck`)
}

// --- cli ---
const [cmd, arg] = process.argv.slice(2)
if (cmd === 'run') run(parseInt(arg.replace('#', '')))
else if (cmd === 'status') {
  for (const label of ['todo', 'in-progress', 'in-review', 'done', 'stuck']) {
    const count = JSON.parse(gh('issue', 'list', '--repo', REPO, '--label', label, '--json', 'number')).length
    console.log(`${label}: ${count}`)
  }
}
else console.log('Usage: tsx ralf.ts <run N | status>')
```

## Verification

- [ ] `tsx ralf.ts run 2` creates branch, plans, writes tests, implements, reviews, merges
- [ ] RED Gate catches passing tests
- [ ] GREEN Gate catches failing checks, retries with errors
- [ ] NEEDS_FIXES loops back
- [ ] Stuck after 3 iterations
- [ ] `tsx ralf.ts status` shows counts

---
---

# FULL PLAN (reference — see Teqvention/ralf#1 for the complete PRD)

# Ralph: Multi-Agent TDD Development Orchestrator

## Context

Ralph is a standalone CLI tool (npm package) that orchestrates AI agents through a deterministic TDD development loop. Agents write code and make decisions; the CLI executes all side-effects (GitHub, tests, linting). GitHub is the single source of truth. Agents run in Docker sandboxes.

---

## Architecture Overview

```
ralf init     → Interview → PRD → GitHub Issues
ralf run      → TDD Agent (red-green per slice) → Review Agent → Done
ralf status   → Info card from GitHub state
ralf finish   → Distill Agent → knowledge.md
```

### Inner Loop (Single Issue) — 4 Agent Units

```
CLI: Pick issue (priority sort) → move to In Progress

═══ 1. PLAN (single call) ════════════════════════
Agent analyzes issue, plans behaviors → CLI shows plan (HITL: approve)

═══ 2+3. RED/GREEN ALTERNATING (vertical slices) ═══
Two sessions (RED + GREEN) that alternate per behavior:

  RED  call 1: "Write test for behavior 1"    (RED session starts)
    → CLI: run test → MUST FAIL (RED Gate)
  GREEN call 1: "Implement behavior 1"         (GREEN session starts)
    → CLI: run checks → MUST PASS (GREEN Gate) → commit

  RED  call 2: "Write test for behavior 2"    (--resume RED session)
    → CLI: run test → MUST FAIL (RED Gate)
  GREEN call 2: "Implement behavior 2"         (--resume GREEN session)
    → CLI: run checks → MUST PASS (GREEN Gate) → commit

  ... repeat for all behaviors including E2E ...

Each agent maintains its session context via --resume. RED knows all
previous tests it wrote. GREEN knows all previous implementations.
But the TDD discipline is vertical: test → implement → test → implement.

═══ 4. REVIEW (single call) ══════════════════════
Review Agent reviews everything (code + tests + TDD discipline)
  → APPROVED: move to Done
  → NEEDS_FIXES: back to In Progress, re-iterate from GREEN session
```

### Session Continuation via `--resume`

```bash
# Behavior 1: RED then GREEN
claude -p "Write test for behavior 1..." --output-format json --bare --dangerously-skip-permissions
# → RED_SESSION_ID from response

claude -p "Implement behavior 1..." --output-format json --bare --dangerously-skip-permissions
# → GREEN_SESSION_ID from response

# Behavior 2: resume both sessions
claude -p "Write test for behavior 2..." --resume $RED_SESSION_ID --output-format json --bare --dangerously-skip-permissions
# → RED agent has context of test 1

claude -p "Implement behavior 2..." --resume $GREEN_SESSION_ID --output-format json --bare --dangerously-skip-permissions
# → GREEN agent has context of impl 1
```

---

## Resolved Design Decisions

| Decision | Answer |
|----------|--------|
| Determinism | Structured output contracts. CLI validates + executes side-effects |
| Scope | Generic tool, configured per project via `.ralf/` |
| Distribution | Standalone npm package, own GitHub repo, npm link for dev |
| Issue selection | Pure CLI logic (priority labels), no agent |
| TDD approach | Vertical slices: RED→GREEN alternating per behavior. Two persistent sessions (RED + GREEN) that alternate |
| Multi-turn | `--resume` with session-id. RED session + GREEN session, alternating per behavior. Each maintains full context |
| Slice count | Agent decides in planning call, includes E2E |
| RED Gate | Per-slice: CLI runs only new test, must fail |
| GREEN Gate | Per-slice: CLI runs all checks + tests, must pass |
| Review | One Review Agent, runtime configurable (claude/codex) |
| Review failure | NEEDS_FIXES → re-run GREEN only (tests already exist). Plan is NOT re-run |
| Agent runtime | Per-step configurable: `{ tdd: 'claude', review: 'codex' }`. 1:1 adapter normalizes both CLIs behind `AgentAdapter` interface |
| Claude flags | `-p`, `--bare`, `--dangerously-skip-permissions`, `--output-format json`, `--resume $ID`, `--max-turns 50` |
| Codex flags | `exec "prompt"`, `--yolo`, `--json` (JSONL), `exec resume $THREAD_ID "prompt"` |
| Auth mounting | Docker: `~/.claude/:rw` + `~/.codex/:rw` + `CODEX_API_KEY` env var |
| Docker | Agents run in Docker sandbox, image built by `ralf init` |
| Auth | Max 20x Plan (OAuth). Mount `~/.claude:/root/.claude:rw` into container (rw for session persistence). API key fallback |
| Git: commits | CLI commits after each GREEN Gate. Agent never touches git |
| Git: branches | Work on `dev` branch, never main. Feature-branch per issue (`ralf/#42-add-auth`) from dev. Auto-merge into dev after APPROVED. PR from dev→main when ralf completes |
| Git: stuck | Branch stays, issue gets 'stuck' label. Ralf halts + notifies, waits for user input |
| Git: PRs | No PRs per issue. Auto-merge to dev. One PR from dev→main when ralf finishes or user triggers it |
| Token tracking | Per-issue + per-phase + grand total |
| Kanban | Todo → In Progress → In Review → Done |
| Labels | Label-based (no GitHub Projects V2) |
| Resume | GitHub state only (no local checkpoint) |
| Notifications | System notification + sound on completion/stuck |
| Init UX | Organic agent-driven interview. No script, no prescribed questions. Agent explores codebase first, asks what it doesn't understand, follows up on surprises |
| Init: user input | User can give freeform input anytime (not just when asked). Agent processes both answer + unsolicited context |
| Init: PRD trigger | Agent NEVER auto-generates PRD. Agent can signal `<ready>` ("I think I have enough"). User types 'go' or '/prd' to trigger PRD generation. User can keep adding input after `<ready>` |
| Prompts | RALF.md = project rules, prompt files = phase rules |
| Test context | RALF.md + code exploration |
| Sentinels | JSON in `<result>` tags |
| Logs | Markdown with YAML frontmatter (agent output + metadata) |
| Colors | Cyan (active), green (success), yellow (warning), red (error), dim (secondary) |
| Error: agent crash | Retry 1x, then HITL |
| Error: rate limit | Wait + countdown timer |
| Error: max iterations | Stop + notify + wait for user input (even in auto mode). No skipping |
| Error: GitHub API | Retry with backoff, warn + continue |
| Config location | `.ralf/` directory in project root |
| Stack context | `.ralf/RALF.md` injected into all prompts |
| Flow mode | No pauses on happy path. Auto-flows through Plan→RED→GREEN→Review→Merge. Pauses ONLY on: agent question, gate failure, stuck, crash. User presses Enter anytime to interrupt |
| Interrupt | Enter/Space pauses after current step. Menu: Continue, Give input, Skip issue, Stop ralf |
| Mid-flow input | User can inject freetext anytime via interrupt. Input queued for next --resume call |
| Plan approval | Plan shown with 5s auto-approve countdown. Enter to review/edit. No countdown = auto-approve |
| Adaptive | No. Deterministic. Same behavior for issue 1 and issue 12. Change config to change behavior |
| Output collapse | Completed issues collapse to one line. Only current issue shows full detail |
| Dependencies | `depends-on: #3` in issue body. Ralf sorts topologically, then by priority |
| Selective run | `ralf run` = all todo. `ralf run #42` = single issue. `ralf run #42 #43` = specific set |
| Revert | `ralf revert #5` = git revert all commits, label → todo, branch deleted |
| Empty repo | Agent detects no code, switches to greenfield interview (more architecture questions) |
| Lock | .ralf/.lock prevents concurrent runs. `ralf run --force` to override |
| Issue timeout | Configurable per-issue timeout (default: 30min). After timeout → stuck |
| Agent questions | All agents can ask on issue ambiguity. Max 2 halts/session, multi-question per halt |
| Question sentinel | `<questions>` tag with JSON array. Options + "Other" freetext. Context field (dimmed) |
| Question UX | Sequential flow inside one box, answered Qs stay visible, select + Other like Claude Code |
| Question in AFK | System notification, terminal waits. Flow pauses completely |
| Question logging | Logged to progress.txt + session log. Feeds into knowledge.md distill |
| Question --resume | Answer injected via `--resume $SID -p "User answered: ..."` |
| Review Q&A | Review agent can change verdict after receiving user answers |
| Testing | MockRuntime + fixtures (zero tokens). Snapshot tests for UI. Mock GitHub client |
| Dry-run | `ralf run --dry-run` — full UX with MockRuntime, no tokens |
| Recording | `ralf run --record` saves real responses as fixtures (later) |
| Fixture format | Session-chain JSON: array of prompt→events pairs per session |
| Distill | Runs once via `ralf finish` |

---

## `.ralf/` Directory (in target projects)

```
.ralf/
├── config.ts          # required — repo, checks, labels, agents, maxIterations
├── RALF.md           # stack context injected into all agent prompts
├── Dockerfile         # auto-generated by ralf init
├── knowledge.md       # auto-generated by ralf finish
├── progress.txt       # append-only per-feature log, cleared by ralf finish
├── prompts/           # scaffolded by ralf init, user edits directly
│   ├── init.md        # interview prompt (grill-me style)
│   ├── plan.md        # TDD behavior planning (single call)
│   ├── red.md         # RED session start prompt
│   ├── red-continue.md  # RED session continuation template
│   ├── green.md       # GREEN session start prompt
│   ├── green-continue.md  # GREEN session continuation template
│   └── review.md      # review agent prompt
└── logs/              # timestamped logs per iteration+phase
    └── 2026-04-01T10-30-00_issue42_iter1_red-session.md
```

---

## Config Schema

```typescript
// .ralf/config.ts
import { defineConfig } from 'ralf'

export default defineConfig({
  repo: 'Teqvention/user-flow',

  labels: {
    todo: 'todo',
    inProgress: 'in-progress',
    inReview: 'in-review',
    done: 'done',
  },

  checks: [
    { name: 'typecheck', command: 'pnpm typecheck' },
    { name: 'lint',      command: 'pnpm lint' },
    { name: 'test',      command: 'pnpm test' },
  ],

  agents: {
    tdd:    { runtime: 'claude' },
    review: { runtime: 'codex' },
  },

  maxIterationsPerIssue: 3,

  hitlPauses: ['after-plan', 'after-tdd', 'after-review'],
  // remove entries to skip pauses, e.g. ['after-review'] only
})
```

---

## Structured Output Protocol

### Agent → CLI: Result sentinel

```xml
<result>
{
  "status": "complete" | "needs_fixes",
  "summary": "...",
  "filesChanged": ["src/auth/login.ts"],
  "testFiles": ["tests/auth/login.test.ts"],
  "commit": "abc1234",
  "fixItems": ["..."]
}
</result>
```

### Agent → CLI: TDD Plan

```xml
<result>
{
  "status": "plan",
  "behaviors": [
    { "name": "User can login with credentials", "type": "unit" },
    { "name": "Invalid password returns 401", "type": "unit" },
    { "name": "Full login → dashboard flow", "type": "e2e" }
  ],
  "totalSlices": 3
}
</result>
```

### Init Agent → CLI: Questions

```xml
<!-- Freitext -->
<ask>Describe your target audience</ask>

<!-- Multiple-Choice -->
<select>
{
  "question": "Which auth method?",
  "options": ["JWT tokens", "Session-based", "OAuth only"],
  "recommended": 0
}
</select>
```

### Agent → CLI: Questions (during RED/GREEN/Review sessions)

```xml
<questions>
[
  {
    "text": "Issue mentions OAuth but AC only covers email/password. Implement OAuth?",
    "options": ["Skip OAuth", "Add OAuth scaffolding", "Full OAuth implementation"],
    "context": "Found 'OAuth' in issue description line 3 but no AC checkbox for it"
  },
  {
    "text": "Session storage preference?",
    "options": ["Redis", "Database table", "In-memory"],
    "context": "Not specified in RALF.md or issue"
  }
]
</questions>
```

Rules:
- Max 2 question halts per session (each halt can contain multiple questions)
- Every question gets an implicit "Other" freetext option (like Claude Code)
- `context` field rendered as dimmed text above questions
- Questions rendered sequentially (flow), answered Qs stay visible with checkmark
- Answers logged to progress.txt + session log
- Answer fed back via `--resume $SID -p "User answered: Q1=Skip OAuth, Q2=Redis"`

---

## Agent Runtime Abstraction

A 1:1 adapter normalizes Claude Code CLI and Codex CLI behind one interface. The rest of ralf sees no difference.

### Adapter Interface

```typescript
interface AgentAdapter {
  name: 'claude' | 'codex' | 'mock'
  run(prompt: string): Promise<AgentResult>
  continue(sessionId: string, prompt: string): Promise<AgentResult>
}

interface AgentResult {
  output: string            // full text output from agent
  sessionId: string         // for session continuation
  tokensIn: number
  tokensOut: number
  duration: number
}

function createAdapter(runtime: 'claude' | 'codex' | 'mock', config: RuntimeConfig): AgentAdapter
```

Sentinel extraction (`<result>` regex) happens AFTER the adapter — identical for both runtimes.

### Claude Code Adapter

```typescript
class ClaudeAdapter implements AgentAdapter {
  name = 'claude' as const

  async run(prompt: string): Promise<AgentResult> {
    const start = Date.now()
    const { stdout } = await execa('claude', [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--output-format', 'json',      // single JSON result (not streaming)
      '--bare',                         // skip CLAUDE.md, only our prompt
      '--max-turns', '50',
    ])
    const json = JSON.parse(stdout)
    return {
      output: json.result,
      sessionId: json.session_id,
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
      duration: Date.now() - start,
    }
  }

  async continue(sessionId: string, prompt: string): Promise<AgentResult> {
    const start = Date.now()
    const { stdout } = await execa('claude', [
      '-p', prompt,
      '--resume', sessionId,
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '--bare',
    ])
    const json = JSON.parse(stdout)
    return {
      output: json.result,
      sessionId: json.session_id,
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
      duration: Date.now() - start,
    }
  }
}
```

Key flags:
- `--bare`: Skip CLAUDE.md auto-discovery, only our injected prompt
- `--output-format json`: Single JSON response with `result`, `session_id`, `usage`
- `--max-turns 50`: Prevent runaway agents
- `--dangerously-skip-permissions`: Auto-approve all tool use
- `--resume $ID`: Continue a previous session

### Codex Adapter

```typescript
class CodexAdapter implements AgentAdapter {
  name = 'codex' as const

  async run(prompt: string): Promise<AgentResult> {
    const start = Date.now()
    const { stdout } = await execa('codex', [
      'exec', '--yolo', '--json', prompt,
    ])
    return this.parseJsonlOutput(stdout, start)
  }

  async continue(sessionId: string, prompt: string): Promise<AgentResult> {
    const start = Date.now()
    const { stdout } = await execa('codex', [
      'exec', 'resume', sessionId, '--yolo', '--json', prompt,
    ])
    return this.parseJsonlOutput(stdout, start)
  }

  private parseJsonlOutput(stdout: string, start: number): AgentResult {
    const events = stdout.split('\n').filter(Boolean).map(l => JSON.parse(l))
    const threadId = events.find(e => e.type === 'thread.started')?.thread_id ?? ''
    const usage = events.find(e => e.type === 'turn.completed')?.usage
    const text = events
      .filter(e => e.type === 'item.completed' && e.item.item_type === 'agent_message')
      .pop()?.item.text ?? ''
    return {
      output: text,
      sessionId: threadId,
      tokensIn: (usage?.input_tokens ?? 0) + (usage?.cached_input_tokens ?? 0),
      tokensOut: usage?.output_tokens ?? 0,
      duration: Date.now() - start,
    }
  }
}
```

Key differences from Claude:
- No `-p` flag — prompt is positional argument
- `--yolo` instead of `--dangerously-skip-permissions`
- `--json` emits JSONL (one event per line), not single JSON
- Session continuation via `codex exec resume $THREAD_ID "prompt"`
- `thread_id` instead of `session_id`
- Progress goes to stderr, result to stdout
- Token usage in `turn.completed` events

### MockAdapter (for testing)

```typescript
class MockAdapter implements AgentAdapter {
  name = 'mock' as const
  private callIndex = 0

  constructor(private fixtures: FixtureChain) {}

  async run(prompt: string): Promise<AgentResult> {
    return this.nextFixture()
  }

  async continue(sessionId: string, prompt: string): Promise<AgentResult> {
    return this.nextFixture()
  }

  private nextFixture(): AgentResult {
    const fixture = this.fixtures.chain[this.callIndex++]
    return {
      output: fixture.output,
      sessionId: this.fixtures.sessionId,
      tokensIn: fixture.tokensIn ?? 0,
      tokensOut: fixture.tokensOut ?? 0,
      duration: fixture.duration ?? 100,
    }
  }
}
```

### CLI Comparison Table

| Capability | Claude Code | Codex CLI |
|---|---|---|
| Non-interactive | `claude -p "prompt"` | `codex exec "prompt"` |
| Skip permissions | `--dangerously-skip-permissions` | `--yolo` |
| JSON output | `--output-format json` (single JSON) | `--json` (JSONL events) |
| Streaming | `--output-format stream-json --verbose` | `--json` (streams by default) |
| Session continue | `--resume $SESSION_ID` | `codex exec resume $THREAD_ID "prompt"` |
| Auth env var | `ANTHROPIC_API_KEY` | `CODEX_API_KEY` |
| Auth dir | `~/.claude/` | `~/.codex/` |
| Model | `--model sonnet` | Config in `~/.codex/config.toml` |
| Max turns | `--max-turns 10` | N/A |
| System prompt | `--append-system-prompt "text"` | In prompt body |
| Bare mode | `--bare` (skip CLAUDE.md) | N/A |
| Sandbox levels | 2 (default, bypassPermissions) | 3 (read-only, workspace-write, danger-full-access) |
| Tool access | Read, Edit, Bash, Grep, Glob, WebFetch, WebSearch | Shell, file read/write, web search |
| Output routing | All on stdout | Progress stderr, result stdout |
| Session ID field | `session_id` | `thread_id` |
| Built-in review | N/A | `codex exec review --base main` |

### Docker Integration

Both CLIs need auth mounted into the container:

```bash
docker run --rm \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude:rw \     # Claude auth + sessions
  -v ~/.codex:/root/.codex:rw \       # Codex auth + sessions
  -e CODEX_API_KEY \                   # Codex API key fallback
  ralf-sandbox \
  claude -p ...                        # or: codex exec ...
```

---

## Docker Sandbox

```dockerfile
# Auto-generated by ralf init based on config
FROM node:22-slim
RUN npm i -g pnpm @anthropic-ai/claude-code @openai/codex
RUN apt-get update && apt-get install -y git gh
WORKDIR /workspace
# Both CLIs installed — adapter selects which one to invoke
# Auth mounted at runtime: ~/.claude/:rw and ~/.codex/:rw
```

Agent invocation (Claude):
```bash
docker run --rm \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude:rw \
  ralf-sandbox \
  claude -p "prompt" --dangerously-skip-permissions --bare --output-format json
```

Agent invocation (Codex):
```bash
docker run --rm \
  -v $(pwd):/workspace \
  -v ~/.codex:/root/.codex:rw \
  -e CODEX_API_KEY \
  ralf-sandbox \
  codex exec --yolo --json "prompt"
```

---

## CLI UX Specifications

### `ralf init`

The init interview is a **conversation, not a form**. The agent drives dynamically — no scripted questions. User has a permanent input field and can type anytime (even unsolicited). Agent never auto-generates the PRD; user types `go` to trigger it.

```
  ███▀▀███ ████████ ███     ███▀▀███ ███  ███
  ███▄▄███ ████████ ███     ███▀▀▀▀  ███████
  ███  ███ ███  ███ ██████ ███     ███  ███

  Project initialization
  Type 'go' when ready to generate the PRD.

  ▶ Exploring codebase...

  (agent dimmed: scanning files, package.json, schema...)
  I see a Next.js 16 project with tRPC and
  Drizzle ORM. 3 tables in the schema...

  ┌──────────────────────────────────┐      ← <ask> detected
  │  What problem does this solve        │
  │  for your users?                     │
  └──────────────────────────────────┘
  ▸ Newsletter trend monitoring for _

  (agent follows up based on answer...)
  Interesting — so users subscribe to see
  trending topics. Let me look at the
  existing newsletter logic...

  ┌──────────────────────────────────┐      ← <select> detected
  │  Which deployment target?            │
  └──────────────────────────────────┘
  › ● Vercel
    ○ Dokploy on Hetzner
    ○ Docker Compose
    ○ Other: ___

  (user types unsolicited input while agent streams)
  (agent streaming dimmed...)
  Looking at the auth middleware...

  ▸ btw wir brauchen auch rate limiting
    für die API, und die agents sollen
    in Docker laufen

  (agent picks up BOTH topics in next response)
  Got it — rate limiting for the API and
  Docker sandboxing for agents. Let me
  ask about the rate limiting approach...

  (more organic back-and-forth...)

  ✔ I think I have a solid picture.
    Type 'go' to generate the PRD,
    or keep adding context.

  ▸ actually, one more thing about caching...

  (agent follows up on caching...)

  ▸ ok go

  ◌ Generating PRD...

  ✔ PRD created (2m 15s)

  ┌─ PRD ─────────────────────────────┐
  │  Issue:   #1 User Flow PRD             │
  │  Stories: 14 user stories              │
  │  Modules: 5 modules identified         │
  │  Link:    github.com/Teq.../issues/1   │
  └──────────────────────────────────┘

  ◌ Creating issues from PRD...

    ✔ #2  Setup auth middleware        (p0)
    ✔ #3  User registration flow       (p0)
    ✔ #4  Login/logout endpoints        (p0)
    ✔ #5  Session management            (p1)
    ◌ #6  Dashboard layout...           (p1)
    · #7  Profile settings              (p1)
    · #8  Admin panel                   (p2)

    5/8 created

  ✔ Init complete. 8 issues created.
```

**Init UX Rules:**
- Permanent input field (`▸`) always visible at bottom
- Agent streams dimmed text; questions are highlighted boxes
- `<ask>` = freetext, `<select>` = options with implicit "Other: ___"
- User input while agent streams → queued, processed after agent pauses
- Long agent explanations (>5 lines) collapsed: `[▸ more]`
- Agent signals `<ready>` when it thinks it has enough — just a hint, not a trigger
- User types `go` to trigger PRD generation — this is the ONLY trigger
- User can keep adding context after `<ready>` indefinitely

### `ralf run`

```
  ◌ Pre-flight checks...

  ┌─ Pre-flight ───────────────────────┐
  │  ✔ .ralf/config.ts valid            │
  │  ✔ gh authenticated                 │
  │  ✔ Docker running (auto-started)    │
  │  ✔ ralf-sandbox image up to date    │
  │  ✔ 12 issues with 'todo' label      │
  └───────────────────────────────────┘

  ┌─ ralf run ────────────────────────┐
  │  Repo:     Teqvention/user-flow       │
  │  Mode:     auto (AFK)                 │
  │  Runtime:  claude (codex for review)  │
  │  Max iter: 3 per issue                │
  │  Docker:   ralf-sandbox:latest       │
  │                                        │
  │  Next:     #42 Add auth flow (p0)     │
  │  Queue:    11 issues remaining         │
  └───────────────────────────────────┘

  ▶ Starting issue #42...

  ─── Issue #42 ─ Iteration 1/3 ─────────────
    → branch: ralf/#42-add-auth
    → label: todo → in-progress

  ┌─ plan #42: Add auth flow ──────────┐
  │  ◌ 0m 34s │ Analyzing requirements... │
  ├─────────┴──────────────────────────┤
  │  Read src/lib/auth/...                │
  │  Grep 'session' in src/              │
  └───────────────────────────────────┘

  ✔ plan (0m 52s)

  ┌─ TDD Plan ────────────────────────┐
  │  1. User can login with credentials  │
  │  2. Invalid password returns 401      │
  │  3. Session persists across requests  │
  │  4. Logout clears session             │
  │  E2E: Full login → dashboard flow    │
  │  Slices: 5 (4 unit + 1 e2e)          │
  └──────────────────────────────────┘

  Auto-approving in 5s... (Enter to review)
  [========>     ] 3s

  ── Slice 1/5: User can login ────────

  ┌─ red ─────────────────────────────┐
  │  ◌ 0m 28s │ Writing test...         │
  ├─────────┴─────────────────────────┤
  │  Write tests/auth/login.test.ts      │
  └──────────────────────────────────┘

  ✔ red (0m 28s)

  ┌─ RED Gate ────────────────────────┐
  │  ✔ login.test.ts:can login  FAIL ✔   │
  │  Test correctly fails (no impl yet) │
  └─────────────────────────────────┘

  ┌─ green ───────────────────────────┐
  │  ◌ 1m 42s │ Implementing...        │
  ├─────────┴────────────────────────┤
  │  Edit src/auth/login.ts              │
  │  Edit src/auth/session.ts            │
  └─────────────────────────────────┘

  ✔ green (1m 42s)

  ┌─ Checks ──────────────────────────┐
  │  ✔ typecheck               0.8s      │
  │  ✔ lint                    1.2s      │
  │  ✔ test (login.test.ts)    0.3s      │
  └──────────────────────────────────┘

  ✔ Slice 1/5 complete
    → committed: feat(#42): login behavior

  ── Slice 2/5: Invalid password ──────
  ...

  ═══ E2E: Full login → dashboard ════════

  ┌─ e2e ────────────────────────────┐
  │  ◌ 1m 05s │ Writing E2E test...   │
  └─────────────────────────────────┘

  ...

  ✔ TDD complete (8m 42s)

  ┌─ TDD Summary ─────────────────────┐
  │  Slices:   5/5 complete              │
  │  Tests:    4 unit + 1 e2e            │
  │  Files:    6 created, 3 modified     │
  │  Retries:  1 (lint fix in slice 2)   │
  │  Tokens:   62k in / 14k out          │
  └─────────────────────────────────┘

  ◌ review — starting...

  ┌─ review #42: Add auth flow ────────┐
  │  ◌ 2m 14s │ Reviewing code...       │
  ├─────────┴──────────────────────────┤
  │  Read src/auth/login.ts               │
  │  Read tests/auth/login.test.ts        │
  └───────────────────────────────────┘

  ✔ review (2m 14s)

  ┌─ Review ──────────────────────────┐
  │  Verdict:  APPROVED ✔                │
  │  Notes:    Clean TDD, good coverage  │
  └──────────────────────────────────┘

  ✔ Issue #42 complete → Done
    → merged ralf/#42-add-auth → main
    → closed #42
    → label: in-review → done

  ┌─ Token Usage: #42 Add auth ────────┐
  │  TDD Plan:     8.2k in / 1.4k out    │
  │  TDD Slices:   62.0k in / 14.0k out  │
  │  Review:       22.0k in / 4.3k out   │
  │  ─────────────────────────────────── │
  │  Total:        92.2k in / 19.7k out  │
  └───────────────────────────────────┘

  ═══ Progress: 5/12 issues done ════════════
    [==========>              ] 42%
    Tokens: 234k in / 58k out
    Runtime: 1h 12m

  ▶ Starting issue #47: Add dashboard...

  ... (all issues processed) ...

  ═══ ralf run complete ══════════════════

  ┌─ Summary ──────────────────────────┐
  │  Done:     10/12 issues              │
  │  Stuck:    2 issues                  │
  │  Runtime:  2h 34m                    │
  │  Tokens:   482k in / 112k out        │
  │                                       │
  │  ✔ #2  Setup auth          3m 12s   │
  │  ✔ #3  User registration   5m 44s   │
  │  ✔ #4  Login/logout        4m 21s   │
  │  ...                                 │
  │  ⚠ #11 Payment flow       stuck     │
  │  ⚠ #12 Admin panel        stuck     │
  └───────────────────────────────────┘

  Run `ralf finish` to distill learnings.
```

### NEEDS_FIXES Re-Iteration UX

```
  ✔ review (2m 14s)

  ┌─ Review ──────────────────────────┐
  │  Verdict: NEEDS_FIXES ✘              │
  │  - Auth middleware missing CSRF      │
  │  - Login test doesn't check rate     │
  │    limiting                          │
  └──────────────────────────────────┘

  ─── Issue #42 ─ Iteration 2/3 ─────────────
    Reason: NEEDS_FIXES (2 items)

  ┌─ green (fix) ─────────────────────┐
  │  ◌ 0m 45s │ Fixing CSRF...         │
  ├─────────┴─────────────────────────┤
  │  Edit src/auth/middleware.ts         │
  └──────────────────────────────────┘

  ...checks, review again...
```

### Interrupt UX (user presses Enter anytime)

```
  (ralf running, user presses Enter)

  ⏸ Paused after green (slice 2/5)

  ? What to do?
  › ● Continue
    ○ Give input to agent
    ○ Skip this issue
    ○ Stop ralf

  (user selects "Give input to agent")

  ▸ Use the existing CORS middleware
    pattern from src/middleware/cors.ts
    for the auth middleware too.

  ✔ Input queued for next agent call.
  ◌ green (slice 3/5)...
```

### Agent Crash UX

```
  ┌─ green ───────────────────────────┐
  │  ◌ 1m 12s │ Implementing...        │
  │  ✘ Agent crashed (exit code 1)      │
  └──────────────────────────────────┘

  ⚠ Retrying (1/1)...

  ┌─ green (retry) ───────────────────┐
  │  ◌ 0m 05s │ Starting...            │
  │  ✘ Agent crashed again              │
  └──────────────────────────────────┘

  ? Agent crashed twice. What to do?
  › ● Retry again
    ○ Skip this slice
    ○ Mark issue as stuck
    ○ Stop ralf
```

### `ralf finish`

```
  ◌ Distilling learnings from 12 issues...

  ✔ knowledge.md generated (1m 22s)

  ┌─ Knowledge Highlights ────────────┐
  │  - Auth: Better Auth with session   │
  │    cookies, CSRF protection added   │
  │  - DB: Drizzle push for migrations  │
  │  - Stuck: Payment flow needs        │
  │    Stripe webhook handling           │
  │  - 3 user decisions logged           │
  └──────────────────────────────────┘

  ✔ progress.txt cleared.
  Saved to .ralf/knowledge.md
```

### Pre-flight Failures

```
  ┌─ Pre-flight ───────────────────────┐
  │  ✔ .ralf/config.ts valid            │
  │  ✔ gh authenticated                 │
  │  ✘ Docker not running               │
  │    → Attempting auto-start...        │
  │    → Started Docker Desktop          │
  │  ◌ ralf-sandbox building...         │
  │    Step 2/4: RUN npm i -g pnpm...   │
  │  · issues with 'todo' label         │
  └───────────────────────────────────┘

  (if auto-fix fails:)

  ┌─ Pre-flight ───────────────────────┐
  │  ✔ .ralf/config.ts valid            │
  │  ✘ gh not authenticated             │
  │    → Run: gh auth login             │
  └───────────────────────────────────┘

  ✘ Pre-flight failed. Fix and retry.
```

### Docker Image Build (in Pre-flight)

```
  ┌─ Pre-flight ───────────────────────┐
  │  ✔ .ralf/config.ts valid            │
  │  ✔ gh authenticated                 │
  │  ✔ Docker running                   │
  │  ◌ ralf-sandbox building...         │
  │    Step 1/4: FROM node:22-slim      │
  │    Step 2/4: RUN npm i -g pnpm...   │
  │    Step 3/4: RUN apt-get install... │
  │    Step 4/4: WORKDIR /workspace     │
  │  · issues with 'todo' label         │
  └───────────────────────────────────┘

  (1-3 min later...)

  ┌─ Pre-flight ───────────────────────┐
  │  ✔ .ralf/config.ts valid            │
  │  ✔ gh authenticated                 │
  │  ✔ Docker running                   │
  │  ✔ ralf-sandbox built (1m 42s)      │
  │  ✔ 12 issues with 'todo' label      │
  └───────────────────────────────────┘
```

### Agent Questions UX

```
  (Agent outputs <questions> sentinel during GREEN session)

  ┌─ Agent Questions (#42, green) ─────┐
  │                                       │
  │  Found 'OAuth' in issue description   │  ← dimmed context
  │  but no AC checkbox for it.           │
  │                                       │
  │  Q1: OAuth: implement or skip?        │
  │  › ● Skip                              │
  │    ○ Scaffold                           │
  │    ○ Full implementation               │
  │    ○ Other: ___                        │
  │                                       │
  └───────────────────────────────────┘

  (User selects "Skip", Q2 appears)

  ┌─ Agent Questions (#42, green) ─────┐
  │                                       │
  │  Found 'OAuth' in issue description   │
  │  but no AC checkbox for it.           │
  │                                       │
  │  ✔ OAuth: implement or skip?           │
  │    → Skip                              │
  │                                       │
  │  Q2: Session storage preference?       │
  │  › ● Redis                              │
  │    ○ Database                           │
  │    ○ Other: ___                        │
  │                                       │
  └───────────────────────────────────┘

  (User selects "Redis", all answered → continue session)

  ✔ Questions answered → continuing green session...
```

### Failure UX

```
  ── Slice 1/5: User can login ────────

  (RED Gate failed — test passed unexpectedly)

  ┌─ RED Gate ────────────────────────┐
  │  Expected: all new tests FAIL        │
  │                                      │
  │  ✔ login.test.ts:login   FAIL (good) │
  │  ✘ login.test.ts:session PASS (bad!) │
  │                                      │
  │  ⚠ 1 test passed unexpectedly        │
  │  → Re-running test agent...          │
  └─────────────────────────────────┘

  (GREEN Gate failed — checks/tests fail)

  ┌─ Checks ──────────────────────────┐
  │  ✔ typecheck               0.8s      │
  │  ✘ lint      2 errors      1.2s      │
  │  ✘ test      1 failing     4.1s      │
  └─────────────────────────────────┘

  ⚠ Slice 1/5 failed — retrying...

  ┌─ green (retry) ───────────────────┐
  │  ◌ 0m 12s │ Fixing lint errors... │
  └─────────────────────────────────┘

  (Issue stuck after max iterations)

  ⚠ #42 stuck after 3 iterations
    Last failure: 2 tests failing
    Label: stuck
    Moving to next issue...

  (Rate limit)

  ⚠ Rate limit hit — waiting 4m 32s
    Resets at 14:32:15
    [=========>          ] 68%
```

### `ralf status`

```
  ┌─ ralf status ─────────────────────┐
  │  Current: #42 Add auth flow          │
  │  Phase:   green (slice 2/5, iter 1)  │
  │  Runtime: claude                      │
  │                                       │
  │  Done:    8 │ In Progress: 1          │
  │  Review:  0 │ Stuck: 0               │
  │  Todo:    3 │ Total: 12               │
  └───────────────────────────────────┘
```

### Log File Format

```markdown
---
issue: 42
phase: green
slice: 2
iteration: 1
duration: 1m 42s
tokens_in: 12400
tokens_out: 3200
runtime: claude
checks:
  typecheck: pass
  lint: pass
  test: pass
---

# Agent Output

[full agent text output...]
```

---

## Prompt Architecture

### Layers

1. **RALF.md** (project-level) — Stack conventions, file placement, commands, rules
2. **Phase prompt** (per-step) — What the agent should do, sentinel schema, constraints

Every prompt gets: `{{RALPH_MD}}` + `{{ISSUE}}` + `{{KNOWLEDGE}}` + `{{PROGRESS}}` + phase-specific vars

### Prompts to scaffold

| File | Purpose | Key inputs |
|------|---------|------------|
| `init.md` | Interview (grill-me style) | Free context from user |
| `plan.md` | Plan TDD behaviors (single call) | Issue + RALF.md + code context |
| `red.md` | RED session start: write first test | Issue + plan + RALF.md + existing code |
| `red-continue.md` | RED session continue: write next test | Previous test result (FAIL ✓) + next behavior |
| `green.md` | GREEN session start: implement first behavior | Issue + all test files + RALF.md |
| `green-continue.md` | GREEN session continue: implement next + fix lint | Check results + lint output + next behavior |
| `review.md` | Review code + tests + TDD discipline | Issue + diff + test files + check results |

### Implement prompt principles (from research)

- KISS: simplest solution that works
- YAGNI: no speculative features
- Solo developer focus: maintainable, readable, minimal abstraction
- Use existing patterns in the codebase (explore first)
- One thing at a time (vertical slice)
- Reflexive verification: agent checks its own work before outputting sentinel

---

## Architecture: Deep Modules

The codebase is organized around **4 deep modules** with small interfaces hiding large implementations. This replaces the previous ~25 shallow files with 4 testable boundaries.

### Deep Module #1: `IssueProcessor`

Absorbs: pipeline/runner, pipeline/steps/*, gate logic, iteration management

```typescript
interface IssueProcessor {
  processIssue(issue: Issue, opts: ProcessOpts): AsyncGenerator<IssueEvent>
}

type ProcessOpts = {
  config: RalfConfig
  session: AgentSession
  state: ProjectState
  ui: TerminalUI
  mode: 'auto' | 'hitl'
}

// IssueEvent is the only thing callers see
type IssueEvent =
  | { type: 'plan-ready'; behaviors: Behavior[] }         // HITL: approve?
  | { type: 'red-gate'; test: string; passed: boolean }   // RED Gate result
  | { type: 'green-gate'; checks: CheckResult[] }          // GREEN Gate result
  | { type: 'slice-complete'; slice: number; total: number }
  | { type: 'review-verdict'; verdict: 'approved' | 'needs_fixes' }
  | { type: 'question'; questions: Question[] }             // agent asks user
  | { type: 'stuck'; reason: string; iteration: number }
  | { type: 'complete'; summary: IssueSummary }
```

**Hides internally**: Plan→RED→GREEN→Review loop, session continuation orchestration, RED/GREEN gate validation, iteration counting, retry logic, prompt hydration (template engine is just `string.replaceAll` inline — no separate module).

**Tests**: Feed a MockAgentSession + MockProjectState, assert on the sequence of IssueEvents. One test per scenario: happy path, RED gate fail, GREEN gate fail, stuck, agent question.

### Deep Module #2: `AgentSession`

Absorbs: AgentAdapter (claude/codex/mock), Docker wrapping, sentinel extraction, token accumulation

```typescript
interface AgentSession {
  run(prompt: string): Promise<SessionResult>
  continue(feedback: string): Promise<SessionResult>
  readonly tokens: TokenUsage
  readonly sessionId: string | null
}

interface SessionResult {
  result: unknown              // parsed <result> JSON sentinel
  questions: Question[] | null // parsed <questions> sentinel
  raw: string                  // full text for logging
  tokensIn: number
  tokensOut: number
  duration: number
}

// Factory — picks the right adapter internally
function createSession(runtime: 'claude' | 'codex' | 'mock', config: RuntimeConfig): AgentSession
```

**Hides internally**: AgentAdapter selection (Claude vs Codex vs Mock), Docker container wrapping, `<result>` sentinel extraction via regex, `<questions>` sentinel extraction, session-ID management across `continue()` calls, token accumulation, timeout handling.

**The adapter layer** (ClaudeAdapter, CodexAdapter, MockAdapter) normalizes CLI differences (flag names, output formats, session continuation). The session layer above adds sentinel parsing + Docker.

**Tests**: MockAdapter returns fixture chains. Real adapters tested only in E2E.

### Deep Module #3: `TerminalUI`

Absorbs: all 10 ui/* files

```typescript
interface TerminalUI {
  // Fire-and-forget rendering
  emit(event: UIEvent): void
  
  // Blocking: waits for user input
  prompt<T>(question: PromptEvent): Promise<T>
  
  // Interactive states
  countdown(message: string, seconds: number): Promise<'expired' | 'interrupted'>
  waitForRateLimit(seconds: number, resetTime: string): Promise<void>
  collapseLastIssue(issue: Issue, duration: string, slices: string): void
  
  // Interrupt system
  onInterrupt(callback: () => void): void            // registers Enter keypress listener
  removeInterrupt(): void
}

type UIEvent =
  | { type: 'preflight'; checks: PreflightResult[] }  // pre-flight check box
  | { type: 'run-start'; config: RunConfig }
  | { type: 'issue-start'; issue: Issue; iteration: number; maxIter: number }
  | { type: 'git-action'; action: string }             // → branch: ralf/#42, → committed: ...
  | { type: 'phase-start'; phase: string; issueTitle: string }
  | { type: 'agent-activity'; tool: string; description: string }
  | { type: 'phase-complete'; phase: string; duration: number; summary: string }
  | { type: 'check-progress'; name: string; status: 'running' | 'pass' | 'fail'; duration?: number }
  | { type: 'red-gate'; test: string; expected: 'fail'; actual: 'fail' | 'pass' }
  | { type: 'green-gate'; checks: CheckResult[] }
  | { type: 'slice-complete'; slice: number; total: number }
  | { type: 'tdd-summary'; slices: number; tests: number; files: number; tokens: TokenUsage }
  | { type: 'review-verdict'; verdict: string; notes: string; fixItems?: string[] }
  | { type: 'token-usage'; usage: TokenUsage }
  | { type: 'progress'; done: number; total: number; tokens: TokenUsage; runtime: string }
  | { type: 'issue-complete'; issue: Issue }
  | { type: 'run-complete'; summary: RunSummary }      // final summary card
  | { type: 'stuck'; issue: Issue; reason: string }
  | { type: 'crash'; phase: string; exitCode: number; retryCount: number }
  | { type: 'notification'; title: string; body: string }

type PromptEvent =
  | { type: 'confirm'; message: string; options: string[] }
  | { type: 'questions'; questions: Question[]; context?: string }
  | { type: 'plan-approval'; behaviors: Behavior[] }
  | { type: 'stuck-input'; issue: Issue; reason: string }
  | { type: 'crash-input'; phase: string; options: string[] }
  | { type: 'interrupt-menu' }                          // Continue, Give input, Skip, Stop
  | { type: 'freetext'; message: string }               // mid-flow input
```

**Hides internally**: All ANSI rendering, @clack/prompts, picocolors, box drawing, progress bars, collapsible text, sequential question flow, countdown timers, rate-limit progress bars, output collapsing for completed issues, Enter keypress interrupt listener, Windows Toast notifications.

**Tests**: Snapshot tests for emit(). Mock prompt() to return predetermined answers. Countdown/interrupt tested via mock timers.

### Deep Module #4: `ProjectState`

Absorbs: github/client, git operations, dependency parsing, issue ordering, pre-flight checks, revert

```typescript
interface ProjectState {
  // Pre-flight
  preflight(): Promise<PreflightResult[]>            // check: config, gh, docker, image, issues
  buildImage(): Promise<void>                        // docker build if needed

  // Issue ordering (topological + priority)
  getIssuesInOrder(filter?: number[]): Promise<Issue[]>  // optional: specific issue IDs
  
  // Issue lifecycle
  startIssue(issue: Issue): Promise<void>            // create branch + label in-progress
  completeSlice(message: string): Promise<void>      // git commit
  submitForReview(issue: Issue): Promise<void>        // label in-review
  approveIssue(issue: Issue): Promise<void>           // merge branch + label done + close
  markStuck(issue: Issue, reason: string): Promise<void>
  revertIssue(issue: Issue): Promise<void>            // git revert + label → todo + delete branch

  // Read state
  getIssueCounts(): Promise<IssueCounts>
  getCurrentIssue(): Promise<Issue | null>

  // Lock
  acquireLock(): Promise<void>                       // throws if locked
  releaseLock(): Promise<void>
}

type PreflightResult = {
  name: string
  status: 'pass' | 'fail' | 'building' | 'fixing'
  message?: string
  fix?: string                                       // e.g. "Run: docker start"
  autoFixable?: boolean
}
```

**Hides internally**: `gh` CLI calls, git operations, dependency parsing (`depends-on:` in issue body), topological sorting, label management, retry with backoff, branch naming, Docker image management, lockfile, auto-fix (Docker start).

**Tests**: MockProjectState is an in-memory Map with preset dependency graph. Real ProjectState tested in E2E.

### Template Engine: Eliminated

No separate module. Prompt hydration is a one-liner used inline in IssueProcessor:

```typescript
const hydrate = (tpl: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), tpl)
```

---

## Package Structure (ralf repo)

```
ralf/
├── package.json
├── tsconfig.json
├── bin/
│   └── ralf.ts                    # CLI entry (shebang), routes to commands
├── src/
│   ├── commands/
│   │   ├── init.ts                # ralf init — scaffold + interview → PRD → issues
│   │   ├── run.ts                 # ralf run — orchestrates: preflight, lock, issue loop, interrupt, collapse
│   │   ├── revert.ts              # ralf revert #N — git revert + label reset
│   │   ├── status.ts              # ralf status — read ProjectState, emit to UI
│   │   └── finish.ts              # ralf finish — distill agent
│   ├── issue-processor/           # DEEP MODULE #1
│   │   ├── index.ts               # processIssue() — Plan→RED→GREEN→Review loop
│   │   ├── gates.ts               # RED Gate + GREEN Gate validation logic (pure)
│   │   └── types.ts               # IssueEvent, ProcessOpts, IssueSummary
│   ├── agent-session/             # DEEP MODULE #2
│   │   ├── index.ts               # createSession() — sentinel parsing + Docker wrapping
│   │   ├── adapter.ts             # AgentAdapter interface
│   │   ├── claude-adapter.ts      # ClaudeAdapter — claude -p, --resume, --output-format json
│   │   ├── codex-adapter.ts       # CodexAdapter — codex exec, resume, --json JSONL
│   │   ├── mock-adapter.ts        # MockAdapter — fixture chain replay
│   │   └── docker.ts              # Docker wrapping (optional, wraps any adapter)
│   ├── terminal-ui/               # DEEP MODULE #3
│   │   ├── index.ts               # TerminalUI — emit(event), prompt(question)
│   │   └── notify.ts              # OS notifications (platform-specific)
│   ├── project-state/             # DEEP MODULE #4
│   │   ├── index.ts               # createProjectState() — git + github unified
│   │   └── mock.ts                # MockProjectState (in-memory)
│   └── config/
│       ├── schema.ts              # Config type + defineConfig() + Zod validation
│       └── loader.ts              # Load .ralf/config.ts from cwd
├── templates/                     # Copied to .ralf/prompts/ on init
│   ├── init.md
│   ├── plan.md
│   ├── red.md
│   ├── red-continue.md
│   ├── green.md
│   ├── green-continue.md
│   └── review.md
├── scaffold/                      # Copied to .ralf/ on init
│   ├── config.ts.template
│   ├── RALF.md.template
│   └── Dockerfile.template
└── test/
    ├── fixtures/                  # Session-chain fixtures (zero tokens)
    │   ├── happy-path.fixture.json
    │   ├── red-gate-fail.fixture.json
    │   ├── green-gate-fail.fixture.json
    │   ├── review-needs-fixes.fixture.json
    │   ├── agent-question.fixture.json
    │   └── stuck.fixture.json
    ├── issue-processor.test.ts    # Boundary test: MockSession + MockState → IssueEvents
    ├── agent-session.test.ts      # Boundary test: fixtures → AgentResult
    ├── stream-parser.test.ts      # Pure unit: NDJSON lines → StreamEvents
    ├── project-state.test.ts      # Boundary test: MockProjectState operations
    ├── gates.test.ts              # Pure unit: RED/GREEN gate logic
    ├── config.test.ts             # Config validation
    └── ui/
        ├── __snapshots__/
        └── terminal-ui.test.ts    # Snapshot: UIEvents → ANSI strings
```

---

## Testing Strategy (Zero-Token by Default)

### Principle

Everything except the actual agent prompts is testable without tokens. The `AgentRuntime` interface is the seam — swap in `MockRuntime` and the entire pipeline runs for free.

### MockRuntime

```typescript
class MockRuntime implements AgentRuntime {
  name = 'mock' as const

  constructor(private fixtures: FixtureChain[]) {}

  async spawn(prompt: string, onEvent: (e: StreamEvent) => void): Promise<AgentResult> {
    // Find matching fixture by prompt_contains or call index
    const fixture = this.findFixture(prompt)
    // Emit events with realistic timing (configurable delay)
    for (const event of fixture.events) {
      onEvent(event)
    }
    return fixture.result
  }
}
```

### Session-Chain Fixtures

Each fixture file defines a chain of responses for `--resume` sessions:

```json
{
  "sessionId": "mock-green-42",
  "chain": [
    {
      "prompt_contains": "Implement behavior 1",
      "events": [/* stream events */],
      "result": { "status": "complete", "filesChanged": ["src/auth.ts"] }
    },
    {
      "prompt_contains": "All green. Implement behavior 2",
      "events": [/* stream events */],
      "result": { "status": "complete", "filesChanged": ["src/session.ts"] }
    }
  ]
}
```

### `ralf run --dry-run`

Uses MockRuntime with default fixtures. Shows the complete UX in the terminal without spending tokens. Perfect for:
- UI development and iteration
- Demos and walkthroughs
- Verifying the pipeline flow after code changes
- CI pipeline smoke tests

### `ralf run --record` (later)

Records real agent responses as fixture files for regression testing. Run once with real tokens, test forever for free.

### Test Layers

| Layer | What | Tokens | Tool |
|-------|------|--------|------|
| Unit | StreamParser, Config, Template, Gates | 0 | vitest |
| UI Snapshots | ANSI rendering (boxes, progress, questions) | 0 | vitest + snapshots |
| Integration | Full pipeline with MockRuntime + MockGitHub | 0 | vitest |
| Dry-run | Manual CLI walkthrough with MockRuntime | 0 | `ralf run --dry-run` |
| E2E | Real agents against test repo (optional, CI) | $$ | `ralf run --record` |

### Mock GitHub Client

```typescript
class MockGitHubClient implements GitHubClient {
  issues: Map<number, MockIssue> = new Map()

  async selectNextIssue() { /* return from map */ }
  async moveIssue(id, label) { /* update map */ }
  async closeIssue(id) { /* update map */ }
}
```

---

## Implementation Phases

### Phase 1: Repo Setup
1. Create GitHub repo
2. Initialize package.json, tsconfig.json, bin entry
3. Add dependencies: `@clack/prompts`, `picocolors`, `tsx`, `zod`, `execa`, `figures`
4. `npm link` into Nutrimaxx project

### Phase 2: Deep Module — AgentSession
1. `agent-session/adapter.ts` — AgentAdapter interface
2. `agent-session/claude-adapter.ts` — Claude CLI adapter (`-p`, `--bare`, `--output-format json`, `--resume`)
3. `agent-session/codex-adapter.ts` — Codex CLI adapter (`exec`, `--yolo`, `--json` JSONL, `resume`)
4. `agent-session/mock-adapter.ts` — MockAdapter with fixture chain replay
5. `agent-session/docker.ts` — Docker wrapping (mounts `~/.claude/` + `~/.codex/`, runs adapter inside container)
6. `agent-session/index.ts` — `createSession()` — sentinel extraction (`<result>`, `<questions>`) + adapter selection
7. Write fixture files (happy-path, fail scenarios, questions)

### Phase 3: Deep Module — ProjectState
1. `project-state/index.ts` — Unified git + GitHub client
2. `project-state/mock.ts` — In-memory MockProjectState
3. `config/schema.ts` — Config type + `defineConfig()` + Zod validation
4. `config/loader.ts` — Find and load `.ralf/config.ts`

### Phase 4: Deep Module — TerminalUI
1. `terminal-ui/index.ts` — `emit(event)` + `prompt(question)` interface
2. `terminal-ui/notify.ts` — OS notifications (Windows Toast)
3. All rendering logic: boxes, progress, checks, slices, questions, tokens

### Phase 5: Deep Module — IssueProcessor
1. `issue-processor/gates.ts` — RED/GREEN gate logic (pure)
2. `issue-processor/index.ts` — `processIssue()` — Plan→RED→GREEN→Review loop
3. `issue-processor/types.ts` — IssueEvent types

### Phase 6: Commands (thin wiring)
1. `commands/run.ts` — Loop over issues, call IssueProcessor, pipe events to UI
2. `commands/init.ts` — Scaffold .ralf/ + interview → PRD → issues
3. `commands/status.ts` — Read ProjectState, emit to UI
4. `commands/finish.ts` — Distill agent → knowledge.md
5. `bin/ralf.ts` — CLI entry, route to commands

### Phase 7: Prompt Templates
1. Write `init.md` (based on grill-me skill)
2. Write `plan.md` (TDD behavior planning)
3. Write `red.md` (RED session start — first test, based on TDD skill)
4. Write `red-continue.md` (RED session continue — "test failed ✓, write next")
5. Write `green.md` (GREEN session start — implement first behavior, KISS/YAGNI)
6. Write `green-continue.md` (GREEN session continue — "all green, lint: [...], implement next")
7. Write `review.md` (code + test + TDD discipline review)
8. Write scaffold templates (config.ts, RALF.md, Dockerfile)

### Phase 8: Integration Testing
1. npm link into Nutrimaxx project
2. Create `.ralf/` with config for Nutrimaxx
3. Test `ralf init` — interview, PRD, issues
4. Test `ralf run` — full TDD loop on one issue
5. Test RED Gate — verify failing test detection
6. Test GREEN Gate — verify check + test validation
7. Test re-iteration on failure
8. Test `ralf status`
9. Test `ralf finish`
10. Test Docker sandbox
11. Test Codex runtime (if configured)

---

## Verification Checklist

- [ ] `ralf init` scaffolds `.ralf/`, runs interview, creates PRD + issues
- [ ] `ralf run` picks issue, runs TDD slices (plan → red → green → e2e → review)
- [ ] RED Gate catches tests that pass unexpectedly
- [ ] GREEN Gate catches lint/typecheck/test failures
- [ ] Failed slice triggers retry with error context
- [ ] Review NEEDS_FIXES triggers re-iteration
- [ ] `ralf run --auto` skips all HITL pauses
- [ ] Token usage displayed per issue and grand total
- [ ] `ralf status` shows current state from GitHub
- [ ] `ralf finish` generates knowledge.md, clears progress.txt
- [ ] Docker sandbox works (agent runs in container)
- [ ] Codex runtime works for review
- [ ] System notification on completion/stuck
- [ ] Rate limit → countdown timer → auto-retry
- [ ] Max iterations → 'stuck' label → halt + notify + wait for input
- [ ] Resume after interruption (detects in-progress issue from GitHub)
- [ ] `ralf run --dry-run` shows full UX with MockRuntime (zero tokens)
- [ ] MockRuntime correctly chains session-continuation fixtures
- [ ] UI snapshot tests pass for all components
- [ ] Agent questions halt flow, render sequentially, inject answer via --resume
- [ ] Agent questions logged to progress.txt
- [ ] Feature-branch created per issue, auto-merged after APPROVED
- [ ] CLI commits after each GREEN Gate (agent never touches git)
- [ ] Stuck issues halt ralf completely, notify, wait for user input

---

## PRD (to be submitted as GitHub Issue #1 on Teqvention/ralf)

### Title: Ralf — Multi-Agent TDD Development Orchestrator

## Problem Statement

Solo developers using AI coding agents face a structural problem: agents produce code that looks correct but has no deterministic quality guarantee. There is no automated loop that enforces test-first development, validates outputs against acceptance criteria, and handles the full lifecycle from issue to merged code. Running agents manually per issue is slow, error-prone, and doesn't scale.

Existing tools (Claude Code, Cursor, Aider) are single-session coding assistants. They don't orchestrate multi-issue pipelines, enforce TDD discipline, or provide deterministic quality gates between agent phases.

## Solution

Ralf is a standalone CLI tool (npm package) that orchestrates AI agents through a deterministic TDD development loop. It turns a backlog of GitHub issues into tested, reviewed, merged code — autonomously or with human-in-the-loop checkpoints.

The developer runs `ralf init` once to interview, generate a PRD, and break it into GitHub issues. Then `ralf run` processes each issue through a strict pipeline: Plan → RED (write tests) → GREEN (implement) → Review → Merge. Every transition between phases is validated by the CLI, not the agent. Agents run in Docker sandboxes and can ask the developer clarifying questions when requirements are ambiguous.

## User Stories

1. As a solo developer, I want to run `ralf init` so that my project idea is turned into a structured PRD and actionable GitHub issues through an interactive interview
2. As a solo developer, I want to run `ralf run` so that GitHub issues are automatically processed through a TDD pipeline without my intervention
3. As a solo developer, I want to run `ralf run` in HITL mode so that I can approve each phase (plan, tests, implementation, review) before continuing
4. As a solo developer, I want agents to write one test at a time and have the CLI verify it fails (RED Gate) so that I know tests are meaningful and not vacuous
5. As a solo developer, I want agents to implement one behavior at a time and have the CLI verify all checks pass (GREEN Gate) so that the code stays clean after every step
6. As a solo developer, I want lint warnings from each GREEN Gate fed back to the agent so that it cleans up before writing the next test
7. As a solo developer, I want E2E tests written as the final slice so that the full user flow is verified end-to-end
8. As a solo developer, I want a Review Agent to check code quality, test coverage, and TDD discipline so that I have a second opinion before merging
9. As a solo developer, I want the Review Agent to be able to ask me questions and adjust its verdict based on my answers so that false rejections don't waste iterations
10. As a solo developer, I want agents to ask me clarifying questions when issue requirements are ambiguous so that they don't make wrong assumptions
11. As a solo developer, I want agent questions to halt the pipeline and notify me (even in auto mode) so that I never miss a question
12. As a solo developer, I want questions rendered as a sequential select flow with an "Other" freetext option so that answering is fast and natural
13. As a solo developer, I want agents to run in Docker sandboxes so that they can't break my system
14. As a solo developer, I want a feature-branch created per issue and auto-merged after approved review so that my git history stays clean
15. As a solo developer, I want the CLI to commit after each GREEN Gate so that I have granular rollback points per behavior
16. As a solo developer, I want to see token usage per issue (broken down by phase) and a grand total so that I understand my consumption
17. As a solo developer, I want to see a live status display during each agent phase (timer, tool calls, current action) so that I know what's happening
18. As a solo developer, I want a compact summary card between phases showing what was done, files changed, and duration so that I can track progress
19. As a solo developer, I want a progress header between issues showing overall completion, total tokens, and runtime so that I know how far along the run is
20. As a solo developer, I want `ralf status` to show a card with current issue, phase, iteration, and issue counts from GitHub so that I can check progress from another terminal
21. As a solo developer, I want `ralf run --dry-run` to run the full pipeline with mock agents (zero tokens) so that I can develop and test the CLI itself
22. As a solo developer, I want `ralf run --auto` to process all issues without pauses (except for agent questions and stuck issues) so that I can go AFK
23. As a solo developer, I want system notifications when ralf completes or gets stuck so that I know when to come back
24. As a solo developer, I want rate limits to show a countdown timer and auto-retry so that I don't have to babysit the process
25. As a solo developer, I want stuck issues (max iterations exceeded) to halt ralf completely and wait for my input so that I can decide what to do
26. As a solo developer, I want agent crashes to retry once automatically and then ask me what to do so that transient failures don't stop the run
27. As a solo developer, I want `ralf finish` to distill all progress logs into a knowledge.md so that learnings persist across sessions
28. As a solo developer, I want to configure which runtime (claude/codex) runs each phase so that I can use the best model for each task
29. As a solo developer, I want to configure checks (typecheck, lint, test commands) in `.ralf/config.ts` so that ralf works with any project
30. As a solo developer, I want to edit the agent prompts in `.ralf/prompts/` so that I can tune agent behavior for my project
31. As a solo developer, I want `ralf init` to scaffold the `.ralf/` directory with config, prompts, Dockerfile, and RALF.md so that setup is one command
32. As a solo developer, I want `ralf init` to auto-create GitHub labels (todo, in-progress, in-review, done) if they don't exist so that the kanban works immediately
33. As a solo developer, I want ralf to resume after interruption by reading GitHub label state so that I can restart without losing progress

## Implementation Decisions

- **Architecture**: Standalone npm package (`Teqvention/ralf`). CLI entry via `bin/ralf.ts`. Commands: `init`, `run`, `status`, `finish`
- **Agent runtime abstraction**: `AgentRuntime` interface with `spawn()` and `continue()` methods. Implementations: `ClaudeRuntime`, `CodexRuntime`, `MockRuntime`. Pipeline is runtime-agnostic
- **Stream parsing**: Claude CLI `--output-format stream-json` emits NDJSON. `StreamParser` extracts: assistant messages (token counts + content), system events (session-id), and our `<result>` sentinels. All other event types silently ignored
- **Token tracking**: Input tokens = latest value per turn (cumulative in API). Output tokens = sum across turns. Pattern taken from Claude Code's `ProgressTracker`
- **Session continuation**: `--resume $SESSION_ID` for multi-turn RED/GREEN sessions. Session-ID extracted from NDJSON stream. One session per phase (RED, GREEN), N pauses per session
- **Process spawning**: `execa` for clean subprocess management
- **TDD loop**: Plan (1 call) → RED session (1 session, N continues) → GREEN session (1 session, N continues) → Review (1 call). 4 agent units per issue
- **Quality gates**: RED Gate (new test must fail) and GREEN Gate (all checks + tests must pass) are deterministic CLI-side validations, not agent decisions
- **Agent questions**: `<questions>` sentinel with JSON array. Max 2 halts per session, each halt can contain multiple questions. Sequential flow UI with "Other" option. Answers injected via `--resume`
- **Git strategy**: Feature-branch per issue (`ralf/#42-description`). CLI commits after each GREEN Gate. Auto-merge into main after APPROVED review. No PRs
- **Docker sandbox**: Auto-generated Dockerfile. Mount project `:rw` + `~/.claude/` `:rw` (for session persistence). Agents run with `--dangerously-skip-permissions`
- **Config**: TypeScript config (`.ralf/config.ts`) with `defineConfig()` + Zod validation. Defines: repo, labels, checks, agent runtimes, max iterations, HITL pauses
- **Prompt architecture**: Two layers — RALF.md (project-level stack context) + phase prompts (agent-specific instructions + sentinel schema). Templates in `.ralf/prompts/`, user-editable
- **UI library**: `@clack/prompts` + `picocolors` + `figures`. No React/Ink (overkill for box-based UI)
- **Error handling**: Agent crash → retry 1x, then HITL. Rate limit → countdown timer + auto-retry. Stuck → halt completely, notify, wait for input. GitHub API → retry with backoff, warn + continue

## Testing Decisions

- **Good tests** verify behavior through public interfaces. They exercise the pipeline with mock agents and assert on outcomes (which phase ran, what gates passed/failed, what labels changed), not on internal implementation details
- **MockRuntime**: Implements `AgentRuntime` with session-chain fixtures (JSON files). Each fixture defines a sequence of responses for `--resume` calls. Zero tokens
- **MockGitHubClient**: In-memory issue map. Implements the same interface as the real `gh` CLI wrapper
- **UI snapshot tests**: Each UI component (check box, slice header, question flow, progress) gets vitest snapshot tests against ANSI output
- **`--dry-run` mode**: Full CLI flow with MockRuntime. Perfect for manual testing during UI development
- **Test layers**: Unit (pure functions) → UI Snapshots (ANSI rendering) → Integration (full pipeline with mocks) → Dry-run (manual CLI) → E2E (real agents, optional)
- **Fixture creation**: Manual for MVP (based on sentinel schema). Later: `--record` flag saves real agent responses as fixtures for regression

## Out of Scope

- **IDE integration** — Ralf is CLI-only. No VS Code extension, no Cursor integration
- **Multi-repo orchestration** — Ralf works on one repo at a time
- **Parallel issue processing** — Issues are processed sequentially (one at a time)
- **Custom agent providers** — Only Claude and Codex runtimes. No arbitrary LLM support
- **PR-based workflow** — No pull requests. Auto-merge into main after review
- **Cost estimation** — No pre-run cost predictions. Token tracking is post-hoc only
- **Web dashboard** — No web UI. Terminal only (`ralf status` for quick checks)
- **`--record` mode** — Fixture recording from real sessions is planned but not MVP

## Further Notes

- Ralf is designed for the Claude Max 20x plan ($200/mo flat). Token costs are not a concern; rate limits are the bottleneck. The countdown timer UX handles this gracefully
- The naming convention is `ralf` everywhere: CLI command, config directory (`.ralf/`), package name
- RALF.md serves the same purpose as CLAUDE.md — it's the project-level context injected into every agent prompt. It contains stack conventions, file placement rules, and coding standards
- The init interview is based on the `grill-me` skill pattern: relentless questioning until shared understanding is reached
- The TDD approach follows the `tdd` skill's vertical slice philosophy: one test → one implementation → repeat. Never horizontal slicing (all tests first, then all implementation)
