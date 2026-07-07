import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InteractionController, type InteractionControllerCallbacks } from './InteractionController';
import type { CoordinateTransform } from './CoordinateTransform';
import type { ChartViewState } from './ChartViewState';

// Smooth-zoom constants mirrored from InteractionController for expectations.
// zoomFactor = exp(clamp(deltaY, -40, 40) * 0.008)
const ZOOM_OUT_FACTOR = Math.exp(40 * 0.008); // deltaY >= +40  -> ~1.3771
const ZOOM_IN_FACTOR = Math.exp(-40 * 0.008); // deltaY <= -40  -> ~0.7261

describe('InteractionController', () => {
  let canvas: HTMLCanvasElement;
  let mockTransform: CoordinateTransform;
  let mockViewState: ChartViewState;
  let mockCallbacks: InteractionControllerCallbacks;
  let controller: InteractionController;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
    });

    mockTransform = {
      xToBarIndex: vi.fn((x: number) => Math.floor(x / 10)), // x/10
      getBarWidth: vi.fn(() => 10), // 10px per bar
    } as unknown as CoordinateTransform;

    mockViewState = {
      pan: vi.fn(),
      zoom: vi.fn(),
      getState: vi.fn(() => ({
        visibleStart: 100,
        visibleCount: 100,
        followLatest: true,
      })),
    } as unknown as ChartViewState;

    mockCallbacks = {
      onViewChanged: vi.fn(),
      onMouseMove: vi.fn(),
      onMouseLeave: vi.fn(),
    };

    controller = new InteractionController(canvas, mockTransform, mockViewState, mockCallbacks);
  });

  afterEach(() => {
    controller.destroy(); // also detaches any window-level drag listeners
    document.body.removeChild(canvas);
    vi.restoreAllMocks();
  });

  describe('Constructor and Event Listener Attachment', () => {
    it('should attach 4 listeners to the canvas (drag move/up live on window)', () => {
      const canvas2 = document.createElement('canvas');
      document.body.appendChild(canvas2);
      const addEventListenerSpy = vi.spyOn(canvas2, 'addEventListener');

      const c = new InteractionController(canvas2, mockTransform, mockViewState, mockCallbacks);

      expect(addEventListenerSpy).toHaveBeenCalledTimes(4);
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });

      c.destroy();
      document.body.removeChild(canvas2);
    });

    it('should set a grab cursor on the canvas', () => {
      expect(canvas.style.cursor).toBe('grab');
    });
  });

  describe('Drag-Pan Interaction (mousedown → window mousemove → window mouseup)', () => {
    it('should preventDefault on mousedown and show a grabbing cursor', () => {
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 400 });
      const preventDefaultSpy = vi.spyOn(mousedownEvent, 'preventDefault');
      canvas.dispatchEvent(mousedownEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(canvas.style.cursor).toBe('grabbing');
    });

    it('should pan via window mousemove while dragging (drag left → newer bars)', () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      // Move to x=300: deltaX=-100, deltaBars = -(-100)/10 = +10; target=110, current=100 → pan(10)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));

      expect(mockViewState.pan).toHaveBeenCalledWith(10);
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should compute negative deltaBars when dragging right (shows older bars)', () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      // Move to x=500: deltaX=100, deltaBars = -100/10 = -10 → pan(-10)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));

      expect(mockViewState.pan).toHaveBeenCalledWith(-10);
    });

    it('should NOT pan from a bare canvas mousemove (no active drag)', () => {
      // A move with no preceding mousedown drives the crosshair, not a pan.
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200 }));
      expect(mockViewState.pan).not.toHaveBeenCalled();
      expect(mockCallbacks.onMouseMove).toHaveBeenCalled();
    });

    it('should stop panning on window mouseup and restore the grab cursor', () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 350 }));

      expect(canvas.style.cursor).toBe('grab');
      vi.clearAllMocks();

      // Further window moves must not pan (drag listener detached).
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      expect(mockViewState.pan).not.toHaveBeenCalled();

      // And a plain canvas move now drives the crosshair again.
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 100 }));
      expect(mockCallbacks.onMouseMove).toHaveBeenCalled();
    });

    it('should handle multiple drag sequences correctly', () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 350 }));

      vi.clearAllMocks();

      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 300 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));

      expect(mockViewState.pan).toHaveBeenCalled();
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });
  });

  describe('Wheel Interaction', () => {
    it('should prevent default wheel behavior', () => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: 100, clientX: 400 });
      const preventDefaultSpy = vi.spyOn(wheelEvent, 'preventDefault');
      canvas.dispatchEvent(wheelEvent);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should smooth-zoom OUT when vertical deltaY > 0 (anchored at cursor)', () => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 400 }));
      // anchor = xToBarIndex(400) = 40; factor = exp(clamp(100,±40)*0.008)
      expect(mockViewState.zoom).toHaveBeenCalledWith(expect.closeTo(ZOOM_OUT_FACTOR, 5), 40);
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should smooth-zoom IN when vertical deltaY < 0', () => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400 }));
      expect(mockViewState.zoom).toHaveBeenCalledWith(expect.closeTo(ZOOM_IN_FACTOR, 5), 40);
    });

    it('should scale a small trackpad delta gently (no flat 10% jump)', () => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 4, clientX: 400 }));
      const factor = vi.mocked(mockViewState.zoom).mock.calls[0][0];
      expect(factor).toBeGreaterThan(1.0);
      expect(factor).toBeLessThan(1.05); // exp(4*0.008) ≈ 1.032
    });

    it('should treat a pinch (ctrlKey) as a zoom', () => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, clientX: 200, ctrlKey: true }));
      expect(mockViewState.zoom).toHaveBeenCalled();
      expect(mockViewState.pan).not.toHaveBeenCalled();
    });

    it('should PAN (not zoom) on a horizontal two-finger swipe', () => {
      // |deltaX| > |deltaY|, no ctrl -> pan by deltaX / barWidth = 100/10 = 10
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaY: 5, clientX: 400 }));
      expect(mockViewState.pan).toHaveBeenCalledWith(10);
      expect(mockViewState.zoom).not.toHaveBeenCalled();
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should compute the zoom anchor from cursor position', () => {
      vi.mocked(mockTransform.xToBarIndex).mockReturnValue(75);
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, clientX: 750 }));
      expect(mockTransform.xToBarIndex).toHaveBeenCalledWith(750);
      expect(mockViewState.zoom).toHaveBeenCalledWith(expect.closeTo(ZOOM_OUT_FACTOR, 5), 75);
    });
  });

  describe('Crosshair Update (canvas mousemove when NOT dragging)', () => {
    it('should call onMouseMove with correct canvasX, canvasY, barIndex', () => {
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));
      expect(mockCallbacks.onMouseMove).toHaveBeenCalledWith(400, 300, 40);
    });

    it('should compute canvasX/canvasY relative to canvas bounding rect', () => {
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 100, top: 50, right: 900, bottom: 650,
        width: 800, height: 600, x: 100, y: 50, toJSON: () => ({}),
      });
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }));
      expect(mockCallbacks.onMouseMove).toHaveBeenCalledWith(400, 300, 40);
    });

    it('should NOT update the crosshair while dragging', () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      vi.clearAllMocks();
      // A canvas mousemove during a drag is suppressed (pan runs on window instead).
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 100 }));
      expect(mockCallbacks.onMouseMove).not.toHaveBeenCalled();
    });
  });

  describe('Mouse Leave Interaction', () => {
    it('should call onMouseLeave callback', () => {
      canvas.dispatchEvent(new MouseEvent('mouseleave'));
      expect(mockCallbacks.onMouseLeave).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy() - Event Listener Cleanup', () => {
    it('should remove the 4 canvas listeners with matching references', () => {
      const removeEventListenerSpy = vi.spyOn(canvas, 'removeEventListener');
      controller.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
    });

    it('should not trigger callbacks after destroy', () => {
      controller.destroy();
      vi.clearAllMocks();

      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 400 }));
      canvas.dispatchEvent(new MouseEvent('mouseleave'));

      expect(mockCallbacks.onViewChanged).not.toHaveBeenCalled();
      expect(mockCallbacks.onMouseMove).not.toHaveBeenCalled();
      expect(mockCallbacks.onMouseLeave).not.toHaveBeenCalled();
      expect(mockViewState.pan).not.toHaveBeenCalled();
      expect(mockViewState.zoom).not.toHaveBeenCalled();
    });

    it('should detach the window drag listeners when destroyed mid-drag', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 })); // starts drag
      controller.destroy();

      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

      vi.clearAllMocks();
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      expect(mockViewState.pan).not.toHaveBeenCalled();
    });
  });
});
