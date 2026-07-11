export type ViewType = 'overview' | 'footprint';

export interface ViewToggleButtonCallbacks {
  onViewSwitch: (viewType: ViewType) => void;
}

export class ViewToggleButton {
  private button: HTMLButtonElement;
  private currentView: ViewType;
  private callbacks: ViewToggleButtonCallbacks;
  private boundHandleClick: () => void;

  constructor(
    container: HTMLElement,
    callbacks: ViewToggleButtonCallbacks,
    initialView: ViewType = 'overview'
  ) {
    this.currentView = initialView;
    this.callbacks = callbacks;

    this.button = document.createElement('button');
    this.button.textContent = this.getLabel();

    this.button.style.position = 'absolute';
    this.button.style.top = '60px';
    this.button.style.left = '8px';
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

  private getLabel(): string {
    return this.currentView === 'overview' ? 'Overview' : 'Footprint';
  }

  /** Reposition the toggle (view-aware: Footprint moves it clear of the left price axis). */
  setPosition(top: string, left: string): void {
    this.button.style.top = top;
    this.button.style.left = left;
  }

  public setViewType(viewType: ViewType): void {
    this.currentView = viewType;
    this.button.textContent = this.getLabel();
  }

  public destroy(): void {
    this.button.removeEventListener('click', this.boundHandleClick);
    if (this.button.parentNode) {
      this.button.parentNode.removeChild(this.button);
    }
  }

  private handleClick(): void {
    const newView: ViewType = this.currentView === 'overview' ? 'footprint' : 'overview';
    this.callbacks.onViewSwitch(newView);
  }
}