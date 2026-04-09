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

export async function cli({ argv, commands, print = console.log }: CliOptions): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "run": {
      const issueNumber = Number(args[0]);
      const dryRun = args.includes("--dry-run");
      await commands.run({ issueNumber, ...(dryRun && { dryRun }) });
      break;
    }
    case "status": {
      await commands.status();
      break;
    }
    case "revert": {
      const issueNumber = Number(args[0]);
      await commands.revert({ issueNumber });
      break;
    }
    default:
      print("Usage: ralf <command>\n\nCommands:\n  run <number>    Run a trend issue\n  status          Show current status\n  revert <number> Revert a trend issue\n  init            Initialize configuration");
      break;
  }
}
