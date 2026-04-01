/**
 * Prompt loading and hydration.
 *
 * Loads .md prompt templates from .ralf/prompts/ (or built-in defaults),
 * hydrates {{VAR}} placeholders with provided values.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const BUILTIN_PROMPTS_DIR = join(import.meta.dirname, "..", "prompts")

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
 */
export function hydrate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
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
