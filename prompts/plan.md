---
requires: [RALF_MD, ISSUE_TITLE, ISSUE_BODY]
---

# TDD Planning: Research, Explore, Plan

{{RALF_MD}}

---

## Issue: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

## RULES

- You are ONLY planning — do NOT write any code or create any files
- Follow the 3 phases below in order
- Each behavior must be user-facing and testable through a public interface
- Behaviors are vertical slices: one test → one implementation path
- You can't test everything — focus on the critical path and complex logic

## Phase 1: Research

Focus research on what THIS issue actually needs. Don't fetch docs for every dependency.

1. Read RALF.md — if it has a Documentation section, fetch each URL via WebFetch
2. Read AGENTS.md / CLAUDE.md — follow any instructions about docs to read
3. Read package.json — identify ONLY dependencies relevant to THIS issue
4. For those dependencies: WebSearch + WebFetch API docs, patterns, known gotchas
5. STOP when you have enough to plan — 3-5 key findings is plenty

## Phase 2: Explore

Understand the existing codebase architecture.

1. Read the file structure (Glob, ls)
2. Read relevant source files — follow imports to understand data flow
3. Identify existing patterns: how are similar features implemented?
4. Note: which files to modify, which patterns to follow, where new code goes

## Phase 3: Plan

Based on your research and exploration, output the plan.

1. Describe your architectural approach in 1-2 sentences
2. List the relevant files and patterns found
3. Summarize key doc findings that RED/GREEN agents need to know
4. List the behaviors to test — describe WHAT the system does, not HOW
5. Order behaviors so each builds on the previous (tracer bullet first)
6. Always include at least one E2E behavior as the final slice. The E2E test exercises the full critical path end-to-end (e.g. HTTP request → handler → database → response, or CLI command → output). Only omit E2E if the issue is purely internal (type refactor, config change, dev tooling) with zero user-facing surface.

## Slicing Strategy

Use vertical slicing — each behavior cuts through ONE complete path from input to output.

GOOD slices (vertical — each is testable end-to-end):
  1. "user can create a project with a name" → validates input, stores, returns
  2. "user sees error for duplicate project name" → builds on slice 1
  3. "user can list projects sorted by creation date" → new read path

BAD slices (horizontal — untestable in isolation):
  1. "add Project type definition" → just types, nothing to test
  2. "implement storage layer" → no entry point to exercise it
  3. "wire up CLI command" → depends on 1 and 2 existing

The first slice is the tracer bullet — pick the thinnest path through the system that proves the architecture works. If that slice fails, the plan is wrong.

Focus on the critical path: what MUST work for the feature to be usable? Complex edge cases and error handling come after the happy path works.

## Output

You MUST output exactly one <result> tag with valid JSON:

<result>
{
  "status": "plan",
  "architecture": {
    "approach": "1-2 sentence description of how this fits into the codebase",
    "relevantFiles": ["path/to/existing/file.ts"],
    "newFiles": ["path/to/new/file.ts"],
    "patterns": ["Follow the pattern in path/to/example.ts"],
    "docFindings": ["Library X: use methodY() not methodZ()", "Best practice: always do ABC"]
  },
  "behaviors": [
    { "name": "user can do X and sees Y", "type": "unit" }
  ],
  "totalSlices": 1
}
</result>
