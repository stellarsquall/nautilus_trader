import { describe, it, expect } from 'vitest';

describe('Smoke test', () => {
  it('should verify vitest is working', () => {
    expect(1 + 1).toBe(2);
  });

  it('should verify jsdom environment is loaded', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });
});
