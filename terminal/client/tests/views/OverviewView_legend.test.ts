import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LegendEntry } from '../../src/ui/LegendPanel';

const mockRenderer = vi.hoisted(() => ({
  update: vi.fn(),
  updateCvd: vi.fn(),
  updateFootprint: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../../src/renderers/CanvasCandlestickRenderer', () => ({
  CanvasCandlestickRenderer: vi.fn(() => mockRenderer),
}));

import { OverviewView } from '../../src/views/OverviewView';

describe('OverviewView legend (slice 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLegendEntries() returns the 10 Overview entries with correct colors/kinds (AC-7)', () => {
    const view = new OverviewView();
    const entries: LegendEntry[] = view.getLegendEntries();
    expect(entries).toHaveLength(10);
    expect(entries[0]).toEqual({ label: 'Delta Up', color: '#26a69a', kind: 'fill' });
    expect(entries[1]).toEqual({ label: 'Delta Down', color: '#ef5350', kind: 'fill' });
    expect(entries[2]).toEqual({ label: 'CVD Line', color: '#3f51b5', kind: 'line' });
    expect(entries[3]).toEqual({ label: 'Volume Up', color: '#26a69a', kind: 'fill' });
    expect(entries[4]).toEqual({ label: 'Volume Down', color: '#ef5350', kind: 'fill' });
    expect(entries[5]).toEqual({ label: 'VP Buy', color: '#26a69a', kind: 'fill' });
    expect(entries[6]).toEqual({ label: 'VP Sell', color: '#ef5350', kind: 'fill' });
    expect(entries[7]).toEqual({ label: 'POC', color: '#ff9800', kind: 'dot' });
    expect(entries[8]).toEqual({ label: 'Value Area', color: '#c8cbd0', kind: 'fill' });
    expect(entries[9]).toEqual({ label: 'VAH / VAL', color: '#787b86', kind: 'line' });
  });

  it('mount() creates a default-hidden LegendPanel; destroy() removes it (AC-9)', () => {
    const container = document.createElement('div');
    const view = new OverviewView();
    view.mount(container);

    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('Legend: OFF');

    view.destroy();
    expect(container.querySelector('button')).toBeNull();
  });
});
