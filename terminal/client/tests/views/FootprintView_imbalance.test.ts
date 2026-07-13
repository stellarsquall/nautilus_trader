import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootprintView } from '../../src/views/FootprintView';
import { LegendPanel } from '../../src/ui/LegendPanel';
import { ViewType } from '../../src/views/ChartView';
import { OverviewView } from '../../src/views/OverviewView';
import type { ChartStoreState, FootprintPayload, FootprintLevel, BarPayload } from '../../src/types';

vi.mock('../../src/views/footprintImbalance.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/views/footprintImbalance.js')>();
  return { ...mod, calculateDiagonalImbalances: vi.fn(mod.calculateDiagonalImbalances) };
});

import { calculateDiagonalImbalances } from '../../src/views/footprintImbalance.js';

const fillRectRecords: Array<{ x: number; y: number; w: number; h: number; fillStyle: string }> = [];
const strokeRectRecords: Array<{ x: number; y: number; w: number; h: number; strokeStyle: string }> = [];
const fillTextRecords: Array<{ text: string; x: number; y: number }> = [];

function createMockCtx(): CanvasRenderingContext2D {
  const ctx = {
    canvas: {} as HTMLCanvasElement,
    clearRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      fillRectRecords.push({ x, y, w, h, fillStyle: ctx.fillStyle as string });
    }),
    fillText: vi.fn((text: string, x: number, y: number) => {
      fillTextRecords.push({ text, x, y });
    }),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => {
      strokeRectRecords.push({ x, y, w, h, strokeStyle: ctx.strokeStyle as string });
    }),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

const mockCtx = createMockCtx();

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockCtx);

vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
})));

function seedMinimal(view: FootprintView, barTsEvent: number, levels: FootprintLevel[]): void {
  view.mount(document.createElement('div'));
  const fp: FootprintPayload = { ts_event: barTsEvent, bin_size: 1, levels };
  view.updateFootprint(fp);
  const bar: BarPayload = { ts_event: barTsEvent, open: 100, high: 101, low: 99, close: 100, volume: 1000 };
  view.updateBar(bar);
}

describe('FootprintView imbalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fillRectRecords.length = 0;
    strokeRectRecords.length = 0;
    fillTextRecords.length = 0;
  });

  it('IMBALANCE_MARKER_WIDTH === 4', () => {
    expect(FootprintView.IMBALANCE_MARKER_WIDTH).toBe(4);
  });

  it('STACKED_BRACKET_WIDTH === 6', () => {
    expect(FootprintView.STACKED_BRACKET_WIDTH).toBe(6);
  });

  it('should have setImbalanceMarkersVisible and default-ON state', () => {
    const view = new FootprintView();
    expect(view.imbalanceMarkersVisible).toBe(true);
    view.setImbalanceMarkersVisible(false);
    expect(view.imbalanceMarkersVisible).toBe(false);
    view.setImbalanceMarkersVisible(true);
    expect(view.imbalanceMarkersVisible).toBe(true);
  });

  it('setImbalanceMarkersVisible pre-mount is a safe no-op', () => {
    const view = new FootprintView();
    expect(() => view.setImbalanceMarkersVisible(false)).not.toThrow();
    expect(() => view.setImbalanceMarkersVisible(true)).not.toThrow();
  });

  describe('imbalance marker rendering', () => {
    it('should draw a buy imbalance marker at right edge with COLOR_BUY', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 0 },
        { price: 101, buy: 1, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      const markerCalls = fillRectRecords.filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      expect(markerCalls.length).toBeGreaterThanOrEqual(1);
      const buyMarker = markerCalls.find((r) => r.fillStyle === FootprintView.COLOR_BUY);
      expect(buyMarker).toBeDefined();
      expect(buyMarker!.h).toBe(FootprintView.CELL_HEIGHT);
    });

    it('should draw a sell imbalance marker at left edge with COLOR_SELL', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 0, sell: 100 },
        { price: 101, buy: 0, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      const markerCalls = fillRectRecords.filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      expect(markerCalls.length).toBeGreaterThanOrEqual(1);
      const sellMarker = markerCalls.find((r) => r.fillStyle === FootprintView.COLOR_SELL);
      expect(sellMarker).toBeDefined();
      expect(sellMarker!.h).toBe(FootprintView.CELL_HEIGHT);
    });

    it('should draw a stacked bracket spanning 3 * CELL_HEIGHT for 3-level consecutive buy run', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 0 },
        { price: 101, buy: 100, sell: 0 },
        { price: 102, buy: 100, sell: 0 },
      ];
      seedMinimal(view, 100, levels);

      const bracketCalls = fillRectRecords.filter(
        (r) => r.w === FootprintView.STACKED_BRACKET_WIDTH
      );
      expect(bracketCalls.length).toBeGreaterThanOrEqual(1);
      const buyBracket = bracketCalls.find((r) => r.fillStyle === FootprintView.COLOR_BUY);
      expect(buyBracket).toBeDefined();
      expect(buyBracket!.h).toBe(3 * FootprintView.CELL_HEIGHT);
    });
  });

  describe('coexistence with POC and volume text', () => {
    it('should draw delta bg, POC outline, imbalance marker, and volume text in one pass', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 90 },
        { price: 101, buy: 0, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      const markerCalls = fillRectRecords.filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      const pocStrokes = strokeRectRecords.filter(
        (r) => r.strokeStyle === FootprintView.COLOR_POC
      );
      const volText = fillTextRecords.filter((r) => r.text.includes('|'));

      expect(markerCalls.length).toBeGreaterThanOrEqual(1);
      expect(pocStrokes.length).toBeGreaterThanOrEqual(1);
      expect(volText.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('graceful degradation', () => {
    it('should not throw and produce zero marker calls for a bar with no footprint', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      view.mount(container);

      const bar: BarPayload = { ts_event: 100, open: 100, high: 101, low: 99, close: 100, volume: 1000 };
      view.updateBar(bar);

      const prevCount = fillRectRecords.length;

      view.updateBar({ ts_event: 200, open: 101, high: 102, low: 100, close: 101, volume: 1000 });

      const newMarkers = fillRectRecords.slice(prevCount).filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      expect(newMarkers.length).toBe(0);
    });
  });

  describe('per-bar invocation of calculateDiagonalImbalances', () => {
    it('should invoke calculateDiagonalImbalances at most once per visible bar per draw pass', () => {
      vi.clearAllMocks();
      (calculateDiagonalImbalances as ReturnType<typeof vi.fn>).mockClear();

      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 0 },
        { price: 101, buy: 1, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      const callCount = (calculateDiagonalImbalances as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(1);
    });

    it('should skip imbalance detection entirely when markers are hidden', () => {
      vi.clearAllMocks();
      (calculateDiagonalImbalances as ReturnType<typeof vi.fn>).mockClear();

      const view = new FootprintView();
      view.setImbalanceMarkersVisible(false);
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 0 },
        { price: 101, buy: 1, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      const callCount = (calculateDiagonalImbalances as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callCount).toBe(0);
    });
  });

  describe('toggle lifecycle', () => {
    it('should append an imbalance toggle button labeled ON inside the container on mount', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      view.mount(container);

      const buttons = container.querySelectorAll('button');
      const toggleBtn = Array.from(buttons).find((b) => b.textContent?.includes('Imbalance'));
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn!.textContent).toContain('ON');
    });

    it('should remove the toggle button on destroy', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      view.mount(container);
      view.destroy();

      const buttons = container.querySelectorAll('button');
      const toggleBtn = Array.from(buttons).find((b) => b.textContent?.includes('Imbalance'));
      expect(toggleBtn).toBeUndefined();
    });

    it('should yield exactly one button after mount->destroy->mount cycle', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      view.mount(container);
      view.destroy();
      view.mount(container);

      const buttons = container.querySelectorAll('button');
      const toggleBtn = Array.from(buttons).find((b) => b.textContent?.includes('Imbalance'));
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn!.textContent).toContain('ON');
      // Three buttons: imbalance toggle, Latest, and legend toggle.
      expect(buttons.length).toBe(3);
    });

    it('should NOT create an imbalance toggle button for OverviewView', () => {
      const view = new OverviewView();
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      container.getBoundingClientRect = vi.fn(() => ({
        width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600,
        x: 0, y: 0, toJSON: () => ({}),
      }));
      view.mount(container);

      const buttons = container.querySelectorAll('button');
      const toggleBtn = Array.from(buttons).find((b) => b.textContent?.includes('Imbalance'));
      expect(toggleBtn).toBeUndefined();
      view.destroy();
    });
  });

  describe('toggle behavior', () => {
    it('should draw imbalance markers by default (ON)', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 0 },
        { price: 101, buy: 1, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      const markers = fillRectRecords.filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      expect(markers.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip markers after setImbalanceMarkersVisible(false) while keeping other draw calls', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 90 },
        { price: 101, buy: 1, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      const markersAfterHide = fillRectRecords.filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      expect(markersAfterHide.length).toBeGreaterThanOrEqual(1);

      fillRectRecords.length = 0;
      strokeRectRecords.length = 0;
      fillTextRecords.length = 0;

      view.setImbalanceMarkersVisible(false);

      const newMarkers = fillRectRecords.filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      expect(newMarkers.length).toBe(0);

      const pocStrokes = strokeRectRecords.filter(
        (r) => r.strokeStyle === FootprintView.COLOR_POC
      );
      const volTexts = fillTextRecords.filter((r) => r.text.includes('|'));

      expect(pocStrokes.length).toBeGreaterThanOrEqual(1);
      expect(volTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('should restore markers after setImbalanceMarkersVisible(true)', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100, buy: 100, sell: 0 },
        { price: 101, buy: 1, sell: 1 },
      ];
      seedMinimal(view, 100, levels);

      view.setImbalanceMarkersVisible(false);

      fillRectRecords.length = 0;

      view.setImbalanceMarkersVisible(true);

      const markers = fillRectRecords.filter(
        (r) => r.w === FootprintView.IMBALANCE_MARKER_WIDTH
      );
      expect(markers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getLegendEntries', () => {
    it('returns 6 LegendEntry objects with correct labels, colors, and kinds', () => {
      const view = new FootprintView();
      const entries = view.getLegendEntries();

      expect(entries).toHaveLength(6);

      const expected = [
        { label: 'Buy Dominant', color: FootprintView.COLOR_BUY, kind: 'fill' },
        { label: 'Sell Dominant', color: FootprintView.COLOR_SELL, kind: 'fill' },
        { label: 'POC', color: FootprintView.COLOR_POC, kind: 'outline' },
        { label: 'Buy Imbalance', color: FootprintView.COLOR_BUY, kind: 'rightStrip' },
        { label: 'Sell Imbalance', color: FootprintView.COLOR_SELL, kind: 'leftStrip' },
        { label: 'Stacked Run', color: FootprintView.COLOR_BUY, kind: 'bracket' },
      ];

      for (let i = 0; i < expected.length; i++) {
        expect(entries[i].label).toBe(expected[i].label);
        expect(entries[i].color).toBe(expected[i].color);
        expect(entries[i].kind).toBe(expected[i].kind);
      }
    });
  });

  describe('FootprintView LegendPanel', () => {
    it('mounts LegendPanel in mount()', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      view.mount(container);

      const buttons = container.querySelectorAll('button');
      const legendBtn = Array.from(buttons).find((b) => b.textContent?.includes('Legend'));
      expect(legendBtn).toBeDefined();
      expect(legendBtn!.textContent).toContain('OFF');
    });

    it('destroys LegendPanel in destroy()', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      view.mount(container);
      view.destroy();

      const buttons = container.querySelectorAll('button');
      const legendBtn = Array.from(buttons).find((b) => b.textContent?.includes('Legend'));
      expect(legendBtn).toBeUndefined();
    });
  });
});