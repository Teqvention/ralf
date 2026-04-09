interface Commit {
  hash: string;
  message: string;
}

interface RevertState {
  findCommitsForIssue(issueNumber: number): Promise<Commit[]>;
  revertIssue(issueNumber: number): Promise<void>;
  deleteBranch(issueNumber: number): Promise<void>;
  resetLabel(issueNumber: number, label: string): Promise<void>;
}

interface RevertUI {
  emit(event: unknown): void;
  prompt(event: unknown): Promise<unknown> | unknown;
}

interface RevertConfig {
  statuses: { todo: string };
}

interface RevertCommandOptions {
  config: RevertConfig;
  state: RevertState;
  ui: RevertUI;
  issueNumber: number;
}

export async function revertCommand({ config, state, ui, issueNumber }: RevertCommandOptions): Promise<void> {
  const commits = await state.findCommitsForIssue(issueNumber);

  if (commits.length === 0) {
    ui.emit({ type: "error", issueNumber, message: `#${issueNumber}: no commits found to revert` });
    return;
  }

  const answer = await ui.prompt({ type: "confirm-revert", issueNumber });

  if (answer === "confirmed") {
    await state.revertIssue(issueNumber);
    await state.deleteBranch(issueNumber);
    await state.resetLabel(issueNumber, config.statuses.todo);
    ui.emit({ type: "revert-complete", issueNumber });
  } else {
    ui.emit({ type: "revert-aborted", issueNumber });
  }
}
