import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkToggleButton } from '../../src/ui/LinkToggleButton';
import { ViewToggleButton } from '../../src/ui/ViewToggleButton';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType, type ChartView, type ViewportState } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState } from '../../src/types';

/**
 * Priority-2 cross-feature integration test (Slice 11 merge boundary).
 *
 * The integration branch merged three feature branches that all touch the
 * ViewManager viewport machinery:
 *   - linked-viewport-persistence (ViewManager linked/independent anchor logic)
 *   - linked-by-time-viewport (ViewportState, LinkToggleButton)
 *   - link-toggle-button (LinkToggleButton following the ViewToggleButton pattern)
 *
 * The two toggle buttons are the user-facing entry points, yet the shipped
 * application (src/main.ts) only wires ViewToggleButton and never mounts
 * LinkToggleButton. This suite wires BOTH buttons to the SAME ViewManager,
 * exactly as the product intends, and verifies their coordination boundary:
 *   - ViewToggleButton drives view switching through the (link-aware) ViewManager
 *   - LinkToggleButton drives ViewManager.setLinkViews, which flips whether
 *     switchToView() shares a single time anchor or restores per-view state
 *   - both buttons can coexist in the same container without position collision
 *
 * Views are fully-capable mocks (implementing getViewportState /
 * restoreViewportState with real internal state) so the test exercises the
 * coordination contract deterministically, independent of the renderer-layer
 * mock gaps observed in the pre-existing suite.
 */

class StatefulMockView implements ChartView {
  public readonly type: ViewType;
  public mounted = false;
  public destroyed = false;
  public restoredStates: ViewportState[] = [];
  public lastRestored: ViewportState | null = null;
  private state: ViewportState;

  constructor(type: ViewType, initial?: ViewportState) {
    this.type = type;
    this.state = initial ?? { anchorTsEvent: null, followLatest: true };
  }

  mount(_container: HTMLElement): void {
    this.mounted = true;
  }
  seed(_state: ChartStoreState): void {}
  updateBar(_data: unknown): void {}
  updateCvd(_data: unknown): void {}
  updateFootprint(_data: unknown): void {}
  destroy(): void {
    this.destroyed = true;
  }
  getType(): ViewType {
    return this.type;
  }
  getViewportState(): ViewportState {
    return { ...this.state };
  }
  restoreViewportState(state: ViewportState): void {
    this.lastRestored = { ...state };
    this.restoredStates.push({ ...state });
    this.state = { ...state };
  }
}

function createMockChartStore(): ChartStore {
  const state: ChartStoreState = { bars: [], cvd: new Map(), footprints: new Map() };
  return {
    getState: vi.fn(() => state),
    getBarCount: vi.fn(() => 0),
    ingestBar: vi.fn(),
    ingestCvd: vi.fn(),
    ingestFootprint: vi.fn(),
  } as unknown as ChartStore;
}

describe('ViewToggleButton + LinkToggleButton + ViewManager coordination (Slice 11 merge boundary)', () => {
  let container: HTMLDivElement;
  let buttonContainer: HTMLDivElement;
  let store: ChartStore;
  let overviewView: StatefulMockView;
  let footprintView: StatefulMockView;
  let viewFactory: ReturnType<typeof vi.fn>;
  let vm: ViewManager;
  let linkButton: LinkToggleButton;
  let viewButton: ViewToggleButton;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    buttonContainer = document.createElement('div');
    document.body.appendChild(buttonContainer);

    store = createMockChartStore();

    // Seed Overview with a historical, non-following anchor so the linked
    // handoff is observable (anchor != null, followLatest == false).
    overviewView = new StatefulMockView(ViewType.Overview, {
      anchorTsEvent: 424242,
      followLatest: false,
    });
    footprintView = new StatefulMockView(ViewType.Footprint, {
      anchorTsEvent: null,
      followLatest: true,
    });

    viewFactory = vi.fn((type: ViewType): ChartView =>
      type === ViewType.Overview ? overviewView : footprintView,
    );

    vm = new ViewManager(store, container, viewFactory);
    // Mirror the app's startup: land on the Overview view.
    vm.switchToView(ViewType.Overview);

    // Realistic combined wiring (the wiring main.ts is currently missing):
    // ViewToggleButton switches views; LinkToggleButton toggles link mode.
    viewButton = new ViewToggleButton(buttonContainer, {
      onViewSwitch: (vt) => {
        vm.switchToView(vt === 'overview' ? ViewType.Overview : ViewType.Footprint);
      },
    });
    linkButton = new LinkToggleButton(buttonContainer, {
      onToggle: (linked) => vm.setLinkViews(linked),
    });
  });

  afterEach(() => {
    viewButton?.destroy();
    linkButton?.destroy();
    if (container.parentNode) container.parentNode.removeChild(container);
    if (buttonContainer.parentNode) buttonContainer.parentNode.removeChild(buttonContainer);
  });

  it('both buttons boot in their documented default states and ViewManager is linked by default', () => {
    const linkEl = buttonContainer.querySelector('button:last-of-type') as HTMLButtonElement;
    const viewEl = buttonContainer.querySelector('button:first-of-type') as HTMLButtonElement;

    expect(viewEl.textContent).toBe('Overview');
    expect(linkEl.textContent).toBe('Link: On');
    expect(vm.linkViews).toBe(true);
    expect(vm.isLinkViewsEnabled()).toBe(true);
  });

  it('ViewToggleButton click drives a real view switch through the ViewManager', () => {
    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);

    const viewEl = buttonContainer.querySelector('button:first-of-type') as HTMLButtonElement;
    viewEl.click(); // Overview -> Footprint

    expect(vm.getCurrentViewType()).toBe(ViewType.Footprint);
    expect(footprintView.mounted).toBe(true);
    expect(overviewView.destroyed).toBe(true);
  });

  it('LinkToggleButton click flips ViewManager.linkViews OFF and its own label', () => {
    const linkEl = buttonContainer.querySelector('button:last-of-type') as HTMLButtonElement;
    linkEl.click();

    expect(linkEl.textContent).toBe('Link: Off');
    expect(vm.isLinkViewsEnabled()).toBe(false);
    expect(vm.linkViews).toBe(false);
  });

  it('in LINKED mode (default) a view switch shares the outgoing anchor into the incoming view', () => {
    // Start on Overview (already seeded with a historical anchor).
    vm.switchToView(ViewType.Overview);
    expect(overviewView.getViewportState().anchorTsEvent).toBe(424242);

    // Switch to Footprint via the ViewToggleButton path.
    const viewEl = buttonContainer.querySelector('button:first-of-type') as HTMLButtonElement;
    viewEl.click();

    // Linked handoff: Footprint must be restored from the shared anchor.
    expect(footprintView.lastRestored).not.toBeNull();
    expect(footprintView.lastRestored!.anchorTsEvent).toBe(424242);
    expect(footprintView.lastRestored!.followLatest).toBe(false);
  });

  it('in INDEPENDENT mode (toggled OFF) a view switch does NOT use the shared anchor', () => {
    // Turn the link off via the LinkToggleButton.
    const linkEl = buttonContainer.querySelector('button:last-of-type') as HTMLButtonElement;
    linkEl.click();
    expect(vm.isLinkViewsEnabled()).toBe(false);

    vm.switchToView(ViewType.Overview);
    expect(overviewView.getViewportState().anchorTsEvent).toBe(424242);

    // Switch to Footprint. Independent mode must restore from the per-view map,
    // which has no Footprint entry yet -> restoreViewportState is NOT called with
    // the Overview shared anchor.
    const viewEl = buttonContainer.querySelector('button:first-of-type') as HTMLButtonElement;
    viewEl.click();

    expect(footprintView.lastRestored).toBeNull();
  });

  it('both toggle buttons occupy distinct positions when mounted in the same container', () => {
    const linkEl = buttonContainer.querySelector('button:last-of-type') as HTMLButtonElement;
    const viewEl = buttonContainer.querySelector('button:first-of-type') as HTMLButtonElement;

    const linkTop = linkEl.style.top;
    const linkLeft = linkEl.style.left;
    const viewTop = viewEl.style.top;
    const viewLeft = viewEl.style.left;

    expect([linkTop, linkLeft]).not.toEqual([viewTop, viewLeft]);

    // The documented defaults must hold (both now in the shared left:64 nav column).
    expect(linkTop).toBe('162px');
    expect(linkLeft).toBe('64px');
    expect(viewTop).toBe('58px');
    expect(viewLeft).toBe('64px');
  });

  it('does not leak listeners after both buttons are destroyed', () => {
    linkButton.destroy();
    viewButton.destroy();
    // ViewManager link state remains whatever it was; destruction of the buttons
    // must not crash and must not leave the view switch non-functional.
    expect(() => vm.switchToView(ViewType.Footprint)).not.toThrow();
    expect(vm.getCurrentViewType()).toBe(ViewType.Footprint);
  });
});
