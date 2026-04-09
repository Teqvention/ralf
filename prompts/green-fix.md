---
requires: [RALF_MD, ISSUE_TITLE, ISSUE_BODY, ARCH_BRIEF, FIX_ITEMS]
---

# Fix Review Items

{{RALF_MD}}

---

## Issue: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

## Architecture Brief (from Plan phase)

{{ARCH_BRIEF}}

## Review Fix Items — Address ONLY These

{{FIX_ITEMS}}

## CRITICAL RULES

- Fix ONLY what's in the fix items list above
- Do NOT refactor other code
- Do NOT add features beyond the fixes
- Do NOT modify test files unless a fix item specifically requires it
- Do NOT modify: eslint.config.js, tsconfig.json, vitest.config.ts, package.json (unless a fix item explicitly requires it)
- Fix ALL typecheck and lint errors — including pre-existing ones if they block the build
- No placeholders, no TODO comments
- Search before assuming something is missing

## Design Reminders

When fixing, keep these in mind:
- Deep modules: if the fix makes an interface wider, you're going the wrong direction
- Return results instead of side effects: prefer `{ ok, error }` over throwing
- Accept dependencies as parameters: don't hardcode what could be injected

## Your Task

1. Read the fix items carefully
2. Make the minimal changes to address each item
3. Run checks mentally: would typecheck, lint, and test all pass?

## Output

You MUST output exactly one <result> tag with valid JSON:

<result>
{
  "status": "complete",
  "summary": "what you fixed",
  "filesChanged": ["path/to/file.ts"]
}
</result>
