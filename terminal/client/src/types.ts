/**
 * WebSocket envelope and payload type definitions.
 *
 * Defines the typed contract for all WebSocket messages between the server
 * and client. The envelope protocol is versioned and extensible to support
 * future message types (trade, book_delta, footprint, cvd, depth_heatmap)
 * without breaking existing handlers.
 */

/**
 * WebSocket envelope structure (v1).
 *
 * Every WebSocket frame conforms to this structure, enabling type-safe
 * message parsing and dispatch in the client.
 */
export interface Envelope {
  /** Protocol version (literal 1, not number) */
  v: 1;

  /** Message type - slice 1 implements 'bar', slice 5 adds 'cvd'; others reserved */
  type: 'bar' | 'trade' | 'book_delta' | 'footprint' | 'cvd' | 'depth_heatmap';

  /** Monotonically increasing sequence number (global across all types) */
  seq: number;

  /** Type-specific payload (BarPayload for 'bar', CvdPayload for 'cvd', FootprintPayload for 'footprint', unknown for future types) */
  payload: BarPayload | CvdPayload | FootprintPayload | unknown;
}

/**
 * Bar (OHLCV) payload for type='bar' messages.
 *
 * All fields use snake_case to match backend payload keys exactly.
 * Timestamps are in milliseconds (converted from NautilusTrader nanoseconds).
 */
export interface BarPayload {
  /** Event timestamp in milliseconds since UNIX epoch */
  ts_event: number;

  /** Bar open price */
  open: number;

  /** Bar high price (maximum) */
  high: number;

  /** Bar low price (minimum) */
  low: number;

  /** Bar close price */
  close: number;

  /** Bar volume (real traded volume, aggregated from trade ticks) */
  volume: number;

  /**
   * Aggressive buy volume in this bar (trades with BUYER aggressor).
   * Optional: present on slice-5+ order-flow bars; absent on legacy bars.
   */
  buy_volume?: number;

  /** Aggressive sell volume in this bar (trades with SELLER aggressor). Optional. */
  sell_volume?: number;

  /** Per-bar volume delta (buy_volume - sell_volume). Optional. */
  delta?: number;
}

/**
 * Cumulative Volume Delta (CVD) payload for type='cvd' messages.
 *
 * Emitted once per closed bar, immediately after the bar envelope. Carries the
 * session-cumulative volume delta (running sum of per-bar deltas) plus this
 * bar's delta. Aligns to the bar with the matching ts_event.
 */
export interface CvdPayload {
  /** Event timestamp in milliseconds (matches the corresponding bar's ts_event) */
  ts_event: number;

  /** Session-cumulative volume delta (running sum of per-bar deltas) */
  cvd: number;

  /** This bar's volume delta (buy_volume - sell_volume) */
  delta: number;
}

/**
 * A single price level in a footprint chart.
 *
 * Captures the aggressive buy and sell volume at a specific price level within
 * a bar, enabling order-flow analysis (footprint / market profile charts).
 */
export interface FootprintLevel {
  /** Price of this level */
  price: number;

  /** Aggressive buy volume at this price level */
  buy: number;

  /** Aggressive sell volume at this price level */
  sell: number;
}

/**
 * Footprint (order-flow) payload for type='footprint' messages.
 *
 * Carries per-price-level buy/sell volume for a single bar, enabling the
 * client to render bid/ask footprint visualizations.
 */
export interface FootprintPayload {
  /** Event timestamp in milliseconds (matches the corresponding bar's ts_event) */
  ts_event: number;

  /** Price bin size (level height, in price units) */
  bin_size: number;

  /** Per-price-level buy/sell volume distribution */
  levels: FootprintLevel[];
}

/**
 * Snapshot of the ChartStore's current data buffers.
 *
 * Returned by ChartStore.getState() for view state seeding and
 * Pane.draw() consumption.
 */
export interface ChartStoreState {
  /** Rolling buffer of bars in chronological order (newest last) */
  bars: BarPayload[];

  /** CVD data keyed by ts_event timestamp */
  cvd: Map<number, CvdPayload>;

  /** Footprint data keyed by ts_event timestamp */
  footprints: Map<number, FootprintPayload>;
}
