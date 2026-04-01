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

Fetch documentation for every library/dependency relevant to this issue.

1. Read RALF.md — if it has a Documentation section, fetch each URL via WebFetch
2. Read package.json — identify dependencies relevant to this issue
3. WebSearch + WebFetch best practices and API docs for those dependencies
4. Note key API patterns, gotchas, and recommended approaches

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
6. Include an E2E behavior as the final slice if applicable

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
