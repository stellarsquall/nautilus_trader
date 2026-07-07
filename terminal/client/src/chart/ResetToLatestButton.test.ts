import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResetToLatestButton, type ResetToLatestButtonCallbacks } from './ResetToLatestButton';
import { ChartViewState } from './ChartViewState';

describe('ResetToLatestButton', () => {
  let container: HTMLDivElement;
  let viewState: ChartViewState;
  let callbacks: ResetToLatestButtonCallbacks;
  let resetButton: ResetToLatestButton;

  beforeEach(() => {
    // Create container
    container = document.createElement('div');
    document.body.appendChild(container);

    // Create view state
    viewState = new ChartViewState(200, 100);

    // Create callbacks
    callbacks = {
      onReset: vi.fn(),
    };
  });

  afterEach(() => {
    // Clean up
    if (resetButton) {
      resetButton.destroy();
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should create button element with correct text and styles', () => {
    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Latest');
    expect(button?.style.position).toBe('absolute');
    expect(button?.style.top).toBe('10px');
    expect(button?.style.right).toBe('10px');
    expect(button?.style.padding).toBe('6px 12px');
    expect(button?.style.fontSize).toBe('12px');
    // Browser converts hex to rgb format
    expect(button?.style.background).toMatch(/rgb\(255,\s*255,\s*255\)|#ffffff/);
    expect(button?.style.border).toMatch(/1px solid/);
    expect(button?.style.cursor).toBe('pointer');
    expect(button?.style.borderRadius).toBe('3px');
  });

  it('should append button to container on construction', () => {
    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    expect(container.children.length).toBe(1);
    expect(container.firstChild?.nodeName).toBe('BUTTON');
  });

  it('should show button when followLatest is false (updateVisibility)', () => {
    // Pan away from tail to set followLatest=false
    viewState.pan(-10);
    expect(viewState.getState().followLatest).toBe(false);

    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');
  });

  it('should hide button when followLatest is true (updateVisibility)', () => {
    // View state starts with followLatest=true
    expect(viewState.getState().followLatest).toBe(true);

    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('none');
  });

  it('should update visibility when called explicitly', () => {
    // Start with followLatest=false
    viewState.pan(-10);
    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.display).toBe('block');

    // Reset to latest (sets followLatest=true)
    viewState.resetToLatest();
    resetButton.updateVisibility();

    expect(button.style.display).toBe('none');

    // Pan away again (sets followLatest=false)
    viewState.pan(-10);
    resetButton.updateVisibility();

    expect(button.style.display).toBe('block');
  });

  it('should call resetToLatest and onReset callback when clicked', () => {
    // Spy on viewState.resetToLatest
    const resetToLatestSpy = vi.spyOn(viewState, 'resetToLatest');

    // Pan away from tail to make button visible
    viewState.pan(-10);
    expect(viewState.getState().followLatest).toBe(false);

    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;

    // Click the button
    button.click();

    // Verify resetToLatest was called
    expect(resetToLatestSpy).toHaveBeenCalledTimes(1);

    // Verify onReset callback was called
    expect(callbacks.onReset).toHaveBeenCalledTimes(1);

    // Verify state is now at tail with followLatest=true
    const state = viewState.getState();
    expect(state.followLatest).toBe(true);
    expect(state.visibleStart).toBe(100); // 200 - 100
  });

  it('should remove button from DOM and remove listener on destroy', () => {
    // Spy on removeEventListener
    const removeEventListenerSpy = vi.spyOn(HTMLButtonElement.prototype, 'removeEventListener');

    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    // Destroy button
    resetButton.destroy();

    // Verify button removed from DOM
    expect(button.parentNode).toBeNull();
    expect(container.children.length).toBe(0);

    // Verify removeEventListener was called for click event
    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));

    // Cleanup spy
    removeEventListenerSpy.mockRestore();
  });

  it('should not call onReset after destroy', () => {
    viewState.pan(-10);
    resetButton = new ResetToLatestButton(container, viewState, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;

    // Destroy the button
    resetButton.destroy();

    // Try to click the button (it's still in memory, just detached from DOM)
    button.click();

    // Callback should not have been called because listener was removed
    expect(callbacks.onReset).not.toHaveBeenCalled();
  });
});
