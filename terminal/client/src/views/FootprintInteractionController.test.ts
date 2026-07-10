import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FootprintInteractionController, type FootprintInteractionControllerCallbacks } from './FootprintInteractionController';
import { FootprintViewState } from './FootprintViewState';

describe('FootprintInteractionController', () => {
  let canvas: HTMLCanvasElement;
  let viewState: FootprintViewState;
  let callbacks: FootprintInteractionControllerCallbacks;
  let controller: FootprintInteractionController;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
    });

    viewState = new FootprintViewState(300, 100);
    callbacks = { onViewChanged: vi.fn() };

    controller = new FootprintInteractionController(canvas, viewState, callbacks);
  });

  afterEach(() => {
    controller.destroy();
    document.body.removeChild(canvas);
    vi.restoreAllMocks();
  });

  describe('Constructor and Event Listener Attachment', () => {
    it('should attach a mousedown listener to the canvas (drag move/up live on window)', () => {
      const canvas2 = document.createElement('canvas');
      document.body.appendChild(canvas2);
      const addEventListenerSpy = vi.spyOn(canvas2, 'addEventListener');

      const c = new FootprintInteractionController(canvas2, viewState, callbacks);

      expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));

      c.destroy();
      document.body.removeChild(canvas2);
    });

    it('should set a grab cursor on the canvas', () => {
      expect(canvas.style.cursor).toBe('grab');
    });
  });

  describe('Drag-Pan Interaction (mousedown -> window mousemove -> window mouseup)', () => {
    it('should preventDefault on mousedown and show a grabbing cursor', () => {
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 400 });
      const preventDefaultSpy = vi.spyOn(mousedownEvent, 'preventDefault');
      canvas.dispatchEvent(mousedownEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(canvas.style.cursor).toBe('grabbing');
    });

    it('should pan right (forward in time) when dragging left', () => {
      // Pan away from latest so there is room to move forward
      viewState.pan(-10);

      const before = viewState.getVisibleBarRange().startIndex;

      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      // Move left by 120px: barWidth = max(60, 800/100) = 60
      // deltaX = -120, deltaBars = -(-120)/60 = 2, target = before + 2
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 280 }));

      const after = viewState.getVisibleBarRange().startIndex;
      expect(after).toBe(before + 2);
      expect(callbacks.onViewChanged).toHaveBeenCalled();
    });

    it('should pan left (backward in time) when dragging right', () => {
      // Pan away from latest so there is room to move backward
      viewState.pan(-10);

      const before = viewState.getVisibleBarRange().startIndex;

      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      // Move right by 120px: deltaX = 120, deltaBars = -120/60 = -2, target = before - 2
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 520 }));

      const after = viewState.getVisibleBarRange().startIndex;
      expect(after).toBe(before - 2);
    });

    it('should NOT pan from a bare canvas mousemove (no active drag)', () => {
      const before = viewState.getVisibleBarRange().startIndex;
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200 }));

      expect(viewState.getVisibleBarRange().startIndex).toBe(before);
      expect(callbacks.onViewChanged).not.toHaveBeenCalled();
    });

    it('should stop panning on window mouseup and restore the grab cursor', () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 350 }));

      expect(canvas.style.cursor).toBe('grab');

      const before = viewState.getVisibleBarRange().startIndex;

      // Further window moves must not pan (drag listener detached).
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      expect(viewState.getVisibleBarRange().startIndex).toBe(before);
    });

    it('should handle multiple drag sequences correctly', () => {
      viewState.pan(-10);

      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 350 }));

      const afterFirst = viewState.getVisibleBarRange().startIndex;
      expect(callbacks.onViewChanged).toHaveBeenCalled();

      vi.clearAllMocks();

      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 300 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));

      expect(viewState.getVisibleBarRange().startIndex).not.toBe(afterFirst);
      expect(callbacks.onViewChanged).toHaveBeenCalled();
    });
  });

  describe('destroy() - Event Listener Cleanup', () => {
    it('should remove the mousedown listener with matching reference', () => {
      const removeEventListenerSpy = vi.spyOn(canvas, 'removeEventListener');
      controller.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    });

    it('should not trigger callbacks after destroy', () => {
      controller.destroy();
      vi.clearAllMocks();

      viewState.pan(-10);
      const before = viewState.getVisibleBarRange().startIndex;

      // Must fail silently — no error, no pan, no callback.
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));

      expect(viewState.getVisibleBarRange().startIndex).toBe(before);
      expect(callbacks.onViewChanged).not.toHaveBeenCalled();
    });

    it('should detach the window drag listeners when destroyed mid-drag', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400 }));
      controller.destroy();

      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

      vi.clearAllMocks();
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      expect(callbacks.onViewChanged).not.toHaveBeenCalled();
    });
  });
});