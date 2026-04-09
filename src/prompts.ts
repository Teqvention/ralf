/**
 * Prompt loading and hydration.
 *
 * Loads .md prompt templates from .ralf/prompts/ (or built-in defaults),
 * parses YAML frontmatter for required variables, validates and hydrates
 * {{VAR}} placeholders with provided values.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const BUILTIN_PROMPTS_DIR = join(import.meta.dirname, "..", "prompts")

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
const REQUIRES_RE = /requires:\s*\[([^\]]*)\]/

/**
 * Parse YAML frontmatter from a template string.
 * Returns the required variable names and the template body (without frontmatter).
 */
export function parseFrontmatter(raw: string): { requires: string[]; body: string } {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return { requires: [], body: raw }

  const frontmatter = match[1]
  const body = raw.slice(match[0].length)

  const reqMatch = frontmatter.match(REQUIRES_RE)
  if (!reqMatch) return { requires: [], body }

  const requires = reqMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  return { requires, body }
}

/**
 * Load a prompt template by name.
 * Looks in .ralf/prompts/ first, falls back to built-in prompts/.
 */
export function loadPrompt(name: string, projectDir: string = process.cwd()): string {
  const projectPath = join(projectDir, ".ralf", "prompts", `${name}.md`)
  if (existsSync(projectPath)) {
    return readFileSync(projectPath, "utf-8")
  }

  const builtinPath = join(BUILTIN_PROMPTS_DIR, `${name}.md`)
  if (existsSync(builtinPath)) {
    return readFileSync(builtinPath, "utf-8")
  }

  throw new Error(`Prompt template "${name}" not found in .ralf/prompts/ or built-in prompts/`)
}

/**
 * Hydrate a prompt template by replacing {{KEY}} placeholders.
 * Parses frontmatter to validate all required variables are provided.
 */
export function hydrate(template: string, vars: Record<string, string>): string {
  const { requires, body } = parseFrontmatter(template)

  const missing = requires.filter((key) => !(key in vars))
  if (missing.length > 0) {
    throw new Error(`Missing required prompt variables: ${missing.join(", ")}`)
  }

  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    body,
  )
}

/**
 * Load RALF.md project context.
 * Looks in .ralf/RALF.md first, then RALF.md in project root.
 */
export function loadRalfMd(projectDir: string = process.cwd()): string {
  const ralfPath = join(projectDir, ".ralf", "RALF.md")
  if (existsSync(ralfPath)) return readFileSync(ralfPath, "utf-8")

  const rootPath = join(projectDir, "RALF.md")
  if (existsSync(rootPath)) return readFileSync(rootPath, "utf-8")

  return ""
}
