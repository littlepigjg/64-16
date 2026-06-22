import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';
import { SlidingWindow, RateLimiter } from './types';
import type { CircuitBreakerState } from './types';

describe('SlidingWindow', () => {
  it('should add records and calculate stats correctly', () => {
    const window = new SlidingWindow(60000);
    window.addRecord(true, 100, false);
    window.addRecord(true, 150, false);
    window.addRecord(false, 2000, false);

    const stats = window.getStats();
    expect(stats.total).toBe(3);
    expect(stats.failures).toBe(1);
    expect(stats.consecutiveFailures).toBe(1);
    expect(stats.errorRate).toBeCloseTo(1 / 3);
    expect(stats.avgResponseTime).toBeCloseTo((100 + 150 + 2000) / 3);
  });

  it('should count consecutive failures correctly', () => {
    const window = new SlidingWindow(60000);
    window.addRecord(true, 100, false);
    window.addRecord(false, 200, false);
    window.addRecord(false, 300, false);
    window.addRecord(false, 400, false);

    const stats = window.getStats();
    expect(stats.consecutiveFailures).toBe(3);
  });

  it('should reset consecutive failures on success', () => {
    const window = new SlidingWindow(60000);
    window.addRecord(false, 200, false);
    window.addRecord(false, 300, false);
    window.addRecord(true, 100, false);
    window.addRecord(false, 400, false);

    const stats = window.getStats();
    expect(stats.consecutiveFailures).toBe(1);
  });

  it('should count slow responses', () => {
    const window = new SlidingWindow(60000);
    window.addRecord(true, 100, false);
    window.addRecord(true, 3000, true);
    window.addRecord(false, 5000, true);

    const stats = window.getStats();
    expect(stats.slowResponses).toBe(2);
  });

  it('should purge old records outside window', () => {
    vi.useFakeTimers();
    const window = new SlidingWindow(1000);
    window.addRecord(true, 100, false);

    vi.advanceTimersByTime(2000);
    window.addRecord(true, 150, false);

    const stats = window.getStats();
    expect(stats.total).toBe(1);

    vi.useRealTimers();
  });

  it('should reset all records', () => {
    const window = new SlidingWindow(60000);
    window.addRecord(true, 100, false);
    window.addRecord(false, 200, false);
    window.reset();

    const stats = window.getStats();
    expect(stats.total).toBe(0);
    expect(stats.failures).toBe(0);
    expect(stats.consecutiveFailures).toBe(0);
  });
});

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within limit', () => {
    const limiter = new RateLimiter(5);
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should refill tokens over time', () => {
    const limiter = new RateLimiter(5);
    for (let i = 0; i < 5; i++) {
      limiter.tryAcquire();
    }
    expect(limiter.tryAcquire()).toBe(false);

    vi.advanceTimersByTime(500);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should report remaining tokens correctly', () => {
    const limiter = new RateLimiter(10);
    expect(limiter.getRemaining()).toBe(10);
    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.getRemaining()).toBe(8);
  });
});

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start in closed state', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 3,
      openStateDuration: 30000,
    });
    expect(cb.getState()).toBe('closed');
  });

  it('should allow requests in closed state', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 3,
      rateLimitPerSecond: 100,
    });
    const result = cb.canProceed();
    expect(result.allowed).toBe(true);
  });

  it('should open circuit after consecutive failures exceed threshold', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 3,
      openStateDuration: 30000,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordFailure(100);
    expect(cb.getState()).toBe('closed');

    cb.recordFailure(100);
    expect(cb.getState()).toBe('closed');

    cb.recordFailure(100);
    expect(cb.getState()).toBe('open');
  });

  it('should reject requests when circuit is open', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 2,
      openStateDuration: 30000,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordFailure(100);
    cb.recordFailure(100);
    expect(cb.getState()).toBe('open');

    const result = cb.canProceed();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Circuit breaker is open');
  });

  it('should transition to half-open after open state duration', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 2,
      openStateDuration: 10000,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordFailure(100);
    cb.recordFailure(100);
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(11000);

    const result = cb.canProceed();
    expect(result.allowed).toBe(true);
    expect(cb.getState()).toBe('half-open');
  });

  it('should transition back to closed on successful probes in half-open state', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 2,
      openStateDuration: 10000,
      halfOpenMaxRequests: 3,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordFailure(100);
    cb.recordFailure(100);
    vi.advanceTimersByTime(11000);

    cb.canProceed();
    cb.recordSuccess(100);
    expect(cb.getState()).toBe('half-open');

    cb.canProceed();
    cb.recordSuccess(100);
    expect(cb.getState()).toBe('half-open');

    cb.canProceed();
    cb.recordSuccess(100);
    expect(cb.getState()).toBe('closed');
  });

  it('should transition back to open on failure in half-open state', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 2,
      openStateDuration: 10000,
      halfOpenMaxRequests: 3,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordFailure(100);
    cb.recordFailure(100);
    vi.advanceTimersByTime(11000);

    cb.canProceed();
    cb.recordFailure(100);
    expect(cb.getState()).toBe('open');
  });

  it('should limit requests in half-open state', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 2,
      openStateDuration: 10000,
      halfOpenMaxRequests: 2,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordFailure(100);
    cb.recordFailure(100);
    vi.advanceTimersByTime(11000);

    expect(cb.canProceed().allowed).toBe(true);
    expect(cb.canProceed().allowed).toBe(true);
    expect(cb.canProceed().allowed).toBe(false);
  });

  it('should open circuit when response time exceeds threshold', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      responseTimeThreshold: 5000,
      openStateDuration: 30000,
      rateLimitPerSecond: 100,
      windowSize: 60000,
      failureThreshold: 10,
    });

    cb.recordFailure(6000);
    expect(cb.getState()).toBe('open');
  });

  it('should enforce rate limit', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 10,
      rateLimitPerSecond: 3,
      openStateDuration: 30000,
      windowSize: 60000,
    });

    expect(cb.canProceed().allowed).toBe(true);
    expect(cb.canProceed().allowed).toBe(true);
    expect(cb.canProceed().allowed).toBe(true);
    expect(cb.canProceed().allowed).toBe(false);

    vi.advanceTimersByTime(500);
    expect(cb.canProceed().allowed).toBe(true);
  });

  it('should return correct health status', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 2,
      openStateDuration: 30000,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    let health = cb.getHealth();
    expect(health.name).toBe('test');
    expect(health.url).toBe('http://example.com');
    expect(health.state).toBe('closed');
    expect(health.status).toBe('healthy');
    expect(health.totalRequests).toBe(0);

    cb.recordSuccess(100);
    cb.recordSuccess(150);
    health = cb.getHealth();
    expect(health.totalRequests).toBe(2);
    expect(health.successCount).toBe(2);
    expect(health.avgResponseTime).toBe(125);

    cb.recordFailure(100);
    cb.recordFailure(100);
    health = cb.getHealth();
    expect(health.state).toBe('open');
    expect(health.status).toBe('unhealthy');
    expect(health.failureCount).toBe(2);
    expect(health.consecutiveFailures).toBe(2);
  });

  it('should return degraded status with high error rate', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 10,
      openStateDuration: 30000,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordSuccess(100);
    cb.recordSuccess(100);
    cb.recordFailure(100);
    cb.recordFailure(100);

    const health = cb.getHealth();
    expect(health.state).toBe('closed');
    expect(health.status).toBe('degraded');
  });

  it('should force close and force open', () => {
    const cb = new CircuitBreaker('test', 'http://example.com', {
      failureThreshold: 2,
      openStateDuration: 30000,
      rateLimitPerSecond: 100,
      windowSize: 60000,
    });

    cb.recordFailure(100);
    cb.recordFailure(100);
    expect(cb.getState()).toBe('open');

    cb.forceClose();
    expect(cb.getState()).toBe('closed');

    cb.forceOpen();
    expect(cb.getState()).toBe('open');
  });
});
