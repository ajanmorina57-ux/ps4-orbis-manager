export class ImportWorker {
  constructor(processor, { pollIntervalMs = 2_000, logger = console } = {}) {
    this.processor = processor;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = logger;
    this.running = false;
    this.stopping = false;
    this.controller = undefined;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    void this.poll();
  }

  async stop() {
    this.stopping = true;
    this.controller?.abort(new Error("WORKER_STOPPING"));
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  async poll() {
    while (!this.stopping) {
      this.controller = new AbortController();
      try {
        const claimed = await this.processor.claimAndProcess(this.controller.signal);
        if (!claimed) await delay(this.pollIntervalMs, this.controller.signal).catch(() => {});
      } catch (error) {
        this.logger.error(JSON.stringify({ event: "import.worker.error", name: error?.name ?? "Error" }));
        await delay(this.pollIntervalMs, this.controller.signal).catch(() => {});
      }
    }
    this.controller = undefined;
    this.running = false;
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
