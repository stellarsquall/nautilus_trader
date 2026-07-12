import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LinkToggleButton, type LinkToggleButtonConfig } from './LinkToggleButton';

describe('LinkToggleButton', () => {
  let container: HTMLDivElement;
  let config: LinkToggleButtonConfig;
  let toggleButton: LinkToggleButton;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    config = {
      onToggle: vi.fn(),
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

  describe('LinkToggleButton label', () => {
    it('should display Link: On by default', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.textContent).toBe('Link: On');
    });

    it('should toggle label to Link: Off on click', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(button.textContent).toBe('Link: Off');
    });

    it('should toggle label back to Link: On on second click', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();
      expect(button.textContent).toBe('Link: Off');

      button.click();
      expect(button.textContent).toBe('Link: On');
    });

    it('should have correct button styles', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.style.position).toBe('absolute');
      expect(button.style.top).toBe('162px');
      expect(button.style.left).toBe('64px');
      expect(button.style.zIndex).toBe('10');
      expect(button.style.padding).toBe('4px 8px');
      expect(button.style.fontSize).toBe('12px');
      expect(button.style.fontFamily).toBe('sans-serif');
      expect(button.style.cursor).toBe('pointer');
      expect(button.style.border).toMatch(/1px solid/);
      expect(button.style.borderRadius).toBe('4px');
      expect(button.style.background).toMatch(/rgb\(255,\s*255,\s*255\)|#ffffff/);
      expect(button.style.color).toMatch(/rgb\(51,\s*51,\s*51\)|#333333/);
    });

    it('should append button to container on construction', () => {
      toggleButton = new LinkToggleButton(container, config);

      expect(container.children.length).toBe(1);
      expect(container.firstChild?.nodeName).toBe('BUTTON');
    });
  });

  describe('LinkToggleButton setLinkViews', () => {
    it('should call onToggle with false when clicking from linked state', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(config.onToggle).toHaveBeenCalledTimes(1);
      expect(config.onToggle).toHaveBeenCalledWith(false);
    });

    it('should call onToggle with true when clicking from unlinked state', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();
      button.click();

      expect(config.onToggle).toHaveBeenCalledTimes(2);
      expect(config.onToggle).toHaveBeenLastCalledWith(true);
    });

    it('should not call onToggle after destroy', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      toggleButton.destroy();
      button.click();

      expect(config.onToggle).not.toHaveBeenCalled();
    });
  });

  describe('LinkToggleButton position', () => {
    it('should default to top:162px left:64px', () => {
      toggleButton = new LinkToggleButton(container, config);

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.style.top).toBe('162px');
      expect(button.style.left).toBe('64px');
    });

    it('setPosition() updates the button top and left', () => {
      toggleButton = new LinkToggleButton(container, config);

      toggleButton.setPosition('110px', '64px');

      const button = container.querySelector('button') as HTMLButtonElement;
      expect(button.style.top).toBe('110px');
      expect(button.style.left).toBe('64px');
    });
  });

  it('should remove button from DOM and remove listener on destroy', () => {
    toggleButton = new LinkToggleButton(container, config);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    toggleButton.destroy();

    expect(button.parentNode).toBeNull();
    expect(container.children.length).toBe(0);
  });
});
