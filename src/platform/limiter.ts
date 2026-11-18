import { ApiError } from './errors.js';
// Bounded per-instance backstop, *not* a substitute for shared ingress limits on a deployed fleet.
export class MinuteLimiter {
  private window = -1;
  private readonly hits = new Map<string, number>();
  constructor(
    private readonly limit: number,
    private readonly now = Date.now,
  ) {}
  take(key: string) {
    const minute = Math.floor(this.now() / 60_000);
    if (minute !== this.window) {
      this.hits.clear();
      this.window = minute;
    }
    const count = this.hits.get(key) ?? 0;
    if (count >= this.limit || (count === 0 && this.hits.size >= 10_000))
      throw new ApiError(429, 'rate_limited');
    this.hits.set(key, count + 1);
  }
}
