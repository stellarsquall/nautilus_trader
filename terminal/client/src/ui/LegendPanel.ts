export type LegendKind = 'fill' | 'line' | 'outline' | 'leftStrip' | 'rightStrip' | 'bracket' | 'dot' | 'valueArea';

export interface LegendEntry {
  label: string;
  color: string;
  kind: LegendKind;
}

export interface LegendPanelConfig {
  entries: LegendEntry[];
  defaultVisible?: boolean;
  toggleTop?: string;
  toggleLeft?: string;
}

export class LegendPanel {
  private toggleButton: HTMLButtonElement;
  private panel: HTMLDivElement;
  private visible: boolean;
  private container: HTMLElement;

  constructor(container: HTMLElement, config: LegendPanelConfig) {
    this.container = container;
    this.visible = config.defaultVisible ?? false;

    this.toggleButton = document.createElement('button');
    this.toggleButton.textContent = this.visible ? 'Legend: ON' : 'Legend: OFF';
    this.toggleButton.style.position = 'absolute';
    this.toggleButton.style.top = config.toggleTop ?? '86px';
    this.toggleButton.style.left = config.toggleLeft ?? '8px';
    this.toggleButton.style.zIndex = '10';
    this.toggleButton.style.padding = '4px 8px';
    this.toggleButton.style.font = '12px sans-serif';
    this.toggleButton.style.cursor = 'pointer';
    this.toggleButton.style.border = '1px solid #cccccc';
    this.toggleButton.style.borderRadius = '4px';
    this.toggleButton.style.background = '#ffffff';
    this.toggleButton.style.color = '#333333';
    this.toggleButton.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.style.position = 'absolute';
    this.panel.style.bottom = '8px';
    this.panel.style.right = '8px';
    this.panel.style.zIndex = '10';
    this.panel.style.background = 'rgba(255, 255, 255, 0.9)';
    this.panel.style.border = '1px solid #cccccc';
    this.panel.style.borderRadius = '4px';
    this.panel.style.padding = '6px 10px';
    this.panel.style.font = '12px sans-serif';
    this.panel.style.color = '#333333';
    this.panel.style.display = this.visible ? 'block' : 'none';

    config.entries.forEach(entry => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.marginBottom = '3px';

      const swatch = document.createElement('span');
      swatch.style.display = 'inline-block';
      swatch.style.width = '16px';
      swatch.style.height = '14px';
      swatch.style.flexShrink = '0';

      switch (entry.kind) {
        case 'fill':
          swatch.style.background = entry.color;
          break;
        case 'line':
          swatch.style.borderTop = `3px solid ${entry.color}`;
          swatch.style.height = '14px';
          swatch.style.boxSizing = 'border-box';
          break;
        case 'outline':
          swatch.style.border = `2px solid ${entry.color}`;
          swatch.style.background = 'transparent';
          swatch.style.boxSizing = 'border-box';
          break;
        case 'leftStrip':
          swatch.style.background = `linear-gradient(to right, ${entry.color} 4px, transparent 4px)`;
          break;
        case 'rightStrip':
          swatch.style.background = `linear-gradient(to left, ${entry.color} 4px, transparent 4px)`;
          break;
        case 'bracket':
          swatch.style.borderLeft = `4px solid ${entry.color}`;
          swatch.style.background = 'transparent';
          swatch.style.boxSizing = 'border-box';
          break;
        case 'dot':
          swatch.style.background = entry.color;
          swatch.style.width = '10px';
          swatch.style.height = '10px';
          swatch.style.borderRadius = '50%';
          swatch.style.margin = '0 3px';
          break;
        case 'valueArea':
          // Composite: the translucent band with its dashed VAH/VAL edges.
          swatch.style.background = '#e9eaec';
          swatch.style.borderTop = `1px dashed ${entry.color}`;
          swatch.style.borderBottom = `1px dashed ${entry.color}`;
          swatch.style.boxSizing = 'border-box';
          break;
      }

      const label = document.createElement('span');
      label.textContent = entry.label;

      row.appendChild(swatch);
      row.appendChild(label);
      this.panel.appendChild(row);
    });

    container.appendChild(this.toggleButton);
    container.appendChild(this.panel);
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.panel.style.display = this.visible ? 'block' : 'none';
    this.toggleButton.textContent = this.visible ? 'Legend: ON' : 'Legend: OFF';
  }

  public destroy(): void {
    if (this.toggleButton.parentNode) {
      this.toggleButton.parentNode.removeChild(this.toggleButton);
    }
    if (this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }
  }
}
