import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

interface InitCommandOptions {
  projectDir: string
}

const CONFIG_TEMPLATE = {
  repo: "owner/repo",
  projectNumber: 1,
  checks: [{ name: "build", command: "npm run build" }],
}

export async function initCommand({ projectDir }: InitCommandOptions): Promise<void> {
  const ralfDir = join(projectDir, ".ralf")
  mkdirSync(ralfDir, { recursive: true })
  writeFileSync(join(ralfDir, "config.json"), JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n")
}
