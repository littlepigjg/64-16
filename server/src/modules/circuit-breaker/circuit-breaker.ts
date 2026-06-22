import { SlidingWindow, RateLimiter, CircuitBreakerConfig, CircuitBreakerState, UpstreamHealth, UpstreamStatus } from './types';

const circuitBreakers = new Map<string, CircuitBreaker>();

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  responseTimeThreshold: 5000,
  slowResponseThreshold: 2000,
  openStateDuration: 30000,
  halfOpenMaxRequests: 3,
  rateLimitPerSecond: 100,
  windowSize: 60000,
};

export class CircuitBreaker {
  private name: string;
  private url: string;
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState = 'closed';
  private openUntil: number | null = null;
  private halfOpenRequests = 0;
  private halfOpenSuccesses = 0;
  private slidingWindow: SlidingWindow;
  private rateLimiter: RateLimiter;
  private totalRequests = 0;
  private successCount = 0;
  private failureCount = 0;
  private slowResponseCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private probeInterval: NodeJS.Timeout | null = null;

  constructor(name: string, url: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.url = url;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.slidingWindow = new SlidingWindow(this.config.windowSize);
    this.rateLimiter = new RateLimiter(this.config.rateLimitPerSecond);
  }

  canProceed(): { allowed: boolean; reason?: string } {
    const now = Date.now();

    if (this.state === 'open') {
      if (this.openUntil && now >= this.openUntil) {
        this.transitionToHalfOpen();
      } else {
        const remaining = this.openUntil ? Math.ceil((this.openUntil - now) / 1000) : 0;
        return {
          allowed: false,
          reason: `Circuit breaker is open. Upstream '${this.name}' is unavailable. Retry after ${remaining}s.`,
        };
      }
    }

    if (this.state === 'half-open' && this.halfOpenRequests >= this.config.halfOpenMaxRequests) {
      return {
        allowed: false,
        reason: `Circuit breaker is in half-open state. Max probe requests reached for '${this.name}'.`,
      };
    }

    if (!this.rateLimiter.tryAcquire()) {
      return {
        allowed: false,
        reason: `Rate limit exceeded for upstream '${this.name}'. Please try again later.`,
      };
    }

    if (this.state === 'half-open') {
      this.halfOpenRequests++;
    }

    return { allowed: true };
  }

  recordSuccess(responseTime: number): void {
    const isSlow = responseTime > this.config.slowResponseThreshold;
    this.slidingWindow.addRecord(true, responseTime, isSlow);
    this.totalRequests++;
    this.successCount++;
    this.lastSuccessTime = Date.now();
    if (isSlow) this.slowResponseCount++;

    if (this.state === 'half-open') {
      this.halfOpenRequests--;
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxRequests) {
        this.transitionToClosed();
      }
    }
  }

  recordFailure(responseTime: number): void {
    const isSlow = responseTime > this.config.slowResponseThreshold;
    this.slidingWindow.addRecord(false, responseTime, isSlow);
    this.totalRequests++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (isSlow) this.slowResponseCount++;

    if (this.state === 'half-open') {
      this.halfOpenRequests--;
      this.transitionToOpen();
      return;
    }

    if (this.state === 'closed') {
      const stats = this.slidingWindow.getStats();
      const minRequestsForErrorRate = this.config.failureThreshold;
      const shouldOpen =
        stats.consecutiveFailures >= this.config.failureThreshold ||
        (stats.total >= minRequestsForErrorRate && stats.errorRate > 0.5) ||
        responseTime > this.config.responseTimeThreshold;

      if (shouldOpen) {
        this.transitionToOpen();
      }
    }
  }

  private transitionToOpen(): void {
    this.state = 'open';
    this.openUntil = Date.now() + this.config.openStateDuration;
    this.halfOpenRequests = 0;
    console.warn(`[CircuitBreaker] '${this.name}' transitioned to OPEN state. Will remain open for ${this.config.openStateDuration / 1000}s`);
    this.startProbe();
  }

  private transitionToHalfOpen(): void {
    this.state = 'half-open';
    this.openUntil = null;
    this.halfOpenRequests = 0;
    this.halfOpenSuccesses = 0;
    this.slidingWindow.reset();
    console.info(`[CircuitBreaker] '${this.name}' transitioned to HALF-OPEN state. Sending probe requests.`);
  }

  private transitionToClosed(): void {
    this.state = 'closed';
    this.openUntil = null;
    this.halfOpenRequests = 0;
    this.slidingWindow.reset();
    this.stopProbe();
    console.info(`[CircuitBreaker] '${this.name}' transitioned to CLOSED state. Upstream is healthy.`);
  }

  private startProbe(): void {
    if (this.probeInterval) return;

    this.probeInterval = setInterval(() => {
      if (this.state === 'open') {
        const now = Date.now();
        if (this.openUntil && now >= this.openUntil) {
          this.transitionToHalfOpen();
        }
      }
    }, 1000);
  }

  private stopProbe(): void {
    if (this.probeInterval) {
      clearInterval(this.probeInterval);
      this.probeInterval = null;
    }
  }

  getHealth(): UpstreamHealth {
    const stats = this.slidingWindow.getStats();
    const remaining = this.rateLimiter.getRemaining();

    let status: UpstreamStatus = 'healthy';
    if (this.state === 'open') {
      status = 'unhealthy';
    } else if (this.state === 'half-open' || stats.errorRate > 0.2 || stats.slowResponses > 5) {
      status = 'degraded';
    }

    return {
      name: this.name,
      url: this.url,
      state: this.state,
      status,
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      failureCount: this.failureCount,
      slowResponseCount: this.slowResponseCount,
      consecutiveFailures: stats.consecutiveFailures,
      avgResponseTime: Math.round(stats.avgResponseTime),
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      openUntil: this.openUntil,
      rateLimitRemaining: remaining,
      errorRate: Math.round(stats.errorRate * 100) / 100,
    };
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getName(): string {
    return this.name;
  }

  getUrl(): string {
    return this.url;
  }

  forceClose(): void {
    this.transitionToClosed();
  }

  forceOpen(): void {
    this.transitionToOpen();
  }

  destroy(): void {
    this.stopProbe();
  }
}

export function getCircuitBreaker(
  name: string,
  url: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  let cb = circuitBreakers.get(name);
  if (!cb) {
    cb = new CircuitBreaker(name, url, config);
    circuitBreakers.set(name, cb);
  }
  return cb;
}

export function getAllCircuitBreakers(): CircuitBreaker[] {
  return Array.from(circuitBreakers.values());
}
