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
- Fix ALL typecheck and lint errors — including pre-existing ones if they block the build
- No placeholders, no TODO comments
- Search before assuming something is missing

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
