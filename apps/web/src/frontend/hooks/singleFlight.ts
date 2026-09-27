/** Coalesce overlapping poll/refresh requests and ignore a result superseded by a refresh. */
export function singleFlight<T>(fetcher: () => Promise<T>, receive: (result: T) => void):
  { trigger: () => void; stop: () => void } {
  let stopped = false;
  let running = false;
  let queued = false;
  async function run(): Promise<void> {
    if (stopped) return;
    if (running) { queued = true; return; }
    running = true;
    try {
      do {
        queued = false;
        const result = await fetcher();
        if (!stopped && !queued) receive(result);
      } while (!stopped && queued);
    } finally {
      running = false;
    }
  }
  return { trigger: () => { void run(); }, stop: () => { stopped = true; } };
}
