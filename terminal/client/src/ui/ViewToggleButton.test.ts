import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ViewToggleButton, type ViewToggleButtonCallbacks, type ViewType } from './ViewToggleButton';

describe('ViewToggleButton', () => {
  let container: HTMLDivElement;
  let callbacks: ViewToggleButtonCallbacks;
  let toggleButton: ViewToggleButton;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    callbacks = {
      onViewSwitch: vi.fn(),
    };
  });

  afterEach(() => {
    if (toggleButton) {
      toggleButton.destroy();
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should create button element with correct styles (AC1, AC2, AC6)', () => {
    toggleButton = new ViewToggleButton(container, callbacks);

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.style.position).toBe('absolute');
    expect(button?.style.top).toBe('58px');
    expect(button?.style.left).toBe('64px');
    expect(button?.style.zIndex).toBe('10');
    expect(button?.style.padding).toBe('4px 8px');
    expect(button?.style.fontSize).toBe('12px');
    expect(button?.style.fontFamily).toBe('sans-serif');
    expect(button?.style.background).toMatch(/rgb\(255,\s*255,\s*255\)|#ffffff/);
    expect(button?.style.border).toMatch(/1px solid/);
    expect(button?.style.cursor).toBe('pointer');
    expect(button?.style.borderRadius).toBe('4px');
    expect(button?.style.color).toMatch(/rgb\(51,\s*51,\s*51\)|#333333/);
  });

  it('should display Overview label for initial view mode (AC3)', () => {
    toggleButton = new ViewToggleButton(container, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Overview');
  });

  it('should display Footprint label when initial view is footprint (AC3)', () => {
    toggleButton = new ViewToggleButton(container, callbacks, 'footprint');

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Footprint');
  });

  it('should append button to container on construction', () => {
    toggleButton = new ViewToggleButton(container, callbacks);

    expect(container.children.length).toBe(1);
    expect(container.firstChild?.nodeName).toBe('BUTTON');
  });

  it('should invoke onViewSwitch callback with footprint when overview button clicked (AC4)', () => {
    toggleButton = new ViewToggleButton(container, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(callbacks.onViewSwitch).toHaveBeenCalledTimes(1);
    expect(callbacks.onViewSwitch).toHaveBeenCalledWith('footprint');
  });

  it('should invoke onViewSwitch callback with overview when footprint button clicked (AC4)', () => {
    toggleButton = new ViewToggleButton(container, callbacks, 'footprint');

    const button = container.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(callbacks.onViewSwitch).toHaveBeenCalledTimes(1);
    expect(callbacks.onViewSwitch).toHaveBeenCalledWith('overview');
  });

  it('should update button appearance when setViewType is called (AC5)', () => {
    toggleButton = new ViewToggleButton(container, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Overview');

    toggleButton.setViewType('footprint');
    expect(button.textContent).toBe('Footprint');

    toggleButton.setViewType('overview');
    expect(button.textContent).toBe('Overview');
  });

  it('should remove button from DOM and remove listener on destroy', () => {
    const removeEventListenerSpy = vi.spyOn(HTMLButtonElement.prototype, 'removeEventListener');

    toggleButton = new ViewToggleButton(container, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    toggleButton.destroy();

    expect(button.parentNode).toBeNull();
    expect(container.children.length).toBe(0);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));

    removeEventListenerSpy.mockRestore();
  });

  it('should not call onViewSwitch after destroy', () => {
    toggleButton = new ViewToggleButton(container, callbacks);

    const button = container.querySelector('button') as HTMLButtonElement;

    toggleButton.destroy();
    button.click();

    expect(callbacks.onViewSwitch).not.toHaveBeenCalled();
  });

  it('setPosition() updates the toggle top/left (view-aware placement)', () => {
    toggleButton = new ViewToggleButton(container, callbacks);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.top).toBe('58px');
    expect(button.style.left).toBe('64px');

    toggleButton.setPosition('58px', '64px');
    expect(button.style.top).toBe('58px');
    expect(button.style.left).toBe('64px');
  });
});