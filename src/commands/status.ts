interface StatusState {
  getStatusCounts(): Promise<Record<string, number>>;
}

interface StatusUI {
  emit(event: unknown): void;
}

interface StatusConfig {
  repo: string;
  projectNumber: number;
  statuses: Record<string, string>;
}

interface StatusCommandOptions {
  config: StatusConfig;
  state: StatusState;
  ui: StatusUI;
}

export async function statusCommand({ state, ui }: StatusCommandOptions): Promise<void> {
  const counts = await state.getStatusCounts();
  ui.emit({ type: "status", counts });
}
