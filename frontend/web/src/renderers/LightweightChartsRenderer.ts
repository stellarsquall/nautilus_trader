import { createChart, IChartApi, ISeriesApi, CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { Renderer } from './Renderer';
import type { BarPayload } from '../types';

/**
 * LightweightChartsRenderer implements the Renderer interface using TradingView's
 * lightweight-charts library for candlestick visualization.
 *
 * This renderer:
 * - Creates a chart that auto-sizes to fill its container (via ResizeObserver)
 * - Renders candlesticks with green upColor and red downColor
 * - Converts timestamps from milliseconds to seconds for lightweight-charts API
 * - Disables the TradingView attribution logo
 */
export class LightweightChartsRenderer implements Renderer {
  private chart: IChartApi;
  private candlestickSeries: ISeriesApi<'Candlestick'>;

  constructor(container: HTMLElement) {
    // autoSize makes the chart track the container's size (width AND height)
    // via a ResizeObserver, so it fills the available page space and stays
    // responsive without a manual window-resize handler.
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333333',
        // Remove the TradingView logo/attribution from the chart surface.
        attributionLogo: false,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // Add candlestick series with specified colors
    this.candlestickSeries = this.chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
    });
  }

  /**
   * Update the chart with new bar data.
   *
   * Accepts BarPayload with ts_event in milliseconds, converts to seconds
   * (Math.floor(ts_event / 1000)) as required by lightweight-charts API.
   */
  update(data: unknown): void {
    const bar = data as BarPayload;

    // Convert timestamp from milliseconds to seconds
    const candlestick: CandlestickData = {
      time: Math.floor(bar.ts_event / 1000) as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    };

    this.candlestickSeries.update(candlestick);
  }

  /**
   * Clean up resources: destroy the chart (autoSize's ResizeObserver is torn
   * down internally by chart.remove()).
   */
  destroy(): void {
    this.chart.remove();
  }
}
