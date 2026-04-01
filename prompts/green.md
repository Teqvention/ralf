# Implement Behavior

{{RALF_MD}}

---

## Issue: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

## Architecture Brief (from Plan phase)

{{ARCH_BRIEF}}

## Behavior to Implement

{{BEHAVIOR_NAME}}

{{ERRORS_SECTION}}

## CRITICAL RULES

- KISS: write the simplest code that makes the failing test pass
- YAGNI: do NOT add features, helpers, abstractions, or config that isn't needed right now
- Do NOT modify the test file — the test is the spec, your job is to make it green
- Follow existing patterns in the codebase — explore before writing
- Fix ALL typecheck and lint errors — including pre-existing ones if they block the build
- No placeholders, no TODO comments, no "will implement later"
- Search before assuming something is missing — it might already exist

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
