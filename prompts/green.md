---
requires: [RALF_MD, ISSUE_TITLE, ISSUE_BODY, BEHAVIOR_NAME, ARCH_BRIEF, TEST_FILES, ERRORS_SECTION]
---

# Implement Behavior

{{RALF_MD}}

---

## Issue: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

## Architecture Brief (from Plan phase)

{{ARCH_BRIEF}}

## Behavior to Implement

{{BEHAVIOR_NAME}}

## Failing Test

The RED phase wrote a failing test at: {{TEST_FILES}}

Read this test first. Your ONLY job is to make it pass.

{{ERRORS_SECTION}}

## CRITICAL RULES

- KISS: write the simplest code that makes the failing test pass
- YAGNI: do NOT add features, helpers, abstractions, or config that isn't needed right now
- Do NOT modify the test file — the test is the spec, your job is to make it green
- Follow existing patterns in the codebase — explore before writing
- Fix ALL typecheck and lint errors — including pre-existing ones if they block the build
- No placeholders, no TODO comments, no "will implement later"
- Search before assuming something is missing — it might already exist

## Design Principles

- Deep modules: small interface, rich implementation. Hide complexity inside.
- Return results instead of producing side effects where possible
- Accept dependencies as parameters, don't create them internally

## Design Examples

GOOD — deep module (small interface, rich internals):
```ts
// Caller doesn't know about retries, caching, pagination
function fetchUser(id: string): Promise<User>
```

BAD — shallow module (interface mirrors implementation):
```ts
// Caller manages all the complexity
function fetchUser(id: string, retries: number, cache: Cache, page: number): Promise<User>
```

GOOD — return results, let caller decide side effects:
```ts
function validateConfig(input: unknown): { ok: true; config: Config } | { ok: false; errors: string[] }
```

BAD — side effects hidden inside:
```ts
function validateConfig(input: unknown): void {
  if (!input.name) { console.error("missing name"); process.exit(1) }
}
```

GOOD — accept dependencies as parameters:
```ts
function createServer(db: Database, logger: Logger): Server
```

BAD — create dependencies internally:
```ts
function createServer(): Server {
  const db = new PostgresDB(process.env.DB_URL!)  // untestable, hardcoded
}
```

## Your Task

1. Explore the codebase: understand existing patterns, types, utilities
2. Write the minimal implementation that makes the test pass
3. Run checks mentally: would typecheck, lint, and test all pass?

## Output

You MUST output exactly one <result> tag with valid JSON:

<result>
{
  "status": "complete",
  "summary": "what you implemented",
  "filesChanged": ["path/to/file.ts"]
}
</result>
