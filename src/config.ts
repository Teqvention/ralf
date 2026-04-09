/**
 * Configuration system.
 *
 * Loads and validates .ralf/config.ts using Zod.
 * Provides defineConfig() for type-safe config authoring.
 */
import { z } from "zod/v4"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// --- Schema ---

const CheckSchema = z.object({
  name: z.string(),
  command: z.string(),
})

const StatusesSchema = z.object({
  todo: z.string(),
  inProgress: z.string(),
  inReview: z.string(),
  done: z.string(),
  stuck: z.string(),
})

const AgentsSchema = z.object({
  tdd: z.object({ runtime: z.enum(["claude", "codex", "mock"]) }),
  review: z.object({ runtime: z.enum(["claude", "codex", "mock"]) }),
})

const DEFAULT_STATUSES = {
  todo: "Ready",
  inProgress: "In progress",
  inReview: "In review",
  done: "Done",
  stuck: "Backlog",
}

const DEFAULT_AGENTS = {
  tdd: { runtime: "claude" as const },
  review: { runtime: "claude" as const },
}

export const ConfigSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be in 'owner/repo' format"),
  projectNumber: z.number().int().min(1),
  checks: z.array(CheckSchema).min(1),
  statuses: StatusesSchema.optional(),
  agents: AgentsSchema.optional(),
  maxIterationsPerIssue: z.number().int().min(1).max(10).optional(),
  issueTimeoutMinutes: z.number().int().min(1).max(120).optional(),
})

type AgentRuntime = "claude" | "codex" | "mock"

export type Statuses = { todo: string; inProgress: string; inReview: string; done: string; stuck: string }

export type RalfConfig = {
  repo: string
  projectNumber: number
  checks: { name: string; command: string }[]
  statuses: Statuses
  agents: { tdd: { runtime: AgentRuntime }; review: { runtime: AgentRuntime } }
  maxIterationsPerIssue: number
  issueTimeoutMinutes: number
}

// --- defineConfig ---

export function defineConfig(config: z.input<typeof ConfigSchema>): z.input<typeof ConfigSchema> {
  return config
}

// --- Loading ---

export function loadConfig(projectDir: string = process.cwd()): RalfConfig {
  const configPath = join(projectDir, ".ralf", "config.json")

  if (!existsSync(configPath)) {
    throw new ConfigError(`Config not found at ${configPath}. Run 'ralf init' or create .ralf/config.json`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"))
  } catch (e) {
    throw new ConfigError(`Failed to parse ${configPath}: ${e instanceof Error ? e.message : e}`)
  }

  return validateConfig(raw)
}

export function validateConfig(raw: unknown): RalfConfig {
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new ConfigError(`Invalid config:\n${errors}`)
  }
  const data = result.data
  return {
    repo: data.repo,
    projectNumber: data.projectNumber,
    checks: data.checks,
    statuses: { ...DEFAULT_STATUSES, ...data.statuses },
    agents: {
      tdd: data.agents?.tdd ?? DEFAULT_AGENTS.tdd,
      review: data.agents?.review ?? DEFAULT_AGENTS.review,
    },
    maxIterationsPerIssue: data.maxIterationsPerIssue ?? 3,
    issueTimeoutMinutes: data.issueTimeoutMinutes ?? 30,
  }
}

// --- Error ---

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}
