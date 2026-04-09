interface StatusState {
  getStatusCounts(): Promise<Record<string, number>>;
}

interface StatusUI {
  emit(event: unknown): void;
}

interface StatusConfig {
  statuses: Record<string, string>;
}

interface StatusCommandOptions {
  config: StatusConfig;
  state: StatusState;
  ui: StatusUI;
}

export async function statusCommand({ config, state, ui }: StatusCommandOptions): Promise<void> {
  const rawCounts = await state.getStatusCounts();
  const counts: Record<string, number> = {};
  for (const label of Object.values(config.statuses)) {
    counts[label] = rawCounts[label] ?? 0;
  }
  ui.emit({ type: "status", counts });
}
