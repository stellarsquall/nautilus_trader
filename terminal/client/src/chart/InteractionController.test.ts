import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InteractionController, type InteractionControllerCallbacks } from './InteractionController';
import type { CoordinateTransform } from './CoordinateTransform';
import type { ChartViewState } from './ChartViewState';

describe('InteractionController', () => {
  let canvas: HTMLCanvasElement;
  let mockTransform: CoordinateTransform;
  let mockViewState: ChartViewState;
  let mockCallbacks: InteractionControllerCallbacks;
  let controller: InteractionController;

  beforeEach(() => {
    // Create canvas element
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    // Mock getBoundingClientRect to return predictable values
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Mock CoordinateTransform
    mockTransform = {
      xToBarIndex: vi.fn((x: number) => Math.floor(x / 10)), // Simple mapping: x/10
      getBarWidth: vi.fn(() => 10), // 10px per bar
    } as unknown as CoordinateTransform;

    // Mock ChartViewState
    mockViewState = {
      pan: vi.fn(),
      zoom: vi.fn(),
      getState: vi.fn(() => ({
        visibleStart: 100,
        visibleCount: 100,
        followLatest: true,
      })),
    } as unknown as ChartViewState;

    // Mock callbacks
    mockCallbacks = {
      onViewChanged: vi.fn(),
      onMouseMove: vi.fn(),
      onMouseLeave: vi.fn(),
    };

    // Create controller (this attaches event listeners)
    controller = new InteractionController(
      canvas,
      mockTransform,
      mockViewState,
      mockCallbacks
    );
  });

  afterEach(() => {
    // Clean up
    controller.destroy();
    document.body.removeChild(canvas);
    vi.restoreAllMocks();
  });

  describe('Constructor and Event Listener Attachment', () => {
    it('should attach 5 event listeners to canvas', () => {
      const canvas2 = document.createElement('canvas');
      document.body.appendChild(canvas2);
      const addEventListenerSpy = vi.spyOn(canvas2, 'addEventListener');

      new InteractionController(canvas2, mockTransform, mockViewState, mockCallbacks);

      expect(addEventListenerSpy).toHaveBeenCalledTimes(5);
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function));

      document.body.removeChild(canvas2);
    });
  });

  describe('Drag-Pan Interaction (mousedown → mousemove → mouseup)', () => {
    it('should set isDragging on mousedown and store dragStartX and dragStartVisibleStart', () => {
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 400 });
      canvas.dispatchEvent(mousedownEvent);

      // Verify by triggering mousemove and checking if pan is called
      const mousemoveEvent = new MouseEvent('mousemove', { clientX: 350 });
      canvas.dispatchEvent(mousemoveEvent);

      expect(mockViewState.pan).toHaveBeenCalled();
    });

    it('should call viewState.pan() with correct deltaBars on mousemove while dragging', () => {
      // Start drag at x=400
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));

      // Move to x=300 (deltaX = -100, deltaBars = -(-100)/10 = 10 bars right)
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));

      // Expect pan to be called with deltaBars = 10
      expect(mockViewState.pan).toHaveBeenCalledWith(10);
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should compute negative deltaBars when dragging right (shows older bars)', () => {
      // Start drag at x=400
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));

      // Move to x=500 (deltaX = 100, deltaBars = -100/10 = -10 bars left)
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));

      expect(mockViewState.pan).toHaveBeenCalledWith(-10);
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should trigger onViewChanged callback after pan', () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));

      expect(mockCallbacks.onViewChanged).toHaveBeenCalledTimes(1);
    });

    it('should stop panning on mouseup', () => {
      // Start drag
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));

      // Reset mocks
      vi.clearAllMocks();

      // Stop drag
      canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 350 }));

      // Move mouse again (should NOT trigger pan, but should trigger crosshair update)
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));

      expect(mockViewState.pan).not.toHaveBeenCalled();
      expect(mockCallbacks.onMouseMove).toHaveBeenCalled();
    });

    it('should handle multiple drag sequences correctly', () => {
      // First drag
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
      canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 350 }));

      vi.clearAllMocks();

      // Second drag (starting from new position)
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 300 }));
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));

      expect(mockViewState.pan).toHaveBeenCalled();
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });
  });

  describe('Wheel-Zoom Interaction', () => {
    it('should prevent default wheel behavior', () => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: 100, clientX: 400 });
      const preventDefaultSpy = vi.spyOn(wheelEvent, 'preventDefault');

      canvas.dispatchEvent(wheelEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should zoom out (zoomFactor=1.1) when deltaY > 0', () => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: 100, clientX: 400 });
      canvas.dispatchEvent(wheelEvent);

      // anchorBarIndex = xToBarIndex(400) = 400/10 = 40
      expect(mockViewState.zoom).toHaveBeenCalledWith(1.1, 40);
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should zoom in (zoomFactor=0.9) when deltaY < 0', () => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: -100, clientX: 400 });
      canvas.dispatchEvent(wheelEvent);

      expect(mockViewState.zoom).toHaveBeenCalledWith(0.9, 40);
      expect(mockCallbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should compute correct anchorBarIndex from cursor position', () => {
      // Mock xToBarIndex to return specific value
      vi.mocked(mockTransform.xToBarIndex).mockReturnValue(75);

      const wheelEvent = new WheelEvent('wheel', { deltaY: 50, clientX: 750 });
      canvas.dispatchEvent(wheelEvent);

      expect(mockTransform.xToBarIndex).toHaveBeenCalledWith(750);
      expect(mockViewState.zoom).toHaveBeenCalledWith(1.1, 75);
    });

    it('should handle wheel at canvas edge positions', () => {
      // Zoom at left edge
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 0 }));
      expect(mockViewState.zoom).toHaveBeenCalledWith(1.1, 0);

      vi.clearAllMocks();

      // Zoom at right edge
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 799 }));
      expect(mockViewState.zoom).toHaveBeenCalledWith(1.1, 79);
    });
  });

  describe('Crosshair Update (mousemove when NOT dragging)', () => {
    it('should call onMouseMove with correct canvasX, canvasY, barIndex', () => {
      // Move mouse without dragging
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));

      // canvasX = 400 - 0 = 400, canvasY = 300 - 0 = 300, barIndex = 400/10 = 40
      expect(mockCallbacks.onMouseMove).toHaveBeenCalledWith(400, 300, 40);
    });

    it('should compute canvasX/canvasY relative to canvas bounding rect', () => {
      // Update mock to simulate canvas offset
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 50,
        right: 900,
        bottom: 650,
        width: 800,
        height: 600,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      });

      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }));

      // canvasX = 500 - 100 = 400, canvasY = 350 - 50 = 300
      expect(mockCallbacks.onMouseMove).toHaveBeenCalledWith(400, 300, 40);
    });

    it('should call transform.xToBarIndex with correct canvasX', () => {
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 100 }));

      expect(mockTransform.xToBarIndex).toHaveBeenCalledWith(250);
    });

    it('should NOT call onMouseMove while dragging', () => {
      // Start drag
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));

      vi.clearAllMocks();

      // Move while dragging
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));

      expect(mockCallbacks.onMouseMove).not.toHaveBeenCalled();
      expect(mockViewState.pan).toHaveBeenCalled(); // Pan should be called instead
    });
  });

  describe('Mouse Leave Interaction', () => {
    it('should call onMouseLeave callback', () => {
      canvas.dispatchEvent(new MouseEvent('mouseleave'));

      expect(mockCallbacks.onMouseLeave).toHaveBeenCalledTimes(1);
    });

    it('should call onMouseLeave even while dragging', () => {
      // Start drag
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));

      vi.clearAllMocks();

      // Mouse leaves canvas
      canvas.dispatchEvent(new MouseEvent('mouseleave'));

      expect(mockCallbacks.onMouseLeave).toHaveBeenCalled();
    });
  });

  describe('destroy() - Event Listener Cleanup', () => {
    it('should remove all 5 event listeners with matching references', () => {
      const removeEventListenerSpy = vi.spyOn(canvas, 'removeEventListener');

      controller.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledTimes(5);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
    });

    it('should not trigger callbacks after destroy', () => {
      controller.destroy();

      vi.clearAllMocks();

      // Try to trigger events after destroy
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 400 }));
      canvas.dispatchEvent(new MouseEvent('mouseleave'));

      expect(mockCallbacks.onViewChanged).not.toHaveBeenCalled();
      expect(mockCallbacks.onMouseMove).not.toHaveBeenCalled();
      expect(mockCallbacks.onMouseLeave).not.toHaveBeenCalled();
      expect(mockViewState.pan).not.toHaveBeenCalled();
      expect(mockViewState.zoom).not.toHaveBeenCalled();
    });

    it('should verify addEventListener and removeEventListener call counts match', () => {
      const newCanvas = document.createElement('canvas');
      document.body.appendChild(newCanvas);

      const addSpy = vi.spyOn(newCanvas, 'addEventListener');
      const removeSpy = vi.spyOn(newCanvas, 'removeEventListener');

      const newController = new InteractionController(
        newCanvas,
        mockTransform,
        mockViewState,
        mockCallbacks
      );

      const addCount = addSpy.mock.calls.length;

      newController.destroy();

      const removeCount = removeSpy.mock.calls.length;

      expect(addCount).toBe(5);
      expect(removeCount).toBe(5);

      document.body.removeChild(newCanvas);
    });
  });
});
