import { describe, it, expect } from 'vitest';
import {
  CoordinateTransform,
  autoscalePriceRange,
  generateNiceTicks,
  formatPrice,
  formatTime,
  type PriceRange,
  type BarRange,
  type AxisMargins,
} from './CoordinateTransform';

describe('CoordinateTransform', () => {
  const validMargins: AxisMargins = {
    top: 20,
    right: 80,
    bottom: 40,
    left: 0,
  };

  describe('Constructor validation', () => {
    it('should construct successfully with valid dimensions and margins', () => {
      const transform = new CoordinateTransform(800, 600, validMargins);
      expect(transform).toBeInstanceOf(CoordinateTransform);
      expect(transform.getChartWidth()).toBe(720); // 800 - 0 - 80
      expect(transform.getChartHeight()).toBe(540); // 600 - 20 - 40
    });

    it('should throw on zero canvas width', () => {
      expect(() => new CoordinateTransform(0, 600, validMargins))
        .toThrow('Invalid canvas dimensions: 0x600. Must be > 0.');
    });

    it('should throw on zero canvas height', () => {
      expect(() => new CoordinateTransform(800, 0, validMargins))
        .toThrow('Invalid canvas dimensions: 800x0. Must be > 0.');
    });

    it('should throw on negative margins', () => {
      const negativeMargins: AxisMargins = { top: -10, right: 80, bottom: 40, left: 0 };
      expect(() => new CoordinateTransform(800, 600, negativeMargins))
        .toThrow('Invalid margins:');
    });

    it('should throw when margins are too large for canvas', () => {
      const largeMargins: AxisMargins = { top: 300, right: 80, bottom: 400, left: 0 };
      expect(() => new CoordinateTransform(800, 600, largeMargins))
        .toThrow('Margins too large:');
    });
  });

  describe('setPriceRange validation', () => {
    const transform = new CoordinateTransform(800, 600, validMargins);

    it('should set valid price range', () => {
      const range: PriceRange = { min: 0.67, max: 0.68 };
      transform.setPriceRange(range);
      expect(transform.getPriceRange()).toEqual(range);
    });

    it('should throw when min >= max', () => {
      const range: PriceRange = { min: 0.68, max: 0.67 };
      expect(() => transform.setPriceRange(range))
        .toThrow('Invalid price range: min=0.68, max=0.67. Min must be < max.');
    });

    it('should throw when min equals max', () => {
      const range: PriceRange = { min: 0.67, max: 0.67 };
      expect(() => transform.setPriceRange(range))
        .toThrow('Invalid price range: min=0.67, max=0.67. Min must be < max.');
    });

    it('should throw when min is non-finite', () => {
      const range: PriceRange = { min: Infinity, max: 0.68 };
      expect(() => transform.setPriceRange(range))
        .toThrow('Invalid price range: min=Infinity, max=0.68. Must be finite.');
    });

    it('should throw when max is non-finite', () => {
      const range: PriceRange = { min: 0.67, max: NaN };
      expect(() => transform.setPriceRange(range))
        .toThrow('Invalid price range:');
    });
  });

  describe('setVisibleBarRange validation', () => {
    const transform = new CoordinateTransform(800, 600, validMargins);

    it('should set valid bar range', () => {
      const range: BarRange = { start: 0, end: 99 };
      transform.setVisibleBarRange(range);
      expect(transform.getVisibleBarRange()).toEqual(range);
    });

    it('should allow start to equal end (single bar)', () => {
      const range: BarRange = { start: 50, end: 50 };
      transform.setVisibleBarRange(range);
      expect(transform.getVisibleBarRange()).toEqual(range);
    });

    it('should throw when start > end', () => {
      const range: BarRange = { start: 100, end: 50 };
      expect(() => transform.setVisibleBarRange(range))
        .toThrow('Invalid bar range: start=100, end=50. Start must be <= end.');
    });

    it('should throw when start is non-integer', () => {
      const range: BarRange = { start: 0.5, end: 99 };
      expect(() => transform.setVisibleBarRange(range))
        .toThrow('Invalid bar range: start=0.5, end=99. Must be integers.');
    });

    it('should throw when end is non-integer', () => {
      const range: BarRange = { start: 0, end: 99.7 };
      expect(() => transform.setVisibleBarRange(range))
        .toThrow('Invalid bar range: start=0, end=99.7. Must be integers.');
    });

    it('should throw when start is negative', () => {
      const range: BarRange = { start: -1, end: 99 };
      expect(() => transform.setVisibleBarRange(range))
        .toThrow('Invalid bar range: start=-1, end=99. Must be non-negative.');
    });

    it('should throw when end is negative', () => {
      const range: BarRange = { start: 0, end: -5 };
      expect(() => transform.setVisibleBarRange(range))
        .toThrow('Invalid bar range: start=0, end=-5. Must be non-negative.');
    });
  });

  describe('priceToY / yToPrice round-trip', () => {
    const transform = new CoordinateTransform(800, 600, validMargins);
    const priceRange: PriceRange = { min: 0.67, max: 0.68 };

    it('should throw when priceRange not set', () => {
      expect(() => transform.priceToY(0.675))
        .toThrow('Cannot convert price to Y: priceRange not set. Call setPriceRange() first.');
    });

    it('should convert min price to bottom Y', () => {
      transform.setPriceRange(priceRange);
      const y = transform.priceToY(priceRange.min);
      // Bottom Y = margins.top + chartHeight = 20 + 540 = 560
      expect(y).toBeCloseTo(560, 6);
    });

    it('should convert max price to top Y', () => {
      transform.setPriceRange(priceRange);
      const y = transform.priceToY(priceRange.max);
      // Top Y = margins.top = 20
      expect(y).toBeCloseTo(20, 6);
    });

    it('should convert mid price to middle Y', () => {
      transform.setPriceRange(priceRange);
      const midPrice = (priceRange.min + priceRange.max) / 2; // 0.675
      const y = transform.priceToY(midPrice);
      // Middle Y = margins.top + chartHeight/2 = 20 + 270 = 290
      expect(y).toBeCloseTo(290, 6);
    });

    it('should round-trip min price', () => {
      transform.setPriceRange(priceRange);
      const y = transform.priceToY(priceRange.min);
      const price = transform.yToPrice(y);
      expect(price).toBeCloseTo(priceRange.min, 6);
    });

    it('should round-trip max price', () => {
      transform.setPriceRange(priceRange);
      const y = transform.priceToY(priceRange.max);
      const price = transform.yToPrice(y);
      expect(price).toBeCloseTo(priceRange.max, 6);
    });

    it('should round-trip mid price', () => {
      transform.setPriceRange(priceRange);
      const midPrice = 0.675;
      const y = transform.priceToY(midPrice);
      const price = transform.yToPrice(y);
      expect(price).toBeCloseTo(midPrice, 6);
    });

    it('should throw when price is non-finite', () => {
      transform.setPriceRange(priceRange);
      expect(() => transform.priceToY(NaN))
        .toThrow('Invalid price: NaN. Must be finite.');
    });

    it('should throw when Y is non-finite in yToPrice', () => {
      transform.setPriceRange(priceRange);
      expect(() => transform.yToPrice(Infinity))
        .toThrow('Invalid Y coordinate: Infinity. Must be finite.');
    });
  });

  describe('barIndexToX / xToBarIndex round-trip', () => {
    const transform = new CoordinateTransform(800, 600, validMargins);
    const barRange: BarRange = { start: 0, end: 99 };

    it('should throw when visibleBarRange not set', () => {
      expect(() => transform.barIndexToX(50))
        .toThrow('Cannot convert bar index to X: visibleBarRange not set. Call setVisibleBarRange() first.');
    });

    it('should convert start index to left X', () => {
      transform.setVisibleBarRange(barRange);
      const barWidth = transform.getBarWidth(); // 720 / 100 = 7.2
      const x = transform.barIndexToX(barRange.start);
      // First bar center X = margins.left + barWidth/2 = 0 + 3.6 = 3.6
      expect(x).toBeCloseTo(barWidth / 2, 6);
    });

    it('should convert end index to right X', () => {
      transform.setVisibleBarRange(barRange);
      const barWidth = transform.getBarWidth(); // 720 / 100 = 7.2
      const x = transform.barIndexToX(barRange.end);
      // Last bar center X = margins.left + (99 * 7.2) + 3.6 = 0 + 712.8 + 3.6 = 716.4
      expect(x).toBeCloseTo(99 * barWidth + barWidth / 2, 6);
    });

    it('should convert mid index to middle X', () => {
      transform.setVisibleBarRange(barRange);
      const barWidth = transform.getBarWidth();
      const midIndex = Math.floor((barRange.start + barRange.end) / 2); // 49
      const x = transform.barIndexToX(midIndex);
      // Mid bar center X = margins.left + (49 * 7.2) + 3.6 = 0 + 352.8 + 3.6 = 356.4
      expect(x).toBeCloseTo(49 * barWidth + barWidth / 2, 6);
    });

    it('should round-trip start index with floor behavior', () => {
      transform.setVisibleBarRange(barRange);
      const x = transform.barIndexToX(barRange.start);
      const index = transform.xToBarIndex(x);
      expect(index).toBe(barRange.start);
    });

    it('should round-trip end index with floor behavior', () => {
      transform.setVisibleBarRange(barRange);
      const x = transform.barIndexToX(barRange.end);
      const index = transform.xToBarIndex(x);
      expect(index).toBe(barRange.end);
    });

    it('should round-trip mid index', () => {
      transform.setVisibleBarRange(barRange);
      const midIndex = 49;
      const x = transform.barIndexToX(midIndex);
      const index = transform.xToBarIndex(x);
      expect(index).toBe(midIndex);
    });

    it('should throw when barIndex is non-integer', () => {
      transform.setVisibleBarRange(barRange);
      expect(() => transform.barIndexToX(50.5))
        .toThrow('Invalid bar index: 50.5. Must be an integer.');
    });

    it('should throw when X is non-finite in xToBarIndex', () => {
      transform.setVisibleBarRange(barRange);
      expect(() => transform.xToBarIndex(NaN))
        .toThrow('Invalid X coordinate: NaN. Must be finite.');
    });
  });

  describe('getBarWidth clamping', () => {
    it('should compute normal bar width when in range', () => {
      const transform = new CoordinateTransform(800, 600, validMargins);
      const barRange: BarRange = { start: 0, end: 99 };
      transform.setVisibleBarRange(barRange);
      const barWidth = transform.getBarWidth();
      // chartWidth = 720, visibleBarCount = 100, rawWidth = 7.2
      // Not clamped, should be 7.2
      expect(barWidth).toBeCloseTo(7.2, 6);
    });

    it('should clamp bar width to minimum 2px', () => {
      const transform = new CoordinateTransform(800, 600, validMargins);
      const barRange: BarRange = { start: 0, end: 999 };
      transform.setVisibleBarRange(barRange);
      const barWidth = transform.getBarWidth();
      // chartWidth = 720, visibleBarCount = 1000, rawWidth = 0.72
      // Clamped to 2px
      expect(barWidth).toBe(2);
    });

    it('should clamp bar width to maximum 20px', () => {
      const transform = new CoordinateTransform(800, 600, validMargins);
      const barRange: BarRange = { start: 0, end: 9 };
      transform.setVisibleBarRange(barRange);
      const barWidth = transform.getBarWidth();
      // chartWidth = 720, visibleBarCount = 10, rawWidth = 72
      // Clamped to 20px
      expect(barWidth).toBe(20);
    });
  });

  describe('updateDimensions', () => {
    it('should update dimensions successfully', () => {
      const transform = new CoordinateTransform(800, 600, validMargins);
      transform.updateDimensions(1024, 768);
      expect(transform.getChartWidth()).toBe(944); // 1024 - 0 - 80
      expect(transform.getChartHeight()).toBe(708); // 768 - 20 - 40
    });

    it('should throw on invalid dimensions', () => {
      const transform = new CoordinateTransform(800, 600, validMargins);
      expect(() => transform.updateDimensions(0, 768))
        .toThrow('Invalid canvas dimensions: 0x768. Must be > 0.');
    });

    it('should throw when margins too large for new dimensions', () => {
      const transform = new CoordinateTransform(800, 600, validMargins);
      expect(() => transform.updateDimensions(50, 50))
        .toThrow('Margins too large:');
    });
  });
});

describe('autoscalePriceRange', () => {
  it('should compute range with 2% margin for normal bars', () => {
    const bars = [
      { high: 0.675, low: 0.670 },
      { high: 0.678, low: 0.672 },
      { high: 0.680, low: 0.674 },
    ];
    const range = autoscalePriceRange(bars, 0, 2);
    expect(range).not.toBeNull();
    if (range) {
      // min = 0.670, max = 0.680, span = 0.01, margin = 0.0002
      expect(range.min).toBeCloseTo(0.670 - 0.01 * 0.02, 6);
      expect(range.max).toBeCloseTo(0.680 + 0.01 * 0.02, 6);
    }
  });

  it('should return null for empty bars array', () => {
    const range = autoscalePriceRange([], 0, 0);
    expect(range).toBeNull();
  });

  it('should return null when startIndex > endIndex', () => {
    const bars = [{ high: 0.675, low: 0.670 }];
    const range = autoscalePriceRange(bars, 1, 0);
    expect(range).toBeNull();
  });

  it('should return null when indices out of bounds', () => {
    const bars = [{ high: 0.675, low: 0.670 }];
    const range = autoscalePriceRange(bars, 0, 5);
    expect(range).toBeNull();
  });

  it('should handle single bar with 2% margin', () => {
    const bars = [{ high: 0.675, low: 0.670 }];
    const range = autoscalePriceRange(bars, 0, 0);
    expect(range).not.toBeNull();
    if (range) {
      // span = 0.005, margin = 0.0001
      expect(range.min).toBeCloseTo(0.670 - 0.005 * 0.02, 6);
      expect(range.max).toBeCloseTo(0.675 + 0.005 * 0.02, 6);
    }
  });

  it('should handle zero range with 0.1% artificial spread', () => {
    const bars = [
      { high: 0.675, low: 0.675 },
      { high: 0.675, low: 0.675 },
    ];
    const range = autoscalePriceRange(bars, 0, 1);
    expect(range).not.toBeNull();
    if (range) {
      // epsilon = 0.675 * 0.001 = 0.000675
      // After epsilon: min = 0.674325, max = 0.675675, span = 0.00135
      // margin = 0.00135 * 0.02 = 0.000027
      expect(range.min).toBeCloseTo(0.675 - 0.675 * 0.001 - 0.00135 * 0.02, 6);
      expect(range.max).toBeCloseTo(0.675 + 0.675 * 0.001 + 0.00135 * 0.02, 6);
    }
  });
});

describe('generateNiceTicks', () => {
  it('should generate nice ticks for normal range', () => {
    const range: PriceRange = { min: 0.670, max: 0.680 };
    const ticks = generateNiceTicks(range, 5);
    expect(ticks.length).toBeGreaterThan(0);
    // Should generate ticks at 0.002 intervals (nice number)
    // Verify ticks are evenly spaced
    if (ticks.length > 1) {
      const interval = ticks[1] - ticks[0];
      // Check if interval is a nice number (1, 2, or 5 × 10^n)
      const normalized = interval / Math.pow(10, Math.floor(Math.log10(interval)));
      expect([1, 2, 5, 10]).toContain(Math.round(normalized));
    }
  });

  it('should return empty array for zero range', () => {
    const range: PriceRange = { min: 0.670, max: 0.670 };
    const ticks = generateNiceTicks(range, 5);
    expect(ticks).toEqual([]);
  });

  it('should return empty array for inverted range', () => {
    const range: PriceRange = { min: 0.680, max: 0.670 };
    const ticks = generateNiceTicks(range, 5);
    expect(ticks).toEqual([]);
  });

  it('should return empty array for negative target count', () => {
    const range: PriceRange = { min: 0.670, max: 0.680 };
    const ticks = generateNiceTicks(range, -5);
    expect(ticks).toEqual([]);
  });

  it('should handle very small range', () => {
    const range: PriceRange = { min: 0.6700, max: 0.6701 };
    const ticks = generateNiceTicks(range, 5);
    expect(ticks.length).toBeGreaterThan(0);
    // Verify all ticks are within range
    ticks.forEach(tick => {
      expect(tick).toBeGreaterThanOrEqual(range.min);
      expect(tick).toBeLessThanOrEqual(range.max + 1e-10); // Allow small epsilon
    });
  });

  it('should generate ticks with 1×10^n intervals', () => {
    const range: PriceRange = { min: 0.0, max: 10.0 };
    const ticks = generateNiceTicks(range, 10);
    // Should generate ~10 ticks at interval 1.0
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    expect(ticks.length).toBeLessThanOrEqual(12);
  });

  it('should generate ticks with 2×10^n intervals', () => {
    const range: PriceRange = { min: 0.0, max: 20.0 };
    const ticks = generateNiceTicks(range, 10);
    // Should generate ~10 ticks at interval 2.0
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    expect(ticks.length).toBeLessThanOrEqual(12);
  });

  it('should generate ticks with 5×10^n intervals', () => {
    const range: PriceRange = { min: 0.0, max: 50.0 };
    const ticks = generateNiceTicks(range, 10);
    // Should generate ~10 ticks at interval 5.0
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    expect(ticks.length).toBeLessThanOrEqual(12);
  });
});

describe('formatPrice', () => {
  it('should format small price (<1) with 5 decimals', () => {
    expect(formatPrice(0.67045)).toBe('0.67045');
  });

  it('should format medium price (1-10) with 3 decimals', () => {
    expect(formatPrice(5.123456)).toBe('5.123');
  });

  it('should format large price (>=10) with 2 decimals', () => {
    expect(formatPrice(1234.5678)).toBe('1234.57');
  });

  it('should format negative price correctly', () => {
    expect(formatPrice(-0.67045)).toBe('-0.67045');
  });

  it('should format price at boundary (exactly 1)', () => {
    expect(formatPrice(1.0)).toBe('1.000');
  });

  it('should format price at boundary (exactly 10)', () => {
    expect(formatPrice(10.0)).toBe('10.00');
  });
});

describe('formatTime', () => {
  it('should format epoch timestamp', () => {
    const timestamp = 0;
    expect(formatTime(timestamp)).toBe('00:00');
  });

  it('should format arbitrary timestamp with HH:MM UTC', () => {
    // 2024-01-15 14:30:45.123 UTC = 1705330245123
    const timestamp = 1705330245123;
    expect(formatTime(timestamp)).toBe('14:30');
  });

  it('should format timestamp at midnight', () => {
    // 2024-01-15 00:00:00.000 UTC = 1705276800000
    const timestamp = 1705276800000;
    expect(formatTime(timestamp)).toBe('00:00');
  });

  it('should format timestamp just before midnight', () => {
    // 2024-01-15 23:59:00.000 UTC = 1705363140000
    const timestamp = 1705363140000;
    expect(formatTime(timestamp)).toBe('23:59');
  });
});
