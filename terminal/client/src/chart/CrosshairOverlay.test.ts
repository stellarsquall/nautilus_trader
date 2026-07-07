import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CrosshairOverlay, type CrosshairState } from './CrosshairOverlay';
import { CoordinateTransform, type AxisMargins } from './CoordinateTransform';
import type { BarPayload } from '../types';

// Mock 2D rendering context
const createMockContext = () => ({
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 50 })),
  setLineDash: vi.fn(),
  scale: vi.fn(),
  setTransform: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: '',
  textBaseline: '',
});

describe('CrosshairOverlay', () => {
  let container: HTMLDivElement;
  let transform: CoordinateTransform;
  let overlay: CrosshairOverlay;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let mockContext: ReturnType<typeof createMockContext>;

  const margins: AxisMargins = {
    top: 20,
    right: 80,
    bottom: 40,
    left: 0,
  };

  const sampleBars: BarPayload[] = [
    {
      ts_event: 1609459200000, // 2021-01-01 00:00:00 UTC
      open: 0.67000,
      high: 0.67100,
      low: 0.66900,
      close: 0.67050,
      volume: 1000,
    },
    {
      ts_event: 1609459260000, // 2021-01-01 00:01:00 UTC
      open: 0.67050,
      high: 0.67150,
      low: 0.66950,
      close: 0.67100,
      volume: 1500,
    },
    {
      ts_event: 1609459320000, // 2021-01-01 00:02:00 UTC
      open: 0.67100,
      high: 0.67200,
      low: 0.67000,
      close: 0.67150,
      volume: 2000,
    },
  ];

  beforeEach(() => {
    // Create container
    container = document.createElement('div');
    document.body.appendChild(container);

    // Create a single mock context that will be reused
    mockContext = createMockContext();

    // Mock canvas getContext to return the same mock 2D context
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
      if (contextType === '2d') {
        return mockContext as any;
      }
      return null;
    });

    // Create transform
    transform = new CoordinateTransform(800, 600, margins);
    transform.setPriceRange({ min: 0.66, max: 0.68 });
    transform.setVisibleBarRange({ start: 0, end: 99 });

    // Create overlay
    overlay = new CrosshairOverlay(container, transform);
    overlay.updateDimensions(800, 600);
    overlay.setBars(sampleBars);
  });

  afterEach(() => {
    // Restore original getContext
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
  });

  describe('Constructor and DOM setup', () => {
    it('should create overlay canvas and append to container', () => {
      expect(container.children.length).toBe(1);
      const canvas = container.children[0] as HTMLCanvasElement;
      expect(canvas.tagName).toBe('CANVAS');
      expect(canvas.style.position).toBe('absolute');
      expect(canvas.style.top).toBe('0px');
      expect(canvas.style.left).toBe('0px');
      expect(canvas.style.pointerEvents).toBe('none');
    });

    it('should throw if 2D context is not available', () => {
      // Override the mock to return null for this test
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null);

      const mockContainer = document.createElement('div');

      expect(() => new CrosshairOverlay(mockContainer, transform))
        .toThrow('Failed to get 2D context for overlay canvas');

      // Restore mock to default behavior for subsequent tests
      HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
        if (contextType === '2d') {
          return mockContext as any;
        }
        return null;
      });
    });
  });

  describe('show()', () => {
    it('should make crosshair visible and trigger render', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      overlay.show(state);

      // Verify clearRect was called (clearing canvas)
      expect(mockContext.clearRect).toHaveBeenCalled();
      // Verify drawing methods were called
      expect(mockContext.beginPath).toHaveBeenCalled();
      expect(mockContext.stroke).toHaveBeenCalled();
    });

    it('should render crosshair lines at correct position', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      overlay.show(state);

      // Verify vertical line (from top margin to bottom margin)
      expect(mockContext.moveTo).toHaveBeenCalledWith(400, 20); // top margin
      expect(mockContext.lineTo).toHaveBeenCalledWith(400, 560); // 600 - 40 (bottom margin)

      // Verify horizontal line (from left margin to right margin)
      expect(mockContext.moveTo).toHaveBeenCalledWith(0, 300); // left margin
      expect(mockContext.lineTo).toHaveBeenCalledWith(720, 300); // 800 - 80 (right margin)
    });
  });

  describe('hide()', () => {
    it('should clear overlay canvas', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      // Show first
      overlay.show(state);
      mockContext.clearRect.mockClear();

      // Then hide
      overlay.hide();

      // Verify clearRect was called with full canvas dimensions
      expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    });

    it('should not render after hide is called', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      // Show, then hide
      overlay.show(state);
      overlay.hide();

      // Clear mock calls
      mockContext.stroke.mockClear();
      mockContext.clearRect.mockClear();

      // Try to trigger a render by calling hide again
      overlay.hide();

      // Should only clear, not draw
      expect(mockContext.clearRect).toHaveBeenCalled();
      expect(mockContext.stroke).not.toHaveBeenCalled();
    });
  });

  describe('setBars()', () => {
    it('should update bar reference for OHLC readout', () => {
      const newBars: BarPayload[] = [
        {
          ts_event: 1609459400000,
          open: 0.68000,
          high: 0.68200,
          low: 0.67800,
          close: 0.68100,
          volume: 3000,
        },
      ];

      overlay.setBars(newBars);

      // Show crosshair with valid index
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 0,
      };

      overlay.show(state);

      // Verify that the new bar's data is used
      // Check if OHLC values from the new bar are rendered
      const fillTextCalls = mockContext.fillText.mock.calls.map(call => call[0]);
      const ohlcText = fillTextCalls.join(' ');

      // Should contain values from newBars[0]
      expect(ohlcText).toContain('0.68000'); // open
      expect(ohlcText).toContain('0.68200'); // high
      expect(ohlcText).toContain('0.67800'); // low
      expect(ohlcText).toContain('0.68100'); // close
      expect(ohlcText).toContain('3000'); // volume
    });
  });

  describe('updateDimensions()', () => {
    it('should resize overlay canvas with DPR scaling', () => {
      const canvas = container.children[0] as HTMLCanvasElement;

      overlay.updateDimensions(1000, 800);

      // Check CSS size
      expect(canvas.style.width).toBe('1000px');
      expect(canvas.style.height).toBe('800px');

      // Check backing store size (with DPR)
      const dpr = window.devicePixelRatio || 1;
      expect(canvas.width).toBe(1000 * dpr);
      expect(canvas.height).toBe(800 * dpr);
    });

    it('should update internal dimensions for rendering', () => {
      overlay.updateDimensions(1000, 800);

      const state: CrosshairState = {
        canvasX: 500,
        canvasY: 400,
        barIndex: 1,
      };

      overlay.show(state);

      // Verify clearRect uses new dimensions
      expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 1000, 800);
    });
  });

  describe('destroy()', () => {
    it('should remove overlay canvas from DOM', () => {
      expect(container.children.length).toBe(1);

      overlay.destroy();

      expect(container.children.length).toBe(0);
    });

    it('should handle destroy when canvas is already removed', () => {
      const canvas = container.children[0] as HTMLCanvasElement;
      container.removeChild(canvas);

      // Should not throw
      expect(() => overlay.destroy()).not.toThrow();
    });
  });

  describe('Rendering with valid barIndex', () => {
    it('should draw all elements when barIndex is valid', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      overlay.show(state);

      // Verify all drawing methods were called
      expect(mockContext.beginPath).toHaveBeenCalled(); // crosshair lines
      expect(mockContext.stroke).toHaveBeenCalled(); // crosshair lines, label borders
      expect(mockContext.fillRect).toHaveBeenCalled(); // label backgrounds
      expect(mockContext.fillText).toHaveBeenCalled(); // price, time, OHLC text
    });

    it('should draw price label with correct value', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      overlay.show(state);

      // Extract all text that was drawn
      const textDrawn = mockContext.fillText.mock.calls.map(call => call[0] as string);

      // Price should be drawn (transform.yToPrice(300) should give some value)
      // We expect at least one text element to be a price
      const hasPrice = textDrawn.some(text =>
        typeof text === 'string' && /^\d+\.\d+$/.test(text)
      );
      expect(hasPrice).toBe(true);
    });

    it('should draw time label with formatted timestamp', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      overlay.show(state);

      // Extract all text that was drawn
      const textDrawn = mockContext.fillText.mock.calls.map(call => call[0] as string);

      // Time should be formatted as HH:MM
      // Bar 1 has ts_event: 1609459260000 which is 2021-01-01 00:01:00 UTC
      const hasTime = textDrawn.some(text =>
        typeof text === 'string' && /^\d{2}:\d{2}$/.test(text)
      );
      expect(hasTime).toBe(true);
    });

    it('should draw OHLC readout box with all values', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 1,
      };

      overlay.show(state);

      // Extract all text that was drawn
      const textDrawn = mockContext.fillText.mock.calls.map(call => call[0] as string);

      // OHLC readout should contain O:, H:, L:, C:, V: prefixes
      const allText = textDrawn.join(' ');
      expect(allText).toContain('O:');
      expect(allText).toContain('H:');
      expect(allText).toContain('L:');
      expect(allText).toContain('C:');
      expect(allText).toContain('V:');

      // Check for specific values from sampleBars[1]
      expect(allText).toContain('0.67050'); // open
      expect(allText).toContain('0.67150'); // high
      expect(allText).toContain('0.66950'); // low
      expect(allText).toContain('0.67100'); // close
      expect(allText).toContain('1500'); // volume
    });
  });

  describe('Rendering with out-of-bounds barIndex', () => {
    it('should skip OHLC and time labels when barIndex is negative', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: -1,
      };

      overlay.show(state);

      // Extract all text that was drawn
      const textDrawn = mockContext.fillText.mock.calls.map(call => call[0] as string);
      const allText = textDrawn.join(' ');

      // Should NOT contain OHLC labels
      expect(allText).not.toContain('O:');
      expect(allText).not.toContain('H:');
      expect(allText).not.toContain('L:');
      expect(allText).not.toContain('C:');
      expect(allText).not.toContain('V:');

      // Should NOT contain time (HH:MM format)
      const hasTime = textDrawn.some(text =>
        typeof text === 'string' && /^\d{2}:\d{2}$/.test(text)
      );
      expect(hasTime).toBe(false);

      // But should still draw price label
      const hasPrice = textDrawn.some(text =>
        typeof text === 'string' && /^\d+\.\d+$/.test(text)
      );
      expect(hasPrice).toBe(true);
    });

    it('should skip OHLC and time labels when barIndex exceeds array length', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: 999,
      };

      overlay.show(state);

      // Extract all text that was drawn
      const textDrawn = mockContext.fillText.mock.calls.map(call => call[0] as string);
      const allText = textDrawn.join(' ');

      // Should NOT contain OHLC labels
      expect(allText).not.toContain('O:');
      expect(allText).not.toContain('H:');
      expect(allText).not.toContain('L:');
      expect(allText).not.toContain('C:');
      expect(allText).not.toContain('V:');

      // But should still draw price label
      const hasPrice = textDrawn.some(text =>
        typeof text === 'string' && /^\d+\.\d+$/.test(text)
      );
      expect(hasPrice).toBe(true);
    });

    it('should still draw crosshair lines when barIndex is out of bounds', () => {
      const state: CrosshairState = {
        canvasX: 400,
        canvasY: 300,
        barIndex: -1,
      };

      overlay.show(state);

      // Verify lines are drawn (vertical and horizontal)
      expect(mockContext.moveTo).toHaveBeenCalledWith(400, 20); // vertical line start
      expect(mockContext.lineTo).toHaveBeenCalledWith(400, 560); // vertical line end
      expect(mockContext.moveTo).toHaveBeenCalledWith(0, 300); // horizontal line start
      expect(mockContext.lineTo).toHaveBeenCalledWith(720, 300); // horizontal line end
    });
  });

  describe('per-pane value resolver (multi-pane mode)', () => {
    it('should use the resolver for the value label instead of yToPrice', () => {
      const resolver = vi.fn((_y: number) => '1234');
      overlay.setValueResolver(resolver);

      const yToPriceSpy = vi.spyOn(transform, 'yToPrice');

      overlay.show({ canvasX: 400, canvasY: 300, barIndex: 1 });

      // Resolver is consulted with the cursor Y, and its text is drawn...
      expect(resolver).toHaveBeenCalledWith(300);
      const drewResolved = mockContext.fillText.mock.calls.some(
        (c) => c[0] === '1234'
      );
      expect(drewResolved).toBe(true);
      // ...and the single-transform fallback is NOT used for the label.
      expect(yToPriceSpy).not.toHaveBeenCalled();
    });

    it('should suppress the value label when the resolver returns null', () => {
      // Simulate the cursor being outside every pane.
      overlay.setValueResolver(() => null);

      overlay.show({ canvasX: 400, canvasY: 300, barIndex: 1 });

      // Crosshair lines still draw...
      expect(mockContext.moveTo).toHaveBeenCalledWith(400, 20);
      // ...but no value label box is painted for the right margin. The only
      // strokeRect calls (if any) would come from the value box; with a null
      // resolver the label bails before drawing its box.
      // (OHLC readout uses fillRect, not the value-label path.)
      expect(mockContext.strokeRect).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        16
      );
    });

    it('should restore the default yToPrice label when resolver is cleared', () => {
      overlay.setValueResolver(() => '1234');
      overlay.setValueResolver(null);

      const yToPriceSpy = vi.spyOn(transform, 'yToPrice');
      overlay.show({ canvasX: 400, canvasY: 300, barIndex: 1 });

      expect(yToPriceSpy).toHaveBeenCalledWith(300);
    });
  });
});
