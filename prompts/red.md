---
requires: [RALF_MD, ISSUE_TITLE, ISSUE_BODY, BEHAVIOR_NAME, BEHAVIOR_TYPE, ALL_BEHAVIORS, ARCH_BRIEF, RED_RETRY_CONTEXT]
---

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

{{RED_RETRY_CONTEXT}}

## CRITICAL RULES

- Write exactly ONE test for the behavior above
- The test MUST FAIL — the implementation does not exist yet
- Test describes WHAT the system does, not HOW it does it internally
- Test uses the public interface only — no reaching into internals
- Test must survive internal refactors (if you rename a private function, the test should still pass)
- Follow existing test patterns in the codebase — explore first
- Do NOT write implementation code — only the test
- Do NOT modify existing tests

## Design Principles

- Mock ONLY at system boundaries (external APIs, databases, time/randomness). Never mock your own code.
- If a dependency is external, accept it as a parameter (dependency injection)
- Test through the public interface — if you need to reach into internals, the interface is wrong
- Prefer integration-style tests that exercise real code paths

## Testing Examples

GOOD test — tests behavior through public interface, survives refactors:
```ts
it("rejects expired tokens", async () => {
  const token = createToken({ expiresIn: -1 })
  const result = await authenticate(token)
  expect(result.ok).toBe(false)
  expect(result.error).toBe("TOKEN_EXPIRED")
})
```

BAD test — tests internals, breaks on any refactor:
```ts
it("calls validateExpiry", () => {
  const spy = vi.spyOn(tokenUtils, "validateExpiry")
  authenticate(token)
  expect(spy).toHaveBeenCalledWith(token.exp)  // couples to internal implementation
})
```

GOOD mock — external boundary (HTTP API):
```ts
const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({ id: 1 }) })
const client = createClient({ fetch: mockFetch })  // injected dependency
```

BAD mock — mocking your own code:
```ts
vi.mock("../src/utils/parser")  // now testing nothing real
```

If a class is hard to test, that's a design signal — the interface is too wide or dependencies are hidden. Make the dependency injectable rather than mocking around it.

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
