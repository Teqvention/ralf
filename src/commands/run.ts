interface Issue {
  number: number;
  title: string;
  body: string;
}

interface ProjectState {
  getIssuesInOrder(): Promise<Issue[]>;
  acquireLock(): Promise<void>;
  releaseLock(): Promise<void>;
  preflight(): Promise<unknown[]>;
  markStuck(issue: Issue, reason: string): Promise<void>;
  startIssue(issue: Issue): Promise<void>;
}

interface IssueEvent {
  type: string;
  [key: string]: unknown;
}

interface IssueProcessor {
  processIssue(issue: Issue): AsyncGenerator<IssueEvent>;
}

interface TerminalUI {
  emit(event: unknown): void;
  prompt(event: unknown): Promise<unknown> | unknown;
  countdown(event: unknown): Promise<unknown> | unknown;
  collapseLastIssue(): void;
  onInterrupt(handler: unknown): void;
  removeInterrupt(handler: unknown): void;
  waitForRateLimit(): void;
}

interface AgentSession {
  continue(answers: string): Promise<unknown>;
  [key: string]: unknown;
}

interface Config {
  issueTimeoutMinutes?: number;
}

interface RunCommandOptions {
  config: Config;
  state: ProjectState;
  processor: IssueProcessor;
  ui: TerminalUI;
  session?: AgentSession;
}

async function processWithTimeout(
  generator: AsyncGenerator<IssueEvent>,
  timeoutMs: number,
  onEvent: (event: IssueEvent) => Promise<void>,
): Promise<{ timedOut: boolean }> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ done: true }>((resolve) => {
    timerId = setTimeout(() => resolve({ done: true }), timeoutMs);
  });

  try {
    while (true) {
      const next = generator.next();
      const result = await Promise.race([
        next.then((r) => ({ kind: "event" as const, ...r })),
        timeout.then(() => ({ kind: "timeout" as const, done: false, value: undefined })),
      ]);

      if (result.kind === "timeout") {
        generator.return(undefined as never);
        return { timedOut: true };
      }
      if (result.done) {
        return { timedOut: false };
      }
      if (result.value) {
        await onEvent(result.value as IssueEvent);
      }
    }
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

export async function runCommand({ config, state, processor, ui, session }: RunCommandOptions): Promise<void> {
  await state.preflight();
  await state.acquireLock();

  try {
    const issues = await state.getIssuesInOrder();
    const timeoutMs = (config.issueTimeoutMinutes ?? 30) * 60 * 1000;

    for (const issue of issues) {
      await state.startIssue(issue);
      const generator = processor.processIssue(issue);

      if (timeoutMs > 0) {
        const { timedOut } = await processWithTimeout(generator, timeoutMs, (event) =>
          handleEvent(event, ui, session),
        );
        if (timedOut) {
          await state.markStuck(issue, "Timeout: issue processing exceeded time limit");
          continue;
        }
      } else {
        for await (const event of generator) {
          await handleEvent(event, ui, session);
        }
      }
    }
  } finally {
    await state.releaseLock();
  }
}

async function handleEvent(event: IssueEvent, ui: TerminalUI, session?: AgentSession): Promise<void> {
  if (event.type === "plan-ready") {
    const promptResult = await ui.prompt({ type: "plan-approval", behaviors: event.behaviors });
    if (promptResult === "approved") {
      return;
    }
    const countdownResult = await ui.countdown({ type: "plan-approval-countdown" });
    if (countdownResult === "rejected") {
      throw new Error("Plan rejected by user");
    }
    // countdown expired → auto-approve, continue processing
  } else if (event.type === "question") {
    const answers = await ui.prompt({ type: "questions", questions: event.questions });
    if (session && typeof answers === "string") {
      await session.continue(answers);
    }
  } else if (event.type === "review-verdict") {
    ui.emit({ ...event, notes: event.notes ?? "" });
  } else {
    ui.emit(event);
  }
}
