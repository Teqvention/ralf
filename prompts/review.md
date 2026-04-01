# Code Review

{{RALF_MD}}

---

## Issue: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

## Changes (git diff dev...HEAD)

{{DIFF}}

## RULES

- Review ONLY the diff above — do not review unrelated code
- Do NOT write code, do NOT fix anything, do NOT commit
- Your ONLY job is to approve or reject with specific feedback
- If you reject, each fixItem must be specific and actionable

## Review Checklist

1. **Acceptance criteria**: Does the implementation satisfy every checkbox in the issue?
2. **Test quality**: Do tests verify behavior through public interfaces? Would they survive an internal refactor?
3. **Simplicity**: Is this the simplest implementation that works? Any unnecessary abstractions?
4. **Security**: XSS, injection, auth bypasses, data leaks?
5. **Patterns**: Does the code follow existing codebase patterns?
6. **Bugs**: Edge cases, off-by-one, null handling, race conditions?
7. **Errors**: Are there any typecheck, lint, or test failures?

## Output

If everything passes all criteria:

<result>
{
  "verdict": "approved",
  "notes": "brief summary of what's good"
}
</result>

If ANY criterion fails — be specific about what to fix:

<result>
{
  "verdict": "needs_fixes",
  "fixItems": ["specific actionable fix 1", "specific actionable fix 2"]
}
</result>
