import type { BarPayload, CvdPayload, FootprintPayload, ChartStoreState } from '../types.js';

export const MAX_BARS = 1000;

export class ChartStore {
  private buffer: (BarPayload | null)[];
  private head: number = 0;
  private size: number = 0;
  private cvd: Map<number, CvdPayload>;
  private footprints: Map<number, FootprintPayload>;

  constructor() {
    this.buffer = new Array<BarPayload | null>(MAX_BARS).fill(null);
    this.cvd = new Map<number, CvdPayload>();
    this.footprints = new Map<number, FootprintPayload>();
  }

  public ingestBar(bar: BarPayload): void {
    const evicted = this.buffer[this.head];
    if (evicted !== null) {
      this.cvd.delete(evicted.ts_event);
      this.footprints.delete(evicted.ts_event);
    }

    this.buffer[this.head] = bar;
    this.head = (this.head + 1) % MAX_BARS;
    if (this.size < MAX_BARS) {
      this.size++;
    }
  }

  public ingestCvd(cvd: CvdPayload): void {
    this.cvd.set(cvd.ts_event, cvd);
  }

  public ingestFootprint(footprint: FootprintPayload): void {
    this.footprints.set(footprint.ts_event, footprint);
  }

  public getState(): Readonly<ChartStoreState> {
    const bars: BarPayload[] = [];
    const start = this.size < MAX_BARS ? 0 : this.head;
    const count = this.size < MAX_BARS ? this.size : MAX_BARS;

    for (let i = 0; i < count; i++) {
      const idx = (start + i) % MAX_BARS;
      const bar = this.buffer[idx];
      if (bar !== null) {
        bars.push({ ...bar });
      }
    }

    return {
      bars,
      cvd: new Map(this.cvd),
      footprints: new Map(this.footprints),
    };
  }

  public getBarCount(): number {
    return this.size;
  }
}
