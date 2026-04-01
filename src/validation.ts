/**
 * Sentinel parsing and output validation.
 *
 * Extracts <result> JSON from agent text output and validates
 * the schema based on the expected phase.
 */

export interface PlanArchitecture {
  approach: string
  relevantFiles?: string[]
  newFiles?: string[]
  patterns?: string[]
  docFindings?: string[]
}

export interface PlanBehavior {
  name: string
  type: "unit" | "e2e"
}

export interface PlanResult {
  status: "plan"
  architecture?: PlanArchitecture
  behaviors: PlanBehavior[]
  totalSlices?: number
}

export interface RedGreenResult {
  status: "complete"
  summary?: string
  testFiles?: string[]
  filesChanged?: string[]
}

export interface ReviewApproved {
  verdict: "approved"
  notes?: string
}

export interface ReviewNeedsFixes {
  verdict: "needs_fixes"
  fixItems: string[]
}

export type ReviewResult = ReviewApproved | ReviewNeedsFixes

export type AgentResult = PlanResult | RedGreenResult | ReviewResult

// --- Parsing ---

export function parseResultTag(output: string): unknown | null {
  const match = output.match(/<result>([\s\S]*?)<\/result>/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

// --- Validation ---

export function validatePlan(raw: unknown): PlanResult {
  if (raw == null || typeof raw !== "object") {
    throw new ValidationError("Plan output is not an object")
  }
  const obj = raw as Record<string, unknown>
  if (obj.status !== "plan") {
    throw new ValidationError(`Plan status must be "plan", got "${obj.status}"`)
  }
  if (!Array.isArray(obj.behaviors) || obj.behaviors.length === 0) {
    throw new ValidationError("Plan must have a non-empty behaviors array")
  }
  for (let i = 0; i < obj.behaviors.length; i++) {
    const b = obj.behaviors[i]
    if (!b || typeof b !== "object" || typeof b.name !== "string" || !b.name) {
      throw new ValidationError(`Behavior ${i} must have a non-empty "name" string`)
    }
    if (b.type !== "unit" && b.type !== "e2e") {
      throw new ValidationError(`Behavior ${i} type must be "unit" or "e2e", got "${b.type}"`)
    }
  }
  return raw as PlanResult
}

export function validateReview(raw: unknown): ReviewResult {
  if (raw == null || typeof raw !== "object") {
    throw new ValidationError("Review output is not an object")
  }
  const obj = raw as Record<string, unknown>
  if (obj.verdict === "approved") {
    return obj as unknown as ReviewApproved
  }
  if (obj.verdict === "needs_fixes") {
    if (!Array.isArray(obj.fixItems) || obj.fixItems.length === 0) {
      throw new ValidationError('Review with verdict "needs_fixes" must have a non-empty fixItems array')
    }
    return obj as unknown as ReviewNeedsFixes
  }
  throw new ValidationError(`Review verdict must be "approved" or "needs_fixes", got "${obj.verdict}"`)
}

export function validateRedGreen(raw: unknown): RedGreenResult {
  if (raw == null || typeof raw !== "object") {
    throw new ValidationError("RED/GREEN output is not an object")
  }
  const obj = raw as Record<string, unknown>
  if (obj.status !== "complete") {
    throw new ValidationError(`RED/GREEN status must be "complete", got "${obj.status}"`)
  }
  return raw as RedGreenResult
}

// --- Error class ---

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ValidationError"
  }
}
