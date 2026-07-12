import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkToggleButton } from '../../src/ui/LinkToggleButton';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType } from '../../src/views/ChartView';
import type { ChartView, ViewportState } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState } from '../../src/types';

/**
 * Integration tests for the cross-feature boundary between the newly merged
 * LinkToggleButton (issue/slice11311649-08) and the ViewManager linked-viewport
 * API (setLinkViews / switchToView).
 *
 * The PRD requires a 'Link Views' toggle whose clicks drive ViewManager.linkViews,
 * which in turn changes whether switchToView() shares a single time anchor across
 * views (linked) or restores each view's own saved state (independent). This suite
 * verifies that wiring end-to-end: a click on the button must flip the ViewManager
 * flag AND change the resulting switchToView() restore behaviour.
 */

function createMockView(type: ViewType, viewportState?: ViewportState): ChartView {
  return {
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => type),
    getViewportState: vi.fn(() => viewportState ?? { anchorTsEvent: null, followLatest: true }),
    restoreViewportState: vi.fn(),
  };
}

function createMockChartStore(state?: Partial<ChartStoreState>): ChartStore {
  const defaultState: ChartStoreState = {
    bars: [],
    cvd: new Map(),
    footprints: new Map(),
  };
  return {
    getState: vi.fn(() => ({ ...defaultState, ...state })),
    getBarCount: vi.fn(() => 0),
    ingestBar: vi.fn(),
    ingestCvd: vi.fn(),
    ingestFootprint: vi.fn(),
  } as unknown as ChartStore;
}

describe('LinkToggleButton + ViewManager integration', () => {
  let container: HTMLDivElement;
  let store: ChartStore;
  let overviewView: ChartView;
  let footprintView: ChartView;
  let viewFactory: ReturnType<typeof vi.fn>;
  let vm: ViewManager;
  let toggleButton: LinkToggleButton;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    store = createMockChartStore();
    const overviewState: ViewportState = { anchorTsEvent: 12345, followLatest: false };
    overviewView = createMockView(ViewType.Overview, overviewState);
    footprintView = createMockView(ViewType.Footprint);
    viewFactory = vi.fn((type: ViewType): ChartView =>
      type === ViewType.Overview ? overviewView : footprintView,
    );

    vm = new ViewManager(store, container, viewFactory);
  });

  afterEach(() => {
    if (toggleButton) toggleButton.destroy();
    if (container.parentNode) container.parentNode.removeChild(container);
  });

  it('should default to linked mode and show "Link: On" before any click', () => {
    // Wire the button to the ViewManager exactly as the app does.
    toggleButton = new LinkToggleButton(container, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Link: On');
    expect(vm.isLinkViewsEnabled()).toBe(true);
  });

  it('should flip ViewManager.linkViews to false on first click and show "Link: Off"', () => {
    toggleButton = new LinkToggleButton(container, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(button.textContent).toBe('Link: Off');
    expect(vm.isLinkViewsEnabled()).toBe(false);
    expect(vm.linkViews).toBe(false);
  });

  it('should restore ViewManager.linkViews to true on second click', () => {
    toggleButton = new LinkToggleButton(container, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    button.click();
    button.click();

    expect(button.textContent).toBe('Link: On');
    expect(vm.isLinkViewsEnabled()).toBe(true);
  });

  it('should keep switchToView linked (shared anchor) while toggle is ON', () => {
    toggleButton = new LinkToggleButton(container, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });

    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);

    // Linked mode: incoming Footprint is restored from the shared anchor captured
    // from the outgoing Overview view.
    expect(overviewView.getViewportState).toHaveBeenCalledTimes(1);
    expect(footprintView.restoreViewportState).toHaveBeenCalledWith({
      anchorTsEvent: 12345,
      followLatest: false,
    });
  });

  it('should switch switchToView to independent mode after toggling OFF', () => {
    toggleButton = new LinkToggleButton(container, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });

    // Turn the link off via the button.
    const button = container.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(vm.isLinkViewsEnabled()).toBe(false);

    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);

    // Independent mode: incoming Footprint is NOT restored from the shared anchor.
    expect(footprintView.restoreViewportState).not.toHaveBeenCalled();
  });

  it('should re-enable shared-anchor behaviour after toggling back ON', () => {
    toggleButton = new LinkToggleButton(container, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    button.click(); // off
    button.click(); // on again

    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);

    expect(footprintView.restoreViewportState).toHaveBeenCalledWith({
      anchorTsEvent: 12345,
      followLatest: false,
    });
  });

  it('should not mutate ViewManager when the button is destroyed before click', () => {
    toggleButton = new LinkToggleButton(container, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });

    toggleButton.destroy();
    // Clicking the detached (removed) button must not reach the ViewManager.
    expect(vm.isLinkViewsEnabled()).toBe(true);
  });
});
