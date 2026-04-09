import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

interface LockOptions {
  projectDir: string;
  force?: boolean;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireLock({ projectDir, force }: LockOptions): Promise<void> {
  const lockPath = join(projectDir, ".ralf", ".lock");
  const lockData = JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
  });

  try {
    writeFileSync(lockPath, lockData, { flag: "wx" });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = JSON.parse(readFileSync(lockPath, "utf-8"));
      if (isProcessAlive(existing.pid) && !force) {
        throw new Error(
          `Lock held by running process ${existing.pid} (since ${existing.timestamp}). Another ralf instance is already running.`,
          { cause: err },
        );
      }
      // Stale lock — overwrite it
      writeFileSync(lockPath, lockData);
      return;
    }
    throw err;
  }
}

export async function releaseLock({ projectDir }: Pick<LockOptions, "projectDir">): Promise<void> {
  const lockPath = join(projectDir, ".ralf", ".lock");
  rmSync(lockPath, { force: true });
}
