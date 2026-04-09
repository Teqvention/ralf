import { mkdirSync, writeFileSync, readdirSync, copyFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

interface InitCommandOptions {
  projectDir: string
}

const CONFIG_TEMPLATE = {
  repo: "owner/repo",
  projectNumber: 1,
  checks: [{ name: "build", command: "npm run build" }],
}

const __dirname = resolve(fileURLToPath(import.meta.url), "..")
const PROMPTS_SOURCE_DIR = resolve(__dirname, "..", "..", "prompts")

export async function initCommand({ projectDir }: InitCommandOptions): Promise<void> {
  const ralfDir = join(projectDir, ".ralf")
  mkdirSync(ralfDir, { recursive: true })
  writeFileSync(join(ralfDir, "config.json"), JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n")

  const promptsDestDir = join(ralfDir, "prompts")
  mkdirSync(promptsDestDir, { recursive: true })
  const promptFiles = readdirSync(PROMPTS_SOURCE_DIR).filter((f) => f.endsWith(".md"))
  for (const file of promptFiles) {
    copyFileSync(join(PROMPTS_SOURCE_DIR, file), join(promptsDestDir, file))
  }
}
