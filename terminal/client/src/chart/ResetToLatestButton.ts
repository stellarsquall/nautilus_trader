import type { ChartViewState } from './ChartViewState';

export interface ResetToLatestButtonCallbacks {
  /** Called after resetToLatest() to schedule redraw */
  onReset: () => void;
}

export class ResetToLatestButton {
  private button: HTMLButtonElement;
  private viewState: ChartViewState;
  private callbacks: ResetToLatestButtonCallbacks;
  private boundHandleClick: () => void;

  /**
   * Construct and create button element.
   *
   * The button is positioned absolutely in the top-right corner of the container.
   * Initial visibility is determined by viewState.getState().followLatest.
   *
   * @param container - Container element to append button to
   * @param viewState - ChartViewState to call resetToLatest() on
   * @param callbacks - Callbacks for triggering redraws
   */
  constructor(
    container: HTMLElement,
    viewState: ChartViewState,
    callbacks: ResetToLatestButtonCallbacks
  ) {
    this.viewState = viewState;
    this.callbacks = callbacks;

    // Create button element
    this.button = document.createElement('button');
    this.button.textContent = 'Latest';

    // Apply styles
    this.button.style.position = 'absolute';
    this.button.style.top = '10px';
    this.button.style.right = '10px';
    this.button.style.padding = '6px 12px';
    this.button.style.fontSize = '12px';
    this.button.style.background = '#ffffff';
    this.button.style.border = '1px solid #333333';
    this.button.style.cursor = 'pointer';
    this.button.style.borderRadius = '3px';

    // Bind and attach click listener
    this.boundHandleClick = this.handleClick.bind(this);
    this.button.addEventListener('click', this.boundHandleClick);

    // Append to container
    container.appendChild(this.button);

    // Set initial visibility
    this.updateVisibility();
  }

  /**
   * Update button visibility based on follow state.
   *
   * Call after any view-state change that might affect followLatest.
   */
  public updateVisibility(): void {
    const state = this.viewState.getState();
    this.button.style.display = state.followLatest ? 'none' : 'block';
  }

  /**
   * Destroy and remove button.
   */
  public destroy(): void {
    // Remove click listener
    this.button.removeEventListener('click', this.boundHandleClick);

    // Remove button from DOM
    if (this.button.parentNode) {
      this.button.parentNode.removeChild(this.button);
    }
  }

  /**
   * Handle button click event.
   */
  private handleClick(): void {
    this.viewState.resetToLatest();
    this.callbacks.onReset();
  }
}
