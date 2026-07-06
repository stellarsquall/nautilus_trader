/**
 * CandlestickPane - Pane handler for bar (OHLC) messages.
 *
 * Receives bar envelopes from WebSocket, validates OHLC invariants,
 * and forwards valid payloads to the renderer.
 */

import type { Renderer } from '../renderers/Renderer';
import type { Envelope, BarPayload } from '../types';

export class CandlestickPane {
  private renderer: Renderer;

  /**
   * Create a CandlestickPane.
   *
   * @param renderer - The renderer instance to update with bar data
   */
  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /**
   * Handle incoming WebSocket message envelope.
   *
   * Validates envelope type and OHLC invariants before forwarding to renderer.
   * Logs errors for invalid messages.
   *
   * @param envelope - WebSocket message envelope
   */
  handleMessage(envelope: Envelope): void {
    // Check envelope type
    if (envelope.type !== 'bar') {
      console.error(`CandlestickPane received non-bar message: ${envelope.type}`);
      return;
    }

    const payload = envelope.payload as BarPayload;

    // Validate OHLC relationships
    if (!this.validateOHLC(payload)) {
      console.error('Invalid OHLC bar:', payload);
      return;
    }

    // Forward valid bar to renderer
    this.renderer.update(payload);
  }

  /**
   * Validate OHLC invariants.
   *
   * Checks:
   * - high >= open, high >= close, high >= low (high is maximum)
   * - low <= open, low <= close, low <= high (low is minimum)
   * - all prices > 0 (positive)
   *
   * @param bar - Bar payload to validate
   * @returns true if valid, false otherwise
   */
  private validateOHLC(bar: BarPayload): boolean {
    const { open, high, low, close } = bar;

    // High must be >= all other prices
    if (high < open || high < close || high < low) {
      return false;
    }

    // Low must be <= all other prices
    if (low > open || low > close || low > high) {
      return false;
    }

    // All prices must be positive
    if (open <= 0 || close <= 0 || high <= 0 || low <= 0) {
      return false;
    }

    return true;
  }

  /**
   * Destroy the pane and clean up resources.
   */
  destroy(): void {
    this.renderer.destroy();
  }
}
