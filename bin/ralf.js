#!/usr/bin/env node

import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ralfTs = join(__dirname, "..", "ralf.ts")

const child = fork(ralfTs, process.argv.slice(2), {
  execArgv: ["--import", "tsx/esm"],
  stdio: "inherit",
})

child.on("exit", (code) => process.exit(code ?? 1))
