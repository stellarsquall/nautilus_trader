import { createChart, IChartApi, ISeriesApi, CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { Renderer } from './Renderer';
import type { BarPayload } from '../types';

/**
 * LightweightChartsRenderer implements the Renderer interface using TradingView's
 * lightweight-charts library for candlestick visualization.
 *
 * This renderer:
 * - Creates a chart sized to the container (width=clientWidth, height=600)
 * - Renders candlesticks with green upColor and red downColor
 * - Converts timestamps from milliseconds to seconds for lightweight-charts API
 * - Manages window resize events for responsive charts
 */
export class LightweightChartsRenderer implements Renderer {
  private chart: IChartApi;
  private candlestickSeries: ISeriesApi<'Candlestick'>;
  private resizeHandler: () => void;

  constructor(container: HTMLElement) {
    // Create chart with container width and fixed height of 600px
    this.chart = createChart(container, {
      width: container.clientWidth,
      height: 600,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333333',
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

    // Create resize handler bound to this instance
    this.resizeHandler = () => {
      this.chart.applyOptions({ width: container.clientWidth });
    };

    // Attach window resize listener
    window.addEventListener('resize', this.resizeHandler);
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
   * Clean up resources: remove resize listener and destroy chart.
   */
  destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.chart.remove();
  }
}
