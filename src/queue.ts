import { config } from "./config.ts";

type Task = () => Promise<void>;

/**
 * Fila simples com concorrência limitada e retentativas.
 * Como o backend é idempotente por message_id, retry nunca duplica ação.
 */
export class Queue {
  private pending: Task[] = [];
  private running = 0;

  push(task: Task) {
    this.pending.push(task);
    this.drain();
  }

  private drain() {
    while (this.running < config.queue.concurrency && this.pending.length) {
      const task = this.pending.shift()!;
      this.running += 1;
      void this.run(task).finally(() => {
        this.running -= 1;
        this.drain();
      });
    }
  }

  private async run(task: Task) {
    for (let attempt = 0; attempt <= config.queue.maxRetries; attempt += 1) {
      try {
        await task();
        return;
      } catch (error) {
        const last = attempt === config.queue.maxRetries;
        console.error(`[gateway] falha na tarefa (tentativa ${attempt + 1})`, (error as Error).message);
        if (last) return;
        await new Promise((r) => setTimeout(r, config.queue.retryDelayMs * (attempt + 1)));
      }
    }
  }
}
