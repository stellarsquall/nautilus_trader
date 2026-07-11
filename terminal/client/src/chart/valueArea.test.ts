import { describe, it, expect } from 'vitest';
import { VALUE_AREA_PCT, calculateValueArea, type ValueAreaLevel, type ValueAreaResult } from './valueArea';

describe('VALUE_AREA_PCT', () => {
  it('should export VALUE_AREA_PCT as 0.70', () => {
    expect(VALUE_AREA_PCT).toBe(0.70);
  });
});

describe('ValueAreaResult interface', () => {
  it('should accept objects with vah, val, poc number fields', () => {
    const result: ValueAreaResult = { vah: 1.5, val: 1.0, poc: 1.25 };
    expect(result.vah).toBe(1.5);
    expect(result.val).toBe(1.0);
    expect(result.poc).toBe(1.25);
  });
});

describe('ValueAreaLevel interface', () => {
  it('should accept objects with price and total number fields', () => {
    const level: ValueAreaLevel = { price: 1.5, total: 100 };
    expect(level.price).toBe(1.5);
    expect(level.total).toBe(100);
  });
});

describe('calculateValueArea', () => {
  describe('null/undefined/empty levels (AC-4)', () => {
    it('should return null when levels is null', () => {
      expect(calculateValueArea(null, 100)).toBeNull();
    });

    it('should return null when levels is undefined', () => {
      expect(calculateValueArea(undefined, 100)).toBeNull();
    });

    it('should return null when levels is empty array', () => {
      expect(calculateValueArea([], 100)).toBeNull();
    });
  });

  describe('null/undefined pocPrice (AC-5)', () => {
    it('should return null when pocPrice is null', () => {
      const levels: ValueAreaLevel[] = [{ price: 100, total: 500 }];
      expect(calculateValueArea(levels, null)).toBeNull();
    });

    it('should return null when pocPrice is undefined', () => {
      const levels: ValueAreaLevel[] = [{ price: 100, total: 500 }];
      expect(calculateValueArea(levels, undefined)).toBeNull();
    });
  });

  describe('single-level profile (AC-6)', () => {
    it('should return vah=val=poc for single level', () => {
      const levels: ValueAreaLevel[] = [{ price: 150.25, total: 1000 }];
      const result = calculateValueArea(levels, 150.25);
      expect(result).toEqual({ vah: 150.25, val: 150.25, poc: 150.25 });
    });
  });

  describe('expansion order - larger-total neighbor first (AC-7)', () => {
    it('should expand to larger total neighbor first (left 99 has 10, right 101 has 50 -> right first)', () => {
      const levels: ValueAreaLevel[] = [
        { price: 99, total: 10 },
        { price: 100, total: 100 },
        { price: 101, total: 50 },
      ];
      const result = calculateValueArea(levels, 100);
      expect(result!.vah).toBe(101);
      expect(result!.val).toBe(100);
    });

    it('should expand right first when right neighbor total > left neighbor total, then left if still < target', () => {
      const levels: ValueAreaLevel[] = [
        { price: 98, total: 20 },
        { price: 99, total: 60 },
        { price: 100, total: 100 },
        { price: 101, total: 80 },
      ];
      const result = calculateValueArea(levels, 100);
      expect(result!.vah).toBe(101);
      expect(result!.val).toBe(99);
    });

    it('should expand left first when left neighbor total > right neighbor total', () => {
      const levels: ValueAreaLevel[] = [
        { price: 99, total: 90 },
        { price: 100, total: 100 },
        { price: 101, total: 10 },
        { price: 102, total: 60 },
      ];
      const result = calculateValueArea(levels, 100);
      expect(result!.val).toBe(99);
      expect(result!.vah).toBe(100);
    });
  });

  describe('expansion stops at 70% threshold (AC-8)', () => {
    it('should stop expanding when accumulated volume crosses 70% of total', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 10 },
        { price: 2, total: 25 },
        { price: 3, total: 50 },
        { price: 4, total: 5 },
        { price: 5, total: 10 },
      ];
      const result = calculateValueArea(levels, 3);
      expect(result!.val).toBe(2);
      expect(result!.vah).toBe(3);
    });

    it('should include poc plus neighbors until target is met, then stop without extra levels', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 10 },
        { price: 2, total: 15 },
        { price: 3, total: 20 },
        { price: 4, total: 30 },
        { price: 5, total: 25 },
      ];
      const result = calculateValueArea(levels, 3);
      expect(result!.val).toBe(3);
      expect(result!.vah).toBe(5);
    });
  });

  describe('tie-to-upper rule (AC-9)', () => {
    it('should choose right neighbor when both sides have equal volume', () => {
      const levels: ValueAreaLevel[] = [
        { price: 99, total: 50 },
        { price: 100, total: 100 },
        { price: 101, total: 50 },
      ];
      const result = calculateValueArea(levels, 100);
      expect(result!.vah).toBe(101);
      expect(result!.val).toBe(100);
    });
  });

  describe('VAL <= POC <= VAH invariant (AC-10)', () => {
    it('should satisfy invariant for asymmetric profile with left expansion', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 200 },
        { price: 2, total: 100 },
        { price: 3, total: 50 },
      ];
      const result = calculateValueArea(levels, 2);
      expect(result!.val).toBeLessThanOrEqual(result!.poc);
      expect(result!.poc).toBeLessThanOrEqual(result!.vah);
      expect(result!.val).toBeLessThanOrEqual(result!.vah);
    });

    it('should satisfy invariant for symmetric profile', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 50 },
        { price: 2, total: 100 },
        { price: 3, total: 50 },
      ];
      const result = calculateValueArea(levels, 2);
      expect(result!.val).toBeLessThanOrEqual(result!.poc);
      expect(result!.poc).toBeLessThanOrEqual(result!.vah);
    });

    it('should satisfy invariant when POC is at highest price', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 10 },
        { price: 2, total: 20 },
        { price: 3, total: 100 },
      ];
      const result = calculateValueArea(levels, 3);
      expect(result!.val).toBeLessThanOrEqual(result!.poc);
      expect(result!.poc).toBeLessThanOrEqual(result!.vah);
    });

    it('should satisfy invariant when POC is at lowest price', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 100 },
        { price: 2, total: 20 },
        { price: 3, total: 10 },
      ];
      const result = calculateValueArea(levels, 1);
      expect(result!.val).toBeLessThanOrEqual(result!.poc);
      expect(result!.poc).toBeLessThanOrEqual(result!.vah);
    });
  });

  describe('edge cases', () => {
    it('should handle unsorted input levels', () => {
      const levels: ValueAreaLevel[] = [
        { price: 3, total: 80 },
        { price: 1, total: 90 },
        { price: 2, total: 100 },
      ];
      const result = calculateValueArea(levels, 2);
      expect(result!.val).toBe(1);
      expect(result!.vah).toBe(2);
      expect(result!.poc).toBe(2);
    });

    it('should return null when pocPrice is not found in levels', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 100 },
        { price: 2, total: 200 },
      ];
      expect(calculateValueArea(levels, 999)).toBeNull();
    });

    it('should handle zero total volumes', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1, total: 0 },
        { price: 2, total: 0 },
        { price: 3, total: 0 },
      ];
      const result = calculateValueArea(levels, 2);
      expect(result!.val).toBe(2);
      expect(result!.vah).toBe(2);
      expect(result!.poc).toBe(2);
    });

    it('should handle negative prices', () => {
      const levels: ValueAreaLevel[] = [
        { price: -1, total: 90 },
        { price: 0, total: 100 },
        { price: 1, total: 10 },
      ];
      const result = calculateValueArea(levels, 0);
      expect(result!.val).toBe(-1);
      expect(result!.vah).toBe(0);
      expect(result!.poc).toBe(0);
    });

    it('should handle floating point prices', () => {
      const levels: ValueAreaLevel[] = [
        { price: 1.234, total: 65 },
        { price: 1.235, total: 100 },
        { price: 1.236, total: 10 },
      ];
      const result = calculateValueArea(levels, 1.235);
      expect(result!.val).toBe(1.234);
      expect(result!.vah).toBe(1.235);
      expect(result!.poc).toBe(1.235);
    });
  });
});