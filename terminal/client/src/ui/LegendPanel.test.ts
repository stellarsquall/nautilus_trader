import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LegendPanel, type LegendEntry, type LegendPanelConfig, type LegendKind } from './LegendPanel';

describe('LegendPanel', () => {
  let container: HTMLDivElement;

  const sampleEntries: LegendEntry[] = [
    { label: 'Delta Up', color: '#26a69a', kind: 'fill' },
    { label: 'Delta Down', color: '#ef5350', kind: 'fill' },
    { label: 'CVD Line', color: '#2196f3', kind: 'line' },
    { label: 'Volume', color: '#9e9e9e', kind: 'fill' },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('default hidden when defaultVisible is false (AC-2)', () => {
    const config: LegendPanelConfig = { entries: sampleEntries, defaultVisible: false };
    const panel = new LegendPanel(container, config);
    const panelDiv = container.querySelector('div') as HTMLDivElement;
    const viewContainer = container.lastChild as HTMLElement;
    expect(viewContainer.style.display).toBe('none');
    panel.destroy();
  });

  it('default hidden when defaultVisible is omitted (AC-2)', () => {
    const config: LegendPanelConfig = { entries: sampleEntries };
    const panel = new LegendPanel(container, config);
    const viewContainer = container.lastChild as HTMLElement;
    expect(viewContainer.style.display).toBe('none');
    panel.destroy();
  });

  it('should toggle visibility and update button label on click (AC-3)', () => {
    const config: LegendPanelConfig = { entries: sampleEntries, defaultVisible: false };
    const panel = new LegendPanel(container, config);
    const button = container.querySelector('button') as HTMLButtonElement;
    const panelDiv = container.lastChild as HTMLElement;

    expect(button.textContent).toBe('Legend: OFF');
    expect(panelDiv.style.display).toBe('none');

    button.click();
    expect(button.textContent).toBe('Legend: ON');
    expect(panelDiv.style.display).toBe('block');

    button.click();
    expect(button.textContent).toBe('Legend: OFF');
    expect(panelDiv.style.display).toBe('none');

    panel.destroy();
  });

  it('should render one row per entry (AC-4)', () => {
    const entries: LegendEntry[] = [
      { label: 'A', color: '#111', kind: 'fill' },
      { label: 'B', color: '#222', kind: 'line' },
      { label: 'C', color: '#333', kind: 'outline' },
    ];
    const config: LegendPanelConfig = { entries, defaultVisible: true };
    const panel = new LegendPanel(container, config);
    const panelDiv = container.lastChild as HTMLElement;
    const rows = panelDiv.querySelectorAll('div');
    expect(rows.length).toBe(3);
    rows.forEach((row, i) => {
      const labelSpan = row.querySelector('span:last-child') as HTMLSpanElement;
      expect(labelSpan.textContent).toBe(entries[i].label);
    });
    panel.destroy();
  });

  describe('kind swatches', () => {
    it('fill kind renders solid background-color swatch', () => {
      const entries: LegendEntry[] = [
        { label: 'Fill', color: '#ff0000', kind: 'fill' },
      ];
      const config: LegendPanelConfig = { entries, defaultVisible: true };
      const panel = new LegendPanel(container, config);
      const swatch = (container.lastChild as HTMLElement).querySelector('span') as HTMLSpanElement;
      expect(swatch.style.background).toBeTruthy();
      const rgb = swatch.style.background;
      expect(rgb).toMatch(/rgb\(255,\s*0,\s*0\)|#ff0000/);
      panel.destroy();
    });

    it('line kind renders horizontal line via border-top', () => {
      const entries: LegendEntry[] = [
        { label: 'Line', color: '#00ff00', kind: 'line' },
      ];
      const config: LegendPanelConfig = { entries, defaultVisible: true };
      const panel = new LegendPanel(container, config);
      const swatch = (container.lastChild as HTMLElement).querySelector('span') as HTMLSpanElement;
      expect(swatch.style.borderTop).toMatch(/3px/);
      expect(swatch.style.borderTop).toMatch(/rgb\(0,\s*255,\s*0\)/);
      panel.destroy();
    });

    it('outline kind renders hollow rect via border', () => {
      const entries: LegendEntry[] = [
        { label: 'Outline', color: '#0000ff', kind: 'outline' },
      ];
      const config: LegendPanelConfig = { entries, defaultVisible: true };
      const panel = new LegendPanel(container, config);
      const swatch = (container.lastChild as HTMLElement).querySelector('span') as HTMLSpanElement;
      expect(swatch.style.border).toMatch(/2px/);
      expect(swatch.style.border).toMatch(/rgb\(0,\s*0,\s*255\)/);
      expect(swatch.style.background).toBe('transparent');
      panel.destroy();
    });

    it('leftStrip kind renders left-edge bar via gradient background', () => {
      const entries: LegendEntry[] = [
        { label: 'LeftStrip', color: '#ff8800', kind: 'leftStrip' },
      ];
      const config: LegendPanelConfig = { entries, defaultVisible: true };
      const panel = new LegendPanel(container, config);
      const swatch = (container.lastChild as HTMLElement).querySelector('span') as HTMLSpanElement;
      expect(swatch.style.background).toContain('linear-gradient');
      expect(swatch.style.background).toContain('to right');
      expect(swatch.style.background).toContain('#ff8800');
      panel.destroy();
    });

    it('rightStrip kind renders right-edge bar via gradient background', () => {
      const entries: LegendEntry[] = [
        { label: 'RightStrip', color: '#0088ff', kind: 'rightStrip' },
      ];
      const config: LegendPanelConfig = { entries, defaultVisible: true };
      const panel = new LegendPanel(container, config);
      const swatch = (container.lastChild as HTMLElement).querySelector('span') as HTMLSpanElement;
      expect(swatch.style.background).toContain('linear-gradient');
      expect(swatch.style.background).toContain('to left');
      expect(swatch.style.background).toContain('#0088ff');
      panel.destroy();
    });

    it('bracket kind renders thick vertical bar via border-left', () => {
      const entries: LegendEntry[] = [
        { label: 'Bracket', color: '#ff00ff', kind: 'bracket' },
      ];
      const config: LegendPanelConfig = { entries, defaultVisible: true };
      const panel = new LegendPanel(container, config);
      const swatch = (container.lastChild as HTMLElement).querySelector('span') as HTMLSpanElement;
      expect(swatch.style.borderLeft).toMatch(/4px/);
      expect(swatch.style.borderLeft).toMatch(/rgb\(255,\s*0,\s*255\)/);
      expect(swatch.style.background).toBe('transparent');
      panel.destroy();
    });

    it('dot kind renders a filled circular swatch via border-radius', () => {
      const entries: LegendEntry[] = [
        { label: 'Dot', color: '#ff9800', kind: 'dot' },
      ];
      const config: LegendPanelConfig = { entries, defaultVisible: true };
      const panel = new LegendPanel(container, config);
      const swatch = (container.lastChild as HTMLElement).querySelector('span') as HTMLSpanElement;
      expect(swatch.style.borderRadius).toBe('50%');
      expect(swatch.style.background).toMatch(/rgb\(255,\s*152,\s*0\)/);
      panel.destroy();
    });
  });

  it('should remove both toggle button and panel from DOM on destroy (AC-5)', () => {
    const config: LegendPanelConfig = { entries: sampleEntries, defaultVisible: false };
    const panel = new LegendPanel(container, config);

    expect(container.children.length).toBe(2);
    expect(container.querySelector('button')).not.toBeNull();
    expect(container.querySelector('div')).not.toBeNull();

    panel.destroy();

    expect(container.children.length).toBe(0);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('div')).toBeNull();
  });

  it('should be safe to call destroy() multiple times (AC-5)', () => {
    const config: LegendPanelConfig = { entries: sampleEntries, defaultVisible: false };
    const panel = new LegendPanel(container, config);

    panel.destroy();
    panel.destroy();

    expect(container.children.length).toBe(0);
  });

  it('config toggleTop/toggleLeft override the default toggle placement', () => {
    const config: LegendPanelConfig = {
      entries: sampleEntries,
      defaultVisible: false,
      toggleTop: '84px',
      toggleLeft: '64px',
    };
    const panel = new LegendPanel(container, config);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.style.top).toBe('84px');
    expect(button.style.left).toBe('64px');
    panel.destroy();
  });

  it('should create button with correct styles (AC-1)', () => {
    const config: LegendPanelConfig = { entries: sampleEntries, defaultVisible: false };
    const panel = new LegendPanel(container, config);
    const button = container.querySelector('button') as HTMLButtonElement;

    expect(button).not.toBeNull();
    expect(button.style.position).toBe('absolute');
    expect(button.style.top).toBe('86px');
    expect(button.style.left).toBe('8px');
    expect(button.style.zIndex).toBe('10');
    expect(button.style.font).toBe('12px sans-serif');
    expect(button.style.cursor).toBe('pointer');
    expect(button.style.border).toMatch(/1px solid/);
    expect(button.style.borderRadius).toBe('4px');
    expect(button.style.background).toMatch(/rgb\(255,\s*255,\s*255\)|#ffffff/);
    expect(button.style.color).toMatch(/rgb\(51,\s*51,\s*51\)|#333333/);

    panel.destroy();
  });
});
