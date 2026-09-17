/**
 * The single local writer. Every store mutation (a tap's events, a pulled
 * page, push results, a checkpoint) runs through here one at a time, so no
 * two transactions overlap and "saved" has one meaning: the commit that
 * carried it has returned. `size` is how many writes are queued or in
 * flight; the UI shows "Saving" while it is above zero.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  private readonly listeners = new Set<(size: number) => void>();

  get size(): number {
    return this.inFlight;
  }

  onChange(listener: (size: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  run<T>(write: () => Promise<T>): Promise<T> {
    this.inFlight += 1;
    this.emit();
    const next = this.tail.then(write, write);
    this.tail = next.catch(() => {});
    return next.finally(() => {
      this.inFlight -= 1;
      this.emit();
    });
  }

  private emit(): void {
    for (const l of this.listeners) l(this.inFlight);
  }
}
