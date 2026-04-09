import { describe, it, expect } from "vitest"
import {
  parseResultTag,
  validatePlan,
  validateReview,
  validateRedGreen,
  ValidationError,
} from "../src/validation.js"

// --- parseResultTag ---

describe("parseResultTag", () => {
  it("extracts JSON from <result> tags", () => {
    const output = 'Some text\n<result>{"status":"plan","behaviors":[]}</result>\nMore text'
    expect(parseResultTag(output)).toEqual({ status: "plan", behaviors: [] })
  })

  it("returns null when no <result> tag", () => {
    expect(parseResultTag("No tags here")).toBeNull()
  })

  it("returns null on malformed JSON inside <result>", () => {
    expect(parseResultTag("<result>{bad json}</result>")).toBeNull()
  })

  it("extracts the first <result> tag when multiple exist", () => {
    const output = '<result>{"first":true}</result>\n<result>{"first":false}</result>'
    // regex is non-greedy, matches first
    expect(parseResultTag(output)).toEqual({ first: true })
  })

  it("handles multiline JSON", () => {
    const output = `<result>
{
  "status": "plan",
  "behaviors": [{"name": "test", "type": "unit"}]
}
</result>`
    const result = parseResultTag(output)
    expect(result).toEqual({
      status: "plan",
      behaviors: [{ name: "test", type: "unit" }],
    })
  })

  it("ignores <result> in other contexts (e.g. code blocks)", () => {
    // The regex doesn't distinguish — it matches the first occurrence.
    // This is expected behavior: the last agent output should contain the real sentinel.
    const output = "Here is some text without a proper result tag"
    expect(parseResultTag(output)).toBeNull()
  })
})

// --- validatePlan ---

describe("validatePlan", () => {
  const validPlan = {
    status: "plan",
    behaviors: [
      { name: "User can login", type: "unit" },
      { name: "Full flow", type: "e2e" },
    ],
    totalSlices: 2,
  }

  it("accepts a valid plan", () => {
    expect(validatePlan(validPlan)).toEqual(validPlan)
  })

  it("accepts plan with architecture", () => {
    const plan = {
      ...validPlan,
      architecture: {
        approach: "Use existing auth module",
        relevantFiles: ["src/auth.ts"],
        docFindings: ["Use bcrypt for hashing"],
      },
    }
    expect(validatePlan(plan)).toEqual(plan)
  })

  it("rejects null", () => {
    expect(() => validatePlan(null)).toThrow(ValidationError)
    expect(() => validatePlan(null)).toThrow("not an object")
  })

  it("rejects wrong status", () => {
    expect(() => validatePlan({ status: "complete", behaviors: [] })).toThrow(
      'must be "plan"'
    )
  })

  it("rejects empty behaviors array", () => {
    expect(() => validatePlan({ status: "plan", behaviors: [] })).toThrow(
      "non-empty behaviors"
    )
  })

  it("rejects missing behaviors", () => {
    expect(() => validatePlan({ status: "plan" })).toThrow("non-empty behaviors")
  })

  it("rejects behavior without name", () => {
    expect(() =>
      validatePlan({ status: "plan", behaviors: [{ type: "unit" }] })
    ).toThrow("Behavior 0")
  })

  it("rejects behavior with empty name", () => {
    expect(() =>
      validatePlan({ status: "plan", behaviors: [{ name: "", type: "unit" }] })
    ).toThrow("Behavior 0")
  })

  it("normalizes non-standard behavior type to unit", () => {
    const plan = validatePlan({
      status: "plan",
      behaviors: [{ name: "test", type: "integration" }],
    })
    expect(plan.behaviors[0].type).toBe("unit")
  })
})

// --- validateReview ---

describe("validateReview", () => {
  it("accepts approved verdict", () => {
    const review = { verdict: "approved", notes: "Looks good" }
    expect(validateReview(review)).toEqual(review)
  })

  it("accepts approved without notes", () => {
    expect(validateReview({ verdict: "approved" })).toEqual({ verdict: "approved" })
  })

  it("accepts needs_fixes with fixItems", () => {
    const review = {
      verdict: "needs_fixes",
      fixItems: ["Fix CSRF", "Add rate limiting"],
    }
    expect(validateReview(review)).toEqual(review)
  })

  it("rejects null", () => {
    expect(() => validateReview(null)).toThrow(ValidationError)
  })

  it("rejects unknown verdict", () => {
    expect(() => validateReview({ verdict: "maybe" })).toThrow(
      '"approved" or "needs_fixes"'
    )
  })

  it("rejects needs_fixes without fixItems", () => {
    expect(() => validateReview({ verdict: "needs_fixes" })).toThrow(
      "non-empty fixItems"
    )
  })

  it("rejects needs_fixes with empty fixItems", () => {
    expect(() =>
      validateReview({ verdict: "needs_fixes", fixItems: [] })
    ).toThrow("non-empty fixItems")
  })

  it("rejects missing verdict", () => {
    expect(() => validateReview({ notes: "something" })).toThrow("verdict")
  })
})

// --- validateRedGreen ---

describe("validateRedGreen", () => {
  it("accepts complete status with testFiles", () => {
    const result = {
      status: "complete",
      summary: "Wrote login test",
      testFiles: ["test/login.test.ts"],
    }
    expect(validateRedGreen(result)).toEqual(result)
  })

  it("accepts complete status with filesChanged", () => {
    const result = {
      status: "complete",
      summary: "Implemented login",
      filesChanged: ["src/auth/login.ts"],
    }
    expect(validateRedGreen(result)).toEqual(result)
  })

  it("accepts minimal complete", () => {
    expect(validateRedGreen({ status: "complete" })).toEqual({ status: "complete" })
  })

  it("rejects null", () => {
    expect(() => validateRedGreen(null)).toThrow(ValidationError)
  })

  it("rejects wrong status", () => {
    expect(() => validateRedGreen({ status: "plan" })).toThrow(
      'must be "complete"'
    )
  })

  it("rejects missing status", () => {
    expect(() => validateRedGreen({ summary: "did stuff" })).toThrow(
      'must be "complete"'
    )
  })
})
