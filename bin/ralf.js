#!/usr/bin/env node

import { fork } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ralfTs = join(__dirname, "..", "src", "cli.ts")
const tsxEsm = pathToFileURL(join(__dirname, "..", "node_modules", "tsx", "dist", "esm", "index.mjs")).href

const child = fork(ralfTs, process.argv.slice(2), {
  execArgv: ["--import", tsxEsm],
  stdio: "inherit",
})

child.on("exit", (code) => process.exit(code ?? 1))
