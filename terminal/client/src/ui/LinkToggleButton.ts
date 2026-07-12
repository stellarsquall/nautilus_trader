export interface LinkToggleButtonConfig {
  onToggle: (linked: boolean) => void;
}

export class LinkToggleButton {
  private button: HTMLButtonElement;
  private linked: boolean;
  private config: LinkToggleButtonConfig;
  private boundHandleClick: () => void;

  constructor(container: HTMLElement, config: LinkToggleButtonConfig) {
    this.linked = true;
    this.config = config;

    this.button = document.createElement('button');
    this.button.textContent = this.getLabel();

    this.button.style.position = 'absolute';
    this.button.style.top = '162px';
    this.button.style.left = '64px';
    this.button.style.zIndex = '10';
    this.button.style.padding = '4px 8px';
    this.button.style.font = '12px sans-serif';
    this.button.style.cursor = 'pointer';
    this.button.style.border = '1px solid #cccccc';
    this.button.style.borderRadius = '4px';
    this.button.style.background = '#ffffff';
    this.button.style.color = '#333333';

    this.boundHandleClick = this.handleClick.bind(this);
    this.button.addEventListener('click', this.boundHandleClick);

    container.appendChild(this.button);
  }

  getLabel(): string {
    return this.linked ? 'Link: On' : 'Link: Off';
  }

  setPosition(top: string, left: string): void {
    this.button.style.top = top;
    this.button.style.left = left;
  }

  setLinked(linked: boolean): void {
    this.linked = linked;
    this.button.textContent = this.getLabel();
  }

  destroy(): void {
    this.button.removeEventListener('click', this.boundHandleClick);
    if (this.button.parentNode) {
      this.button.parentNode.removeChild(this.button);
    }
  }

  private handleClick(): void {
    this.linked = !this.linked;
    this.button.textContent = this.getLabel();
    this.config.onToggle(this.linked);
  }
}
