import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasCandlestickRenderer } from './CanvasCandlestickRenderer';
import type { BarPayload, FootprintPayload } from '../types';
import { ChartViewState } from '../chart/ChartViewState';
import { InteractionController } from '../chart/InteractionController';
import { CrosshairOverlay } from '../chart/CrosshairOverlay';
import { VolumeProfileOverlay } from '../chart/VolumeProfileOverlay';
import { ResetToLatestButton } from '../chart/ResetToLatestButton';

// Mock the interaction components
vi.mock('../chart/ChartViewState', () => {
  return {
    ChartViewState: vi.fn().mockImplementation(() => ({
      getState: vi.fn().mockReturnValue({
        visibleStart: 0,
        visibleCount: 100,
        followLatest: true,
      }),
      setTotalBars: vi.fn(),
      onNewBar: vi.fn(),
      pan: vi.fn(),
      zoom: vi.fn(),
      resetToLatest: vi.fn(),
      setVisibleCount: vi.fn(),
      isAtTail: vi.fn().mockReturnValue(true),
    })),
  };
});

vi.mock('../chart/InteractionController', () => {
  return {
    InteractionController: vi.fn().mockImplementation(() => ({
      destroy: vi.fn(),
    })),
  };
});

vi.mock('../chart/CrosshairOverlay', () => {
  return {
    CrosshairOverlay: vi.fn().mockImplementation(() => ({
      show: vi.fn(),
      hide: vi.fn(),
      setBars: vi.fn(),
      setValueResolver: vi.fn(),
      updateDimensions: vi.fn(),
      destroy: vi.fn(),
    })),
  };
});

vi.mock('../chart/VolumeProfileOverlay', () => {
  return {
    VolumeProfileOverlay: vi.fn().mockImplementation(() => ({
      addFootprint: vi.fn(),
      updateFootprintData: vi.fn(),
      clearFootprints: vi.fn(),
      clear: vi.fn(),
      getFootprintCount: vi.fn().mockReturnValue(0),
      getVolumeAtPrice: vi.fn(() => null),
      updateDimensions: vi.fn(),
      render: vi.fn(),
      setBarsVisible: vi.fn(),
      setValueAreaVisible: vi.fn(),
      isValueAreaVisible: vi.fn().mockReturnValue(true),
      destroy: vi.fn(),
    })),
  };
});

vi.mock('../chart/ResetToLatestButton', () => {
  return {
    ResetToLatestButton: vi.fn().mockImplementation(() => ({
      updateVisibility: vi.fn(),
      destroy: vi.fn(),
    })),
  };
});

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
  clip: vi.fn(),
  rect: vi.fn(),
  setTransform: vi.fn(),
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

  describe('Integration with view-state and interactions', () => {
    it('should instantiate ChartViewState with initialTotalBars=0 and VISIBLE_BARS=100', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      expect(ChartViewState).toHaveBeenCalledWith(0, 100);

      renderer.destroy();
    });

    it('should instantiate CrosshairOverlay with container and transform', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      expect(CrosshairOverlay).toHaveBeenCalledWith(
        container,
        expect.anything() // transform
      );

      renderer.destroy();
    });

    it('should instantiate InteractionController with correct callbacks', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      expect(InteractionController).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement), // canvas
        expect.anything(), // transform
        expect.anything(), // viewState
        expect.objectContaining({
          onViewChanged: expect.any(Function),
          onMouseMove: expect.any(Function),
          onMouseLeave: expect.any(Function),
        })
      );

      renderer.destroy();
    });

    it('should instantiate ResetToLatestButton with correct callbacks', () => {
      const renderer = new CanvasCandlestickRenderer(container);

      expect(ResetToLatestButton).toHaveBeenCalledWith(
        container,
        expect.anything(), // viewState
        expect.objectContaining({
          onReset: expect.any(Function),
        })
      );

      renderer.destroy();
    });

    it('should call viewState.getState() in updateTransformRanges()', () => {
      const mockGetState = vi.fn().mockReturnValue({
        visibleStart: 0,
        visibleCount: 100,
        followLatest: true,
      });

      // @ts-ignore - Mock implementation
      ChartViewState.mockImplementation(() => ({
        getState: mockGetState,
        setTotalBars: vi.fn(),
        onNewBar: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      // Add a bar to trigger updateTransformRanges
      const bar: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      renderer.update(bar);

      // Verify getState was called (at least once for updateTransformRanges)
      expect(mockGetState).toHaveBeenCalled();

      renderer.destroy();
    });

    it('should call onNewBar() (and NOT setTotalBars) when update() receives a new bar', () => {
      const mockSetTotalBars = vi.fn();
      const mockOnNewBar = vi.fn();
      const mockGetState = vi.fn().mockReturnValue({
        visibleStart: 0,
        visibleCount: 100,
        followLatest: true,
      });

      // @ts-ignore - Mock implementation
      ChartViewState.mockImplementation(() => ({
        getState: mockGetState,
        setTotalBars: mockSetTotalBars,
        onNewBar: mockOnNewBar,
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      const bar: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      renderer.update(bar);

      // onNewBar() is the single source of truth: it updates the total AND
      // advances the follow window. setTotalBars() must NOT be called here (a
      // redundant pre-advance corrupts onNewBar's at-tail check and freezes
      // visibleStart at 0, breaking pan once the buffer exceeds visibleCount).
      expect(mockOnNewBar).toHaveBeenCalledWith(1);
      expect(mockSetTotalBars).not.toHaveBeenCalled();

      renderer.destroy();
    });

    it('should call crosshairOverlay.setBars() when update() receives a bar', () => {
      const mockSetBars = vi.fn();

      // @ts-ignore - Mock implementation
      CrosshairOverlay.mockImplementation(() => ({
        setBars: mockSetBars,
        show: vi.fn(),
        hide: vi.fn(),
        setValueResolver: vi.fn(),
        updateDimensions: vi.fn(),
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      const bar: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      renderer.update(bar);

      expect(mockSetBars).toHaveBeenCalled();

      renderer.destroy();
    });

    it('should call resetButton.updateVisibility() when update() receives a bar', () => {
      const mockUpdateVisibility = vi.fn();

      // @ts-ignore - Mock implementation
      ResetToLatestButton.mockImplementation(() => ({
        updateVisibility: mockUpdateVisibility,
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      const bar: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };

      renderer.update(bar);

      expect(mockUpdateVisibility).toHaveBeenCalled();

      renderer.destroy();
    });

    it('should call crosshairOverlay.updateDimensions() on resize', () => {
      const mockUpdateDimensions = vi.fn();

      // @ts-ignore - Mock implementation
      CrosshairOverlay.mockImplementation(() => ({
        setBars: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        setValueResolver: vi.fn(),
        updateDimensions: mockUpdateDimensions,
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      // Trigger resize via ResizeObserver callback
      const resizeObserver = (renderer as any).resizeObserver;
      const resizeCallback = resizeObserver.observe.mock.calls[0];

      // Simulate resize
      (renderer as any).handleResize(900, 700);

      expect(mockUpdateDimensions).toHaveBeenCalledWith(900, 700);

      renderer.destroy();
    });

    it('should call destroy() on all four components when renderer is destroyed', () => {
      const mockInteractionDestroy = vi.fn();
      const mockCrosshairDestroy = vi.fn();
      const mockResetButtonDestroy = vi.fn();

      // @ts-ignore - Mock implementations
      InteractionController.mockImplementation(() => ({
        destroy: mockInteractionDestroy,
      }));

      // @ts-ignore - Mock implementations
      CrosshairOverlay.mockImplementation(() => ({
        setBars: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        setValueResolver: vi.fn(),
        updateDimensions: vi.fn(),
        destroy: mockCrosshairDestroy,
      }));

      // @ts-ignore - Mock implementations
      ResetToLatestButton.mockImplementation(() => ({
        updateVisibility: vi.fn(),
        destroy: mockResetButtonDestroy,
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      renderer.destroy();

      expect(mockInteractionDestroy).toHaveBeenCalled();
      expect(mockCrosshairDestroy).toHaveBeenCalled();
      expect(mockResetButtonDestroy).toHaveBeenCalled();
    });

    it('should trigger updateTransformRanges when InteractionController onViewChanged callback is called', () => {
      let onViewChangedCallback: (() => void) | null = null;

      // @ts-ignore - Mock implementation to capture callback
      InteractionController.mockImplementation((canvas, transform, viewState, callbacks) => {
        onViewChangedCallback = callbacks.onViewChanged;
        return {
          destroy: vi.fn(),
        };
      });

      const mockGetState = vi.fn().mockReturnValue({
        visibleStart: 0,
        visibleCount: 100,
        followLatest: false,
      });

      // @ts-ignore - Mock implementation
      ChartViewState.mockImplementation(() => ({
        getState: mockGetState,
        setTotalBars: vi.fn(),
        onNewBar: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      // Add a bar first so updateTransformRanges has data
      const bar: BarPayload = {
        ts_event: 1000,
        open: 0.67,
        high: 0.671,
        low: 0.669,
        close: 0.670,
        volume: 100,
      };
      renderer.update(bar);

      // Clear previous calls
      mockGetState.mockClear();

      // Trigger the onViewChanged callback
      expect(onViewChangedCallback).not.toBeNull();
      onViewChangedCallback!();

      // Verify getState was called again (by updateTransformRanges)
      expect(mockGetState).toHaveBeenCalled();

      renderer.destroy();
    });

    it('should trigger crosshairOverlay.show when InteractionController onMouseMove callback is called', () => {
      let onMouseMoveCallback: ((canvasX: number, canvasY: number, barIndex: number) => void) | null = null;

      // @ts-ignore - Mock implementation to capture callback
      InteractionController.mockImplementation((canvas, transform, viewState, callbacks) => {
        onMouseMoveCallback = callbacks.onMouseMove;
        return {
          destroy: vi.fn(),
        };
      });

      const mockShow = vi.fn();

      // @ts-ignore - Mock implementation
      CrosshairOverlay.mockImplementation(() => ({
        setBars: vi.fn(),
        show: mockShow,
        hide: vi.fn(),
        setValueResolver: vi.fn(),
        updateDimensions: vi.fn(),
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      // Trigger the onMouseMove callback
      expect(onMouseMoveCallback).not.toBeNull();
      onMouseMoveCallback!(100, 200, 5);

      expect(mockShow).toHaveBeenCalledWith({
        canvasX: 100,
        canvasY: 200,
        barIndex: 5,
      });

      renderer.destroy();
    });

    it('should trigger crosshairOverlay.hide when InteractionController onMouseLeave callback is called', () => {
      let onMouseLeaveCallback: (() => void) | null = null;

      // @ts-ignore - Mock implementation to capture callback
      InteractionController.mockImplementation((canvas, transform, viewState, callbacks) => {
        onMouseLeaveCallback = callbacks.onMouseLeave;
        return {
          destroy: vi.fn(),
        };
      });

      const mockHide = vi.fn();

      // @ts-ignore - Mock implementation
      CrosshairOverlay.mockImplementation(() => ({
        setBars: vi.fn(),
        show: vi.fn(),
        hide: mockHide,
        setValueResolver: vi.fn(),
        updateDimensions: vi.fn(),
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      // Trigger the onMouseLeave callback
      expect(onMouseLeaveCallback).not.toBeNull();
      onMouseLeaveCallback!();

      expect(mockHide).toHaveBeenCalled();

      renderer.destroy();
    });
  });

  describe('updateCvd', () => {
    const bar = (ts: number, delta: number): BarPayload => ({
      ts_event: ts, open: 100, high: 110, low: 95, close: 105, volume: 1000,
      buy_volume: 600, sell_volume: 400, delta,
    });

    it('exposes an updateCvd method', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      expect(typeof renderer.updateCvd).toBe('function');
      renderer.destroy();
    });

    it('accepts a valid CVD payload without throwing', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      renderer.update(bar(1000, 200));
      expect(() => renderer.updateCvd({ ts_event: 1000, cvd: 200, delta: 200 })).not.toThrow();
      renderer.destroy();
    });

    it('rejects an invalid CVD payload and logs an error', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      renderer.updateCvd({ ts_event: 'nope' });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
      renderer.destroy();
    });

    it('tolerates a CVD payload arriving before its bar', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      // No bar with ts 2000 yet; should store and not throw.
      expect(() => renderer.updateCvd({ ts_event: 2000, cvd: 50, delta: 50 })).not.toThrow();
      renderer.update(bar(2000, 50));
      renderer.destroy();
    });
  });

  describe('delta color toggle', () => {
    it('renders a delta-coloring toggle button into the container', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const button = container.querySelector('button');
      expect(button).not.toBeNull();
      expect(button!.textContent).toContain('Color');
      renderer.destroy();
    });

    it('removes the toggle button on destroy', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      expect(container.querySelector('button')).not.toBeNull();
      renderer.destroy();
      expect(container.querySelector('button')).toBeNull();
    });
  });

  describe('Value Area toggle (slice 10)', () => {
    it('renders a standalone VA toggle at top:110 left:64, default VA: On', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const vaButton = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.startsWith('VA:')) as HTMLButtonElement;
      expect(vaButton).toBeTruthy();
      expect(vaButton.textContent).toBe('VA: On');
      expect(vaButton.style.top).toBe('110px');
      expect(vaButton.style.left).toBe('64px');
      renderer.destroy();
    });

    it('clicking the VA toggle flips the label and calls overlay.setValueAreaVisible', () => {
      const mockSetVA = vi.fn();
      (VolumeProfileOverlay as any).mockImplementation(() => ({
        addFootprint: vi.fn(),
        updateFootprintData: vi.fn(),
        clearFootprints: vi.fn(),
        clear: vi.fn(),
        getFootprintCount: vi.fn().mockReturnValue(0),
        getVolumeAtPrice: vi.fn(() => null),
        updateDimensions: vi.fn(),
        render: vi.fn(),
        setBarsVisible: vi.fn(),
        setValueAreaVisible: mockSetVA,
        isValueAreaVisible: vi.fn().mockReturnValue(true),
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      const vaButton = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.startsWith('VA:')) as HTMLButtonElement;

      vaButton.click();
      expect(vaButton.textContent).toBe('VA: Off');
      expect(mockSetVA).toHaveBeenCalledWith(false);

      vaButton.click();
      expect(vaButton.textContent).toBe('VA: On');
      expect(mockSetVA).toHaveBeenCalledWith(true);

      renderer.destroy();
    });

    it('removes the VA toggle button on destroy', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent?.startsWith('VA:'))).toBe(true);
      renderer.destroy();
      expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent?.startsWith('VA:'))).toBe(false);
    });
  });

  describe('Volume Profile toggle (AC1, AC2, AC6)', () => {
    it('renders a Volume Profile toggle button into the container with VP: On text by default', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const buttons = container.querySelectorAll('button');
      // There are two buttons: delta toggle and VP toggle. Find the VP one.
      const vpButton = Array.from(buttons).find(b => b.textContent?.startsWith('VP:'));
      expect(vpButton).not.toBeNull();
      expect(vpButton!.textContent).toBe('VP: On');
      renderer.destroy();
    });

    it('toggles label to VP: Off when clicked (AC1, AC2)', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const buttons = container.querySelectorAll('button');
      const vpButton = Array.from(buttons).find(b => b.textContent?.startsWith('VP:'))!;

      vpButton.click();
      expect(vpButton.textContent).toBe('VP: Off');

      vpButton.click();
      expect(vpButton.textContent).toBe('VP: On');

      renderer.destroy();
    });

    it('removes the VP toggle button on destroy', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const buttons = container.querySelectorAll('button');
      const vpButton = Array.from(buttons).find(b => b.textContent?.startsWith('VP:'));
      expect(vpButton).not.toBeNull();
      renderer.destroy();
      const afterDestroy = container.querySelectorAll('button');
      expect(afterDestroy.length).toBe(0);
    });

    it('toggle state controls overlay visibility without affecting data collection (AC6)', () => {
      const mockAddFootprint = vi.fn();
      (VolumeProfileOverlay as any).mockImplementation(() => ({
        addFootprint: mockAddFootprint,
        updateFootprintData: vi.fn(),
        clearFootprints: vi.fn(),
        clear: vi.fn(),
        getFootprintCount: vi.fn().mockReturnValue(1),
        getVolumeAtPrice: vi.fn(() => null),
        updateDimensions: vi.fn(),
        render: vi.fn(),
        setBarsVisible: vi.fn(),
        setValueAreaVisible: vi.fn(),
        isValueAreaVisible: vi.fn().mockReturnValue(true),
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);

      // Feed footprint data - should always be collected regardless of toggle
      const footprint: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: [] };
      renderer.updateFootprint(footprint);
      expect(mockAddFootprint).toHaveBeenCalledWith(footprint);

      // Toggle OFF
      const buttons = container.querySelectorAll('button');
      const vpButton = Array.from(buttons).find(b => b.textContent?.startsWith('VP:'))!;
      vpButton.click();
      expect(vpButton.textContent).toBe('VP: Off');

      // Data collection should still work
      const footprint2: FootprintPayload = { ts_event: 2000, bin_size: 60000, levels: [] };
      renderer.updateFootprint(footprint2);
      expect(mockAddFootprint).toHaveBeenCalledWith(footprint2);

      renderer.destroy();
    });

    it('clears the overlay only when BOTH VP and VA are off; renders if either is on', () => {
      // The overlay draws to its own canvas. With the standalone Value Area
      // toggle, the overlay renders when EITHER VP-bars or VA is on, and is
      // cleared only when BOTH are off.
      const mockRender = vi.fn();
      const mockClear = vi.fn();
      const mockSetBars = vi.fn();
      const mockSetVA = vi.fn();
      (VolumeProfileOverlay as any).mockImplementation(() => ({
        addFootprint: vi.fn(),
        updateFootprintData: vi.fn(),
        clearFootprints: vi.fn(),
        clear: mockClear,
        getFootprintCount: vi.fn().mockReturnValue(1),
        getVolumeAtPrice: vi.fn(() => null),
        updateDimensions: vi.fn(),
        render: mockRender,
        setBarsVisible: mockSetBars,
        setValueAreaVisible: mockSetVA,
        isValueAreaVisible: vi.fn().mockReturnValue(true),
        destroy: vi.fn(),
      }));

      let rafCb: FrameRequestCallback | null = null;
      const rafSpy = vi
        .spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => { rafCb = cb; return 1; });
      const flush = (): void => { const cb = rafCb; rafCb = null; if (cb) cb(0); };

      const renderer = new CanvasCandlestickRenderer(container);
      for (let i = 0; i < 3; i++) {
        renderer.update({ ts_event: 1000 + i, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 } as any);
      }
      flush();

      const vpButton = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.startsWith('VP:'))!;
      const vaButton = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.startsWith('VA:'))!;

      // VP OFF while VA still ON -> overlay still renders (VA), NOT cleared; bars hidden.
      mockRender.mockClear(); mockClear.mockClear();
      vpButton.click();
      flush();
      expect(vpButton.textContent).toBe('VP: Off');
      expect(mockSetBars).toHaveBeenCalledWith(false);
      expect(mockRender).toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();

      // VA OFF too -> BOTH off -> overlay cleared.
      mockRender.mockClear(); mockClear.mockClear();
      vaButton.click();
      flush();
      expect(vaButton.textContent).toBe('VA: Off');
      expect(mockSetVA).toHaveBeenCalledWith(false);
      expect(mockClear).toHaveBeenCalled();

      // VP ON again -> overlay renders again.
      mockRender.mockClear();
      vpButton.click();
      flush();
      expect(vpButton.textContent).toBe('VP: On');
      expect(mockRender).toHaveBeenCalled();

      rafSpy.mockRestore();
      renderer.destroy();
    });
  });

  describe('updateFootprint (AC3)', () => {
    it('exposes an updateFootprint method', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      expect(typeof renderer.updateFootprint).toBe('function');
      renderer.destroy();
    });

    it('feeds footprint data to VolumeProfileOverlay.addFootprint', () => {
      const mockAddFootprint = vi.fn();
      (VolumeProfileOverlay as any).mockImplementation(() => ({
        addFootprint: mockAddFootprint,
        updateFootprintData: vi.fn(),
        clearFootprints: vi.fn(),
        clear: vi.fn(),
        getFootprintCount: vi.fn().mockReturnValue(0),
        getVolumeAtPrice: vi.fn(() => null),
        updateDimensions: vi.fn(),
        render: vi.fn(),
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      const footprint: FootprintPayload = {
        ts_event: 1000,
        bin_size: 60000,
        levels: [{ price: 100, buy: 10, sell: 5 }],
      };
      renderer.updateFootprint(footprint);
      expect(mockAddFootprint).toHaveBeenCalledWith(footprint);
      renderer.destroy();
    });
  });

  describe('Crosshair volume-at-price integration (AC5)', () => {
    it('value resolver returns volume-at-price when data exists and VP visible', () => {
      const mockGetVolumeAtPrice = vi.fn((price: number) => {
        if (price === 100) {
          return { buy: 200, sell: 100, total: 300 };
        }
        return null;
      });

      (VolumeProfileOverlay as any).mockImplementation(() => ({
        addFootprint: vi.fn(),
        updateFootprintData: vi.fn(),
        clearFootprints: vi.fn(),
        clear: vi.fn(),
        getFootprintCount: vi.fn().mockReturnValue(1),
        getVolumeAtPrice: mockGetVolumeAtPrice,
        updateDimensions: vi.fn(),
        render: vi.fn(),
        destroy: vi.fn(),
      }));

      // Capture the value resolver function
      let capturedResolver: ((y: number) => string | null) | null = null;

      (CrosshairOverlay as any).mockImplementation(() => ({
        setValueResolver: (fn: (y: number) => string | null) => {
          capturedResolver = fn;
        },
        show: vi.fn(),
        hide: vi.fn(),
        setBars: vi.fn(),
        updateDimensions: vi.fn(),
        destroy: vi.fn(),
      }));

      // Mock PaneLayout.yToValue to return price in pane 0
      const renderer = new CanvasCandlestickRenderer(container);
      // Inject a mock yToValue on the paneLayout
      (renderer as any).paneLayout.yToValue = vi.fn((y: number) => {
        return { paneIndex: 0, value: 100 };
      });

      expect(capturedResolver).not.toBeNull();
      const result = capturedResolver!(100);
      expect(result).toBe('V:300 B:200 S:100');

      renderer.destroy();
    });

    it('value resolver returns formatted price when VP not visible', () => {
      let capturedResolver: ((y: number) => string | null) | null = null;

      (VolumeProfileOverlay as any).mockImplementation(() => ({
        addFootprint: vi.fn(),
        updateFootprintData: vi.fn(),
        clearFootprints: vi.fn(),
        clear: vi.fn(),
        getFootprintCount: vi.fn().mockReturnValue(0),
        getVolumeAtPrice: vi.fn(() => null),
        updateDimensions: vi.fn(),
        render: vi.fn(),
        setBarsVisible: vi.fn(),
        setValueAreaVisible: vi.fn(),
        isValueAreaVisible: vi.fn().mockReturnValue(true),
        destroy: vi.fn(),
      }));

      (CrosshairOverlay as any).mockImplementation(() => ({
        setValueResolver: (fn: (y: number) => string | null) => {
          capturedResolver = fn;
        },
        show: vi.fn(),
        hide: vi.fn(),
        setBars: vi.fn(),
        updateDimensions: vi.fn(),
        destroy: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      // Toggle VP OFF
      const buttons = container.querySelectorAll('button');
      const vpButton = Array.from(buttons).find(b => b.textContent?.startsWith('VP:'))!;
      vpButton.click();

      (renderer as any).paneLayout.yToValue = vi.fn((y: number) => {
        return { paneIndex: 0, value: 100.5 };
      });

      expect(capturedResolver).not.toBeNull();
      const result = capturedResolver!(100);
      expect(result).toBe('100.50');

      renderer.destroy();
    });
  });

  describe('getViewportState / restoreViewportState (viewport delegation)', () => {
    const makeBar = (ts: number): BarPayload => ({
      ts_event: ts, open: 100, high: 102, low: 99, close: 101, volume: 500,
    });

    beforeEach(() => {
      // Reset ChartViewState mock to default so subsequent tests get clean state
      (ChartViewState as any).mockImplementation(() => ({
        getState: vi.fn().mockReturnValue({
          visibleStart: 0,
          visibleCount: 100,
          followLatest: true,
        }),
        setTotalBars: vi.fn(),
        onNewBar: vi.fn(),
        pan: vi.fn(),
        zoom: vi.fn(),
        resetToLatest: vi.fn(),
        isAtTail: vi.fn().mockReturnValue(true),
      }));
    });

    it('getViewportState returns anchorTsEvent from right-edge bar', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      renderer.update(makeBar(1000));
      renderer.update(makeBar(2000));
      renderer.update(makeBar(3000));

      const state = renderer.getViewportState();
      expect(state.anchorTsEvent).toBe(3000);
      expect(state.followLatest).toBe(true);

      renderer.destroy();
    });

    it('getViewportState returns null anchorTsEvent when no bars', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      const state = renderer.getViewportState();
      expect(state.anchorTsEvent).toBeNull();
      expect(state.followLatest).toBe(true);
      renderer.destroy();
    });

    it('restoreViewportState with followLatest=true positions at latest bar', () => {
      const mockResetToLatest = vi.fn();
      const mockGetState = vi.fn().mockReturnValue({
        visibleStart: 0, visibleCount: 100, followLatest: true,
      });

      (ChartViewState as any).mockImplementation(() => ({
        getState: mockGetState,
        resetToLatest: mockResetToLatest,
        onNewBar: vi.fn(),
        setTotalBars: vi.fn(),
        pan: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      renderer.update(makeBar(1000));
      renderer.update(makeBar(2000));

      renderer.restoreViewportState({ anchorTsEvent: null, followLatest: true });
      expect(mockResetToLatest).toHaveBeenCalled();

      renderer.destroy();
    });

    it('restoreViewportState with exact anchorTsEvent match positions viewport', () => {
      let capturedPanDelta: number | undefined;
      let capturedGetStateCallCount = 0;

      const mockPan = vi.fn((delta: number) => { capturedPanDelta = delta; });
      const mockGetState = vi.fn(() => {
        capturedGetStateCallCount++;
        return { visibleStart: 0, visibleCount: 100, followLatest: true };
      });

      (ChartViewState as any).mockImplementation(() => ({
        getState: mockGetState,
        pan: mockPan,
        onNewBar: vi.fn(),
        setTotalBars: vi.fn(),
        resetToLatest: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      // Add 5 bars with timestamps 1000, 2000, 3000, 4000, 5000
      for (let i = 1; i <= 5; i++) {
        renderer.update(makeBar(i * 1000));
      }

      // Restore to bar at ts_event=3000 (index 2) with followLatest=false
      renderer.restoreViewportState({ anchorTsEvent: 3000, followLatest: false });

      // With visibleCount=100 and index=2: targetVisibleStart = max(0, 2-100+1) = 0
      // current visibleStart = 0, so delta = 0 - 0 = 0
      expect(capturedPanDelta).toBe(0);

      renderer.destroy();
    });

    it('binary search finds nearest bar when exact ts_event match not found', () => {
      let capturedPanDelta: number | undefined;
      const mockPan = vi.fn((delta: number) => { capturedPanDelta = delta; });
      const mockGetState = vi.fn(() => {
        return { visibleStart: 0, visibleCount: 100, followLatest: false };
      });

      (ChartViewState as any).mockImplementation(() => ({
        getState: mockGetState,
        pan: mockPan,
        onNewBar: vi.fn(),
        setTotalBars: vi.fn(),
        resetToLatest: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      // Bars at 1000, 2000, 4000, 5000 (no bar at 3000)
      renderer.update(makeBar(1000));
      renderer.update(makeBar(2000));
      renderer.update(makeBar(4000));
      renderer.update(makeBar(5000));

      // Restore to ts_event=3000 which falls between 2000 (index 1) and 4000 (index 2)
      // 4000-3000=1000, 3000-2000=1000, tie goes to lower index (1)
      renderer.restoreViewportState({ anchorTsEvent: 3000, followLatest: false });

      // targetVisibleStart = max(0, 1-100+1) = 0, current=0, delta = 0
      expect(capturedPanDelta).toBe(0);

      renderer.destroy();
    });

    it('binary search prefers closer bar from above when exact match not found', () => {
      let capturedPanDelta: number | undefined;
      const mockPan = vi.fn((delta: number) => { capturedPanDelta = delta; });
      const mockGetState = vi.fn(() => {
        return { visibleStart: 0, visibleCount: 100, followLatest: false };
      });

      (ChartViewState as any).mockImplementation(() => ({
        getState: mockGetState,
        pan: mockPan,
        onNewBar: vi.fn(),
        setTotalBars: vi.fn(),
        resetToLatest: vi.fn(),
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      // Bars at 1000, 5000, 10000
      renderer.update(makeBar(1000));
      renderer.update(makeBar(5000));
      renderer.update(makeBar(10000));

      // Restore to ts_event=5100, nearest is 5000 (diff 100 vs 10000 diff 4900)
      // index of 5000 is 1
      renderer.restoreViewportState({ anchorTsEvent: 5100, followLatest: false });

      // targetVisibleStart = max(0, 1-100+1) = 0
      expect(capturedPanDelta).toBe(0);

      renderer.destroy();
    });

    it('restoreViewportState with followLatest=true ignores anchorTsEvent and goes to latest', () => {
      const mockResetToLatest = vi.fn();
      const mockPan = vi.fn();
      const mockGetState = vi.fn().mockReturnValue({
        visibleStart: 0, visibleCount: 100, followLatest: true,
      });

      (ChartViewState as any).mockImplementation(() => ({
        getState: mockGetState,
        pan: mockPan,
        onNewBar: vi.fn(),
        setTotalBars: vi.fn(),
        resetToLatest: mockResetToLatest,
      }));

      const renderer = new CanvasCandlestickRenderer(container);
      renderer.update(makeBar(1000));
      renderer.update(makeBar(2000));

      // Even with anchorTsEvent=1000, followLatest=true should override
      renderer.restoreViewportState({ anchorTsEvent: 1000, followLatest: true });
      expect(mockResetToLatest).toHaveBeenCalled();
      expect(mockPan).not.toHaveBeenCalled();

      renderer.destroy();
    });

    it('restoreViewportState with empty bars does not throw', () => {
      const renderer = new CanvasCandlestickRenderer(container);
      expect(() => {
        renderer.restoreViewportState({ anchorTsEvent: null, followLatest: true });
      }).not.toThrow();
      renderer.destroy();
    });
  });
});
