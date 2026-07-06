import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasCandlestickRenderer } from './CanvasCandlestickRenderer';
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
  save: vi.fn(),
  restore: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: '',
  textBaseline: '',
});

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

// @ts-ignore
global.ResizeObserver = MockResizeObserver;

describe('CanvasCandlestickRenderer', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Mock clientWidth and clientHeight (jsdom doesn't compute layout)
    Object.defineProperty(container, 'clientWidth', {
      writable: true,
      configurable: true,
      value: 800,
    });
    Object.defineProperty(container, 'clientHeight', {
      writable: true,
      configurable: true,
      value: 600,
    });

    // Mock canvas getContext to return a mock 2D context
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
      if (contextType === '2d') {
        return createMockContext() as any;
      }
      return null;
    });
  });

  afterEach(() => {
    // Restore original getContext
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
  });

  describe('Constructor', () => {
    it('should create canvas and append to container', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      expect(container.querySelector('canvas')).not.toBeNull();

      renderer.destroy();
    });

    it('should throw error if canvas 2D context is null', () => {
      // Override the mock to return null for this test
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null);

      expect(() => new CanvasCandlestickRenderer(container)).toThrow(
        'Failed to get 2D canvas context. Canvas rendering is not supported.'
      );

      // Restore mock to default behavior for subsequent tests
      HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
        if (contextType === '2d') {
          return createMockContext() as any;
        }
        return null;
      });
    });
  });

  describe('update() - append/replace-last/out-of-order', () => {
    it('should append bar with new timestamp', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      const bar1: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      const bar2: BarPayload = {
        ts_event: 2000,
        open: 0.670,
        high: 0.672,
        low: 0.668,
        close: 0.671,
        volume: 150,
      };

      renderer.update(bar1);
      renderer.update(bar2);

      // Access private field for testing
      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(2);
      expect(bars[0].ts_event).toBe(1000);
      expect(bars[1].ts_event).toBe(2000);

      renderer.destroy();
    });

    it('should replace last bar with same timestamp', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      const bar1: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      const bar1Updated: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.672,
        low: 0.668,
        close: 0.671,
        volume: 120,
      };

      renderer.update(bar1);
      renderer.update(bar1Updated);

      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(1);
      expect(bars[0].close).toBe(0.671);
      expect(bars[0].volume).toBe(120);

      renderer.destroy();
    });

    it('should ignore out-of-order bar and log warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const renderer = new CanvasCandlestickRenderer(container);

      const bar1: BarPayload = {
        ts_event: 2000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      const bar2OutOfOrder: BarPayload = {
        ts_event: 1000,
        open: 0.670,
        high: 0.672,
        low: 0.668,
        close: 0.671,
        volume: 150,
      };

      renderer.update(bar1);
      renderer.update(bar2OutOfOrder);

      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(1);
      expect(bars[0].ts_event).toBe(2000);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Out-of-order bar ignored')
      );

      warnSpy.mockRestore();
      renderer.destroy();
    });
  });

  describe('update() - rolling buffer', () => {
    it('should enforce MAX_BARS limit (1000)', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      // Add 1001 bars
      for (let i = 0; i < 1001; i++) {
        const bar: BarPayload = {
          ts_event: i * 1000,
          open: 0.67,
          high: 0.671,
          low: 0.669,
          close: 0.670,
          volume: 100,
        };
        renderer.update(bar);
      }

      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(1000);

      // Oldest bar should be dropped (ts_event=0)
      expect(bars[0].ts_event).toBe(1000);
      expect(bars[bars.length - 1].ts_event).toBe(1000000);

      renderer.destroy();
    });
  });

  describe('update() - invalid payload', () => {
    it('should skip non-object payload and log error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const renderer = new CanvasCandlestickRenderer(container);

      renderer.update('invalid');

      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(
        'Invalid BarPayload received:',
        'invalid'
      );

      errorSpy.mockRestore();
      renderer.destroy();
    });

    it('should skip payload with missing fields and log error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const renderer = new CanvasCandlestickRenderer(container);

      const invalidBar = {
        ts_event: 1000,
        open: 0.67,
        // missing high, low, close, volume
      };

      renderer.update(invalidBar);

      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(0);
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
      renderer.destroy();
    });

    it('should skip payload with non-finite values and log error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const renderer = new CanvasCandlestickRenderer(container);

      const invalidBar = {
        ts_event: 1000,
        open: NaN,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      renderer.update(invalidBar);

      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(0);
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
      renderer.destroy();
    });
  });

  describe('devicePixelRatio sizing', () => {
    it('should set canvas backing store to cssSize × dpr', () => {
      // Mock devicePixelRatio
      Object.defineProperty(window, 'devicePixelRatio', {
        writable: true,
        configurable: true,
        value: 2,
      });

      const renderer = new CanvasCandlestickRenderer(container);
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // Container is 800x600 CSS pixels
      // With dpr=2, backing store should be 1600x1200
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1200);

      // CSS size should remain 800x600
      expect(canvas.style.width).toBe('800px');
      expect(canvas.style.height).toBe('600px');

      renderer.destroy();

      // Restore dpr
      Object.defineProperty(window, 'devicePixelRatio', {
        writable: true,
        configurable: true,
        value: 1,
      });
    });
  });

  describe('destroy()', () => {
    it('should disconnect ResizeObserver, cancel RAF, and remove canvas', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      expect(canvas).not.toBeNull();

      renderer.destroy();

      // Canvas should be removed from DOM
      expect(container.querySelector('canvas')).toBeNull();

      // Bars array should be cleared
      const bars = (renderer as any).bars as BarPayload[];
      expect(bars.length).toBe(0);
    });
  });
});
