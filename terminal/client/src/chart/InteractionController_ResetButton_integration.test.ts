/**
 * Integration tests for InteractionController + ResetToLatestButton + ChartViewState.
 *
 * These tests verify the interaction boundaries between the two merged features:
 * - InteractionController (event handling, callbacks)
 * - ResetToLatestButton (reset-to-latest control)
 * - ChartViewState (shared view-state)
 *
 * Priority areas:
 * 1. ViewState mutations trigger button visibility updates
 * 2. Reset button click triggers view-state reset
 * 3. Both components correctly share and mutate the same view-state
 * 4. Callback coordination between components
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InteractionController } from './InteractionController';
import { ResetToLatestButton } from './ResetToLatestButton';
import { ChartViewState } from './ChartViewState';
import { CoordinateTransform } from './CoordinateTransform';

describe('InteractionController + ResetToLatestButton Integration', () => {
  let canvas: HTMLCanvasElement;
  let container: HTMLElement;
  let transform: CoordinateTransform;
  let viewState: ChartViewState;
  let controller: InteractionController;
  let resetButton: ResetToLatestButton;
  let onViewChanged: ReturnType<typeof vi.fn>;
  let onReset: ReturnType<typeof vi.fn>;
  let onMouseMove: ReturnType<typeof vi.fn>;
  let onMouseLeave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create DOM elements
    container = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    container.appendChild(canvas);

    // Create transform
    transform = new CoordinateTransform(800, 600, {
      top: 20,
      right: 80,
      bottom: 40,
      left: 0,
    });

    // Create view-state with 100 total bars, 50 visible
    viewState = new ChartViewState(100, 50);

    // Set transform to last 50 bars (tail position)
    transform.setVisibleBarRange({ start: 50, end: 99 });
    transform.setPriceRange({ min: 1.0, max: 2.0 });

    // Create callbacks
    onViewChanged = vi.fn();
    onReset = vi.fn();
    onMouseMove = vi.fn();
    onMouseLeave = vi.fn();

    // Create controller
    controller = new InteractionController(canvas, transform, viewState, {
      onViewChanged,
      onMouseMove,
      onMouseLeave,
    });

    // Create reset button
    resetButton = new ResetToLatestButton(container, viewState, { onReset });
  });

  afterEach(() => {
    controller.destroy();
    resetButton.destroy();
  });

  it('button is hidden initially when at tail with followLatest=true', () => {
    const state = viewState.getState();
    expect(state.followLatest).toBe(true);
    expect(state.visibleStart).toBe(50); // 100 - 50 = 50

    // Button should be hidden
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.style.display).toBe('none');
  });

  it('view-state pan away from tail + button update makes button visible', () => {
    // Directly pan view-state (simulating what InteractionController would do)
    viewState.pan(-20);

    const state = viewState.getState();
    expect(state.visibleStart).toBe(30);
    expect(state.followLatest).toBe(false);

    // Update button visibility (simulating what the onViewChanged callback would trigger)
    resetButton.updateVisibility();

    // Button should now be visible
    const button = container.querySelector('button');
    expect(button?.style.display).toBe('block');
  });

  it('click reset button snaps to tail and hides button', () => {
    // First, pan away from tail
    viewState.pan(-20);
    expect(viewState.getState().followLatest).toBe(false);
    expect(viewState.getState().visibleStart).toBe(30);

    // Update button visibility to show it
    resetButton.updateVisibility();
    let button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');

    // Click reset button
    button.click();

    // Check callbacks fired
    expect(onReset).toHaveBeenCalledTimes(1);

    // View-state should be at tail
    const state = viewState.getState();
    expect(state.visibleStart).toBe(50); // 100 - 50 = 50
    expect(state.followLatest).toBe(true);

    // Update button visibility
    resetButton.updateVisibility();

    // Button should be hidden again
    expect(button.style.display).toBe('none');
  });

  it('pan right back to tail hides button and re-enables follow', () => {
    // Pan away from tail
    viewState.pan(-20);
    expect(viewState.getState().followLatest).toBe(false);

    resetButton.updateVisibility();
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');

    // Pan right back to tail
    viewState.pan(20);
    const state = viewState.getState();
    expect(state.visibleStart).toBe(50);
    expect(state.followLatest).toBe(true);

    // Update button visibility
    resetButton.updateVisibility();
    expect(button.style.display).toBe('none');
  });

  it('zoom at tail maintains follow mode and keeps button hidden', () => {
    // Verify initial state: at tail, following
    expect(viewState.getState().followLatest).toBe(true);
    expect(viewState.getState().visibleStart).toBe(50);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('none');

    // Zoom in at tail (anchor bar near end of visible range)
    viewState.zoom(0.9, 95); // zoom in, anchor at bar 95

    // View-state should have zoomed (visibleCount changed)
    const state = viewState.getState();
    expect(state.visibleCount).toBeLessThan(50); // zoomed in
    expect(state.followLatest).toBe(true); // should still be following

    // Update button visibility
    resetButton.updateVisibility();

    // Button should still be hidden
    expect(button.style.display).toBe('none');
  });

  it('reset button click triggers onReset callback', () => {
    onReset.mockClear();

    const button = container.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('view-state is shared between controller and button', () => {
    // Both components reference the same view-state instance
    // This test verifies they see the same mutations

    // Pan via view-state (as if controller did it)
    viewState.pan(-10);

    // Button should see the change
    const state = viewState.getState();
    expect(state.visibleStart).toBe(40);
    expect(state.followLatest).toBe(false);

    resetButton.updateVisibility();
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');

    // Reset via button
    button.click();

    // View-state should be updated (both components see it)
    const state2 = viewState.getState();
    expect(state2.followLatest).toBe(true);
    expect(state2.visibleStart).toBe(50);
  });

  it('multiple pan operations update button visibility correctly', () => {
    const button = container.querySelector('button') as HTMLButtonElement;

    // Initial: at tail, button hidden
    expect(button.style.display).toBe('none');

    // Pan left: away from tail
    viewState.pan(-10);
    resetButton.updateVisibility();
    expect(button.style.display).toBe('block');

    // Pan left more: still away from tail
    viewState.pan(-10);
    resetButton.updateVisibility();
    expect(button.style.display).toBe('block');

    // Pan right: partially back
    viewState.pan(5);
    resetButton.updateVisibility();
    expect(button.style.display).toBe('block'); // still not at tail

    // Pan right to tail
    viewState.pan(15);
    resetButton.updateVisibility();
    expect(button.style.display).toBe('none');
  });

  it('zoom operations do not inadvertently change followLatest when not at tail', () => {
    // Pan away from tail
    viewState.pan(-20);
    expect(viewState.getState().followLatest).toBe(false);

    // Zoom in (at current position, not at tail)
    viewState.zoom(0.9, 35); // anchor at bar index 35

    // followLatest should still be false
    expect(viewState.getState().followLatest).toBe(false);

    resetButton.updateVisibility();
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');
  });

  it('new bar arrival while following keeps button hidden', () => {
    // Initial: at tail, following
    expect(viewState.getState().followLatest).toBe(true);
    expect(viewState.getState().visibleStart).toBe(50);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('none');

    // New bar arrives
    viewState.onNewBar(101);

    // View should advance to keep tail visible
    expect(viewState.getState().visibleStart).toBe(51); // 101 - 50 = 51
    expect(viewState.getState().followLatest).toBe(true);

    // Button should still be hidden
    resetButton.updateVisibility();
    expect(button.style.display).toBe('none');
  });

  it('new bar arrival while panned away keeps button visible', () => {
    // Pan away
    viewState.pan(-20);
    resetButton.updateVisibility();

    expect(viewState.getState().followLatest).toBe(false);
    expect(viewState.getState().visibleStart).toBe(30);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');

    // New bar arrives
    viewState.onNewBar(101);

    // View should NOT advance (not following)
    expect(viewState.getState().visibleStart).toBe(30);
    expect(viewState.getState().followLatest).toBe(false);

    // Button should still be visible
    resetButton.updateVisibility();
    expect(button.style.display).toBe('block');
  });

  it('controller and button can be destroyed independently', () => {
    // Destroy controller first
    controller.destroy();

    // Button should still work
    viewState.pan(-10);
    resetButton.updateVisibility();
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');

    button.click();
    expect(onReset).toHaveBeenCalled();

    // Destroy button
    resetButton.destroy();

    // Button should be removed from DOM
    const buttonAfterDestroy = container.querySelector('button');
    expect(buttonAfterDestroy).toBeNull();
  });

  it('wheel events trigger onViewChanged callback', () => {
    onViewChanged.mockClear();

    // Dispatch wheel event
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
      })
    );

    // onViewChanged should be called
    expect(onViewChanged).toHaveBeenCalled();
  });

  it('mousemove without drag triggers onMouseMove callback', () => {
    onMouseMove.mockClear();

    // Dispatch mousemove event
    canvas.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
      })
    );

    // onMouseMove should be called
    expect(onMouseMove).toHaveBeenCalled();
  });

  it('mouseleave triggers onMouseLeave callback', () => {
    onMouseLeave.mockClear();

    // Dispatch mouseleave event
    canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    // onMouseLeave should be called
    expect(onMouseLeave).toHaveBeenCalled();
  });
});
