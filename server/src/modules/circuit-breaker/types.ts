export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export type UpstreamStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  responseTimeThreshold: number;
  slowResponseThreshold: number;
  openStateDuration: number;
  halfOpenMaxRequests: number;
  rateLimitPerSecond: number;
  windowSize: number;
}

export interface UpstreamHealth {
  name: string;
  url: string;
  state: CircuitBreakerState;
  status: UpstreamStatus;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  slowResponseCount: number;
  consecutiveFailures: number;
  avgResponseTime: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  openUntil: number | null;
  rateLimitRemaining: number;
  errorRate: number;
}

interface RequestRecord {
  timestamp: number;
  success: boolean;
  responseTime: number;
  slow: boolean;
}

export class SlidingWindow {
  private records: RequestRecord[] = [];
  private windowSize: number;

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  addRecord(success: boolean, responseTime: number, slow: boolean): void {
    const now = Date.now();
    this.records.push({ timestamp: now, success, responseTime, slow });
    this.purgeOldRecords();
  }

  getStats() {
    this.purgeOldRecords();
    const total = this.records.length;
    const failures = this.records.filter(r => !r.success).length;
    const slowResponses = this.records.filter(r => r.slow).length;
    const avgResponseTime = total > 0
      ? this.records.reduce((sum, r) => sum + r.responseTime, 0) / total
      : 0;
    const consecutiveFailures = this.getConsecutiveFailures();

    return {
      total,
      failures,
      slowResponses,
      avgResponseTime,
      consecutiveFailures,
      errorRate: total > 0 ? failures / total : 0,
    };
  }

  private getConsecutiveFailures(): number {
    let count = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (!this.records[i].success) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private purgeOldRecords(): void {
    const now = Date.now();
    const cutoff = now - this.windowSize;
    this.records = this.records.filter(r => r.timestamp >= cutoff);
  }

  reset(): void {
    this.records = [];
  }
}

export class RateLimiter {
  private tokens: number;
  private capacity: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(perSecond: number) {
    this.capacity = perSecond;
    this.tokens = perSecond;
    this.refillRate = perSecond;
    this.lastRefill = Date.now();
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  getRemaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
