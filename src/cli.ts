interface CliCommands {
  run: (opts: { issueNumber: number }) => Promise<void>;
  status: () => Promise<void>;
  revert: () => Promise<void>;
  init: () => Promise<void>;
}

interface CliOptions {
  argv: string[];
  commands: CliCommands;
}

export async function cli({ argv, commands }: CliOptions): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "run": {
      const issueNumber = Number(args[0]);
      await commands.run({ issueNumber });
      break;
    }
    case "status": {
      await commands.status();
      break;
    }
    default:
      break;
  }
}
