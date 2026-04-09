interface CliCommands {
  run: (opts: { issueNumber: number; dryRun?: boolean }) => Promise<void>;
  status: () => Promise<void>;
  revert: (opts: { issueNumber: number }) => Promise<void>;
  init: () => Promise<void>;
}

interface CliOptions {
  argv: string[];
  commands: CliCommands;
  print?: (msg: string) => void;
}

const HELP_TEXT = "Usage: ralf <command>\n\nCommands:\n  run <number>    Run a trend issue\n  status          Show current status\n  revert <number> Revert a trend issue\n  init            Initialize configuration";

function parseIssueNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n !== Math.floor(n)) return null;
  return n;
}

export async function cli({ argv, commands, print = console.log }: CliOptions): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "run": {
      const issueNumber = parseIssueNumber(args[0]);
      if (issueNumber == null) {
        print("Error: 'run' requires a valid issue number.\n\n" + HELP_TEXT);
        return;
      }
      const dryRun = args.includes("--dry-run");
      await commands.run({ issueNumber, ...(dryRun && { dryRun }) });
      break;
    }
    case "status": {
      await commands.status();
      break;
    }
    case "revert": {
      const issueNumber = parseIssueNumber(args[0]);
      if (issueNumber == null) {
        print("Error: 'revert' requires a valid issue number.\n\n" + HELP_TEXT);
        return;
      }
      await commands.revert({ issueNumber });
      break;
    }
    case "init": {
      await commands.init();
      break;
    }
    default:
      print(HELP_TEXT);
      break;
  }
}

