# Write Failing Test

{{RALF_MD}}

---

## Issue: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

## Architecture Brief (from Plan phase)

{{ARCH_BRIEF}}

## Behavior to Test

{{BEHAVIOR_NAME}} ({{BEHAVIOR_TYPE}})

## All Planned Behaviors (for context, do NOT write tests for these)

{{ALL_BEHAVIORS}}

## CRITICAL RULES

- Write exactly ONE test for the behavior above
- The test MUST FAIL — the implementation does not exist yet
- Test describes WHAT the system does, not HOW it does it internally
- Test uses the public interface only — no reaching into internals
- Test must survive internal refactors (if you rename a private function, the test should still pass)
- Follow existing test patterns in the codebase — explore first
- Do NOT write implementation code — only the test
- Do NOT modify existing tests

## Your Task

1. Explore the codebase: find existing test files, understand test patterns used
2. Write ONE test file (or add to existing) that verifies the behavior
3. The test should read like a specification: "user can login with valid credentials"

## Output

You MUST output exactly one <result> tag with valid JSON:

<result>
{
  "status": "complete",
  "summary": "what the test verifies",
  "testFiles": ["path/to/test.ts"]
}
</result>
