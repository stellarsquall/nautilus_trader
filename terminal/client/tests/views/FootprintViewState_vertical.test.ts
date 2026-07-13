import { describe, it, expect } from 'vitest';
import {
  FootprintViewState,
  MIN_VISIBLE_ROWS,
  EXTRA_SCROLL_SCREENS,
} from '../../src/views/FootprintViewState';

/**
 * Slice 12 — vertical pan/scroll state on FootprintViewState.
 * Pixel-based offset + auto-center flag + clamp that keeps MIN_VISIBLE_ROWS on screen.
 */
describe('FootprintViewState — vertical scroll (slice 12)', () => {
  const mkState = () => new FootprintViewState(300, 100);

  it('defaults: verticalOffset 0, verticalAutoCenter true', () => {
    const s = mkState();
    expect(s.getVerticalOffset()).toBe(0);
    expect(s.getVerticalAutoCenter()).toBe(true);
  });

  it('exports MIN_VISIBLE_ROWS = 3', () => {
    expect(MIN_VISIBLE_ROWS).toBe(3);
  });

  it('panVertical adds the delta and disables auto-center', () => {
    const s = mkState();
    // Tall ladder so there is room to scroll: content 2000px, viewport 400px.
    s.setVerticalContentBounds(2000, 400);
    s.panVertical(120);
    expect(s.getVerticalOffset()).toBe(120);
    expect(s.getVerticalAutoCenter()).toBe(false);
    s.panVertical(30);
    expect(s.getVerticalOffset()).toBe(150);
  });

  it('resetVertical returns to offset 0 + auto-center', () => {
    const s = mkState();
    s.setVerticalContentBounds(2000, 400);
    s.panVertical(200);
    s.resetVertical();
    expect(s.getVerticalOffset()).toBe(0);
    expect(s.getVerticalAutoCenter()).toBe(true);
  });

  it('setVerticalOffset sets an absolute (clamped) offset and disables auto-center', () => {
    const s = mkState();
    s.setVerticalContentBounds(2000, 400);
    s.setVerticalOffset(500);
    expect(s.getVerticalOffset()).toBe(500);
    expect(s.getVerticalAutoCenter()).toBe(false);
  });

  it('clamps the downward scroll to content + EXTRA_SCROLL_SCREENS viewports', () => {
    const s = mkState();
    const content = 2000, viewport = 400;
    s.setVerticalContentBounds(content, viewport);
    const maxOffset = content + EXTRA_SCROLL_SCREENS * viewport; // 4000
    s.panVertical(999999);
    expect(s.getVerticalOffset()).toBe(maxOffset);
  });

  it('clamps the upward scroll to -(viewport + EXTRA_SCROLL_SCREENS viewports)', () => {
    const s = mkState();
    const content = 2000, viewport = 400;
    s.setVerticalContentBounds(content, viewport);
    const minOffset = -(viewport + EXTRA_SCROLL_SCREENS * viewport); // -2400
    s.panVertical(-999999);
    expect(s.getVerticalOffset()).toBe(minOffset);
  });

  it('allows scrolling far past the traded range into empty space', () => {
    const s = mkState();
    s.setVerticalContentBounds(200, 400); // tiny ladder, one screen viewport
    s.panVertical(1000); // way past the 200px of data
    expect(s.getVerticalOffset()).toBeGreaterThan(200);
  });

  it('re-clamps the stored offset when bounds shrink dramatically', () => {
    const s = mkState();
    s.setVerticalContentBounds(2000, 400);
    s.panVertical(3500);
    expect(s.getVerticalOffset()).toBe(3500);
    // Ladder + viewport shrink: max allowed offset drops, so it re-clamps down.
    s.setVerticalContentBounds(100, 50);
    expect(s.getVerticalOffset()).toBe(100 + EXTRA_SCROLL_SCREENS * 50); // 350
  });

  it('syncVerticalOffset updates the offset WITHOUT leaving auto-center', () => {
    const s = mkState();
    s.setVerticalContentBounds(2000, 400);
    expect(s.getVerticalAutoCenter()).toBe(true);
    s.syncVerticalOffset(800);
    expect(s.getVerticalOffset()).toBe(800);
    expect(s.getVerticalAutoCenter()).toBe(true);
  });

  it('degenerate bounds (no content / no viewport) clamp to 0', () => {
    const s = mkState();
    s.setVerticalContentBounds(0, 400);
    s.panVertical(200);
    expect(s.getVerticalOffset()).toBe(0);
    s.setVerticalContentBounds(2000, 0);
    s.setVerticalOffset(200);
    expect(s.getVerticalOffset()).toBe(0);
  });

  it('vertical state is independent of horizontal pan/zoom', () => {
    const s = mkState();
    s.setVerticalContentBounds(2000, 400);
    s.panVertical(100);
    s.pan(-5); // horizontal
    s.setVisibleCount(50); // zoom
    expect(s.getVerticalOffset()).toBe(100);
    expect(s.getVerticalAutoCenter()).toBe(false);
  });
});
