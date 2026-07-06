/**
 * Main entry point for NautilusTrader frontend.
 *
 * Establishes WebSocket connection to backend, instantiates chart renderer
 * and pane, and routes incoming messages to appropriate handlers.
 */

import { CandlestickPane } from './panes/CandlestickPane';
import { LightweightChartsRenderer } from './renderers/LightweightChartsRenderer';
import type { Envelope } from './types';

// Get chart container from DOM
const container = document.getElementById('chart-container');
if (!container) {
  throw new Error('chart-container element not found');
}

// Instantiate renderer and pane
const renderer = new LightweightChartsRenderer(container);
const candlestickPane = new CandlestickPane(renderer);

// Create WebSocket connection to backend
const ws = new WebSocket(`ws://${window.location.host}/ws`);

/**
 * Handle incoming WebSocket messages.
 *
 * Parses JSON envelope and dispatches to appropriate pane handler
 * based on envelope.type.
 */
ws.onmessage = (event) => {
  try {
    const envelope: Envelope = JSON.parse(event.data);

    // Dispatch based on message type
    switch (envelope.type) {
      case 'bar':
        candlestickPane.handleMessage(envelope);
        break;
      default:
        console.warn(`Unknown message type: ${envelope.type}`);
    }
  } catch (error) {
    console.error('Failed to parse WebSocket message:', error);
  }
};

/**
 * Handle WebSocket errors.
 */
ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

/**
 * Handle WebSocket connection close.
 */
ws.onclose = () => {
  console.log('WebSocket connection closed');
};
