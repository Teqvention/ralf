---
requires: [RALF_MD, ISSUE_TITLE, ISSUE_BODY, DIFF, DIFF_STAT, ARCH_BRIEF, PLAN_BEHAVIORS]
---

# Code Review

{{RALF_MD}}

---

## Issue: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

## Planned Behaviors (from Plan phase)

{{PLAN_BEHAVIORS}}

## Architecture Brief

{{ARCH_BRIEF}}

## Diff Summary

{{DIFF_STAT}}

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
8. **Coverage**: Does the implementation cover ALL planned behaviors?
9. **E2E coverage**: Is there at least one E2E test that exercises the critical path end-to-end? If the issue has user-facing behavior and no E2E test exists, flag it as a fixItem.

## Review Red Flags

Watch for these specific anti-patterns:

Tests:
- Mocking your own code instead of external boundaries
- Testing implementation details (spy on internal function) instead of behavior
- Test that would break if you renamed a private method → bad test
- No assertion or trivially passing assertion (e.g., `expect(true).toBe(true)`)

Code:
- Shallow module: interface is as complex as the implementation
- Side effects hidden inside pure-looking functions (logging, process.exit, mutations)
- Dependencies created internally instead of accepted as parameters
- Premature abstraction: helper/util/wrapper used exactly once
- Feature flags or config for something that should just be code

Coverage:
- User-facing feature with only unit tests and no E2E test covering the critical path
- E2E test that doesn't exercise the full path (e.g. only tests a helper, not the real entry point)

Scope:
- Code changes beyond what the behaviors require
- "While I'm here" refactors not in the fix items
- New dependencies added without justification

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
