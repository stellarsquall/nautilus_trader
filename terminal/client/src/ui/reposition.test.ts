import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LinkToggleButton } from './LinkToggleButton';
import { ViewToggleButton } from './ViewToggleButton';
import { repositionControls } from './reposition';

describe('repositionControls (main.ts wiring)', () => {
  let container: HTMLDivElement;
  let linkToggle: LinkToggleButton;
  let toggle: ViewToggleButton;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    linkToggle = new LinkToggleButton(container, { onToggle: () => {} });
    toggle = new ViewToggleButton(container, { onViewSwitch: () => {} });
  });

  afterEach(() => {
    linkToggle.destroy();
    toggle.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('positions the link toggle at top:162px left:64px for the Overview view', () => {
    repositionControls(toggle, linkToggle, 'overview');

    const linkButton = container.querySelectorAll('button')[0] as HTMLButtonElement;
    expect(linkButton.style.top).toBe('162px');
    expect(linkButton.style.left).toBe('64px');
  });

  it('positions the link toggle at top:110px left:64px for the Footprint view', () => {
    repositionControls(toggle, linkToggle, 'footprint');

    const linkButton = container.querySelectorAll('button')[0] as HTMLButtonElement;
    expect(linkButton.style.top).toBe('110px');
    expect(linkButton.style.left).toBe('64px');
  });
});
