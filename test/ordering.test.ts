import { describe, it, expect } from "vitest"
import { parseDependencies, topologicalSort, type OrderableIssue } from "../src/ordering.js"

describe("parseDependencies", () => {
  it("parses single depends-on reference", () => {
    expect(parseDependencies("depends-on: #3")).toEqual([3])
  })

  it("parses multiple comma-separated references", () => {
    expect(parseDependencies("depends-on: #3, #4")).toEqual([3, 4])
  })

  it("parses multiple space-separated references", () => {
    expect(parseDependencies("depends-on: #3 #4")).toEqual([3, 4])
  })

  it("parses depends-on with hyphen or space", () => {
    expect(parseDependencies("depends on: #5")).toEqual([5])
  })

  it("returns empty array when no depends-on", () => {
    expect(parseDependencies("No dependencies here")).toEqual([])
  })

  it("deduplicates references", () => {
    expect(parseDependencies("depends-on: #3\ndepends-on: #3")).toEqual([3])
  })

  it("handles depends-on in multiline body", () => {
    const body = `## Overview
Some description

depends-on: #6

## Details
More text`
    expect(parseDependencies(body)).toEqual([6])
  })
})

describe("topologicalSort", () => {
  function issue(number: number, title: string, body: string = ""): OrderableIssue {
    return { number, title, body }
  }

  it("returns issues in order when no dependencies", () => {
    const issues = [issue(3, "A"), issue(4, "B"), issue(5, "C")]
    const sorted = topologicalSort(issues)
    expect(sorted.map((i) => i.number)).toEqual([3, 4, 5])
  })

  it("sorts dependencies before dependents", () => {
    const issues = [
      issue(4, "B", "depends-on: #3"),
      issue(3, "A"),
    ]
    const sorted = topologicalSort(issues)
    expect(sorted.map((i) => i.number)).toEqual([3, 4])
  })

  it("handles chain of dependencies", () => {
    const issues = [
      issue(5, "C", "depends-on: #4"),
      issue(4, "B", "depends-on: #3"),
      issue(3, "A"),
    ]
    const sorted = topologicalSort(issues)
    expect(sorted.map((i) => i.number)).toEqual([3, 4, 5])
  })

  it("handles multiple dependencies", () => {
    const issues = [
      issue(5, "C", "depends-on: #3, #4"),
      issue(3, "A"),
      issue(4, "B"),
    ]
    const sorted = topologicalSort(issues)
    const nums = sorted.map((i) => i.number)
    // 5 must come after both 3 and 4
    expect(nums.indexOf(5)).toBeGreaterThan(nums.indexOf(3))
    expect(nums.indexOf(5)).toBeGreaterThan(nums.indexOf(4))
  })

  it("ignores dependencies outside the issue set", () => {
    const issues = [
      issue(4, "B", "depends-on: #99"),
      issue(3, "A"),
    ]
    const sorted = topologicalSort(issues)
    expect(sorted.map((i) => i.number)).toEqual([4, 3])
  })

  it("throws on dependency cycle", () => {
    const issues = [
      issue(3, "A", "depends-on: #4"),
      issue(4, "B", "depends-on: #3"),
    ]
    expect(() => topologicalSort(issues)).toThrow("cycle")
  })
})
