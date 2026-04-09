import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface AcquireLockOptions {
  projectDir: string;
}

export async function acquireLock({ projectDir }: AcquireLockOptions): Promise<void> {
  const lockPath = join(projectDir, ".ralf", ".lock");
  const lockData = JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
  });
  writeFileSync(lockPath, lockData, { flag: "wx" });
}
