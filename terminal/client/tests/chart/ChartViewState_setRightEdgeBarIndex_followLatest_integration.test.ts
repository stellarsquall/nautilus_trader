import { describe, it, expect } from 'vitest';
import { ChartViewState } from '../../src/chart/ChartViewState';

/**
 * Integration tests for the Slice 11 conflict-resolution area in ChartViewState.
 *
 * Branch merge: auto-merge produced a duplicate getRightEdgeBarIndex/
 * setRightEdgeBarIndex pair. Kept `feature/slice11f20826-linked-by-time-viewport`'s
 * later variant — setRightEdgeBarIndex updates followLatest based on isAtTail()
 * when repositioning — and removed the earlier duplicate so the class compiles.
 *
 * ChartViewState is the shared right-edge bookkeeping used by
 * CanvasCandlestickRenderer (and therefore OverviewView). These tests verify the
 * retained variant's followLatest semantics, which the renderer's
 * restoreViewportState depends on for the time-linked handoff.
 */

describe('ChartViewState.setRightEdgeBarIndex followLatest (conflict area: f20826 retained)', () => {
  it('re-enables followLatest when the right edge is repositioned to the tail', () => {
    const state = new ChartViewState(200, 100);
    // Move off the tail (followLatest should become false).
    state.setRightEdgeBarIndex(120);
    expect(state.getFollowLatest()).toBe(false);

    // Reposition to the newest bar; followLatest must flip back to true.
    state.setRightEdgeBarIndex(199);
    expect(state.getFollowLatest()).toBe(true);
    expect(state.getRightEdgeBarIndex()).toBe(199);
  });

  it('disables followLatest when the right edge is moved away from the tail', () => {
    const state = new ChartViewState(200, 100);
    expect(state.getFollowLatest()).toBe(true);

    state.setRightEdgeBarIndex(150);
    expect(state.getFollowLatest()).toBe(false);
    expect(state.getRightEdgeBarIndex()).toBe(150);
  });

  it('does not change followLatest when already at the tail and repositioned to tail', () => {
    const state = new ChartViewState(200, 100);
    expect(state.getFollowLatest()).toBe(true);

    state.setRightEdgeBarIndex(199);
    expect(state.getFollowLatest()).toBe(true);
  });

  it('clamps an over-large index to the tail and marks followLatest true', () => {
    const state = new ChartViewState(200, 100);
    state.pan(-50);
    expect(state.getFollowLatest()).toBe(false);

    state.setRightEdgeBarIndex(9999);
    expect(state.getRightEdgeBarIndex()).toBe(199);
    expect(state.getFollowLatest()).toBe(true);
  });

  it('clamps an under-sized index to the head and marks followLatest false', () => {
    const state = new ChartViewState(200, 100);
    state.setRightEdgeBarIndex(-10);
    // With a 100-bar window the leftmost scrollable right edge is index 99.
    expect(state.getRightEdgeBarIndex()).toBe(99);
    expect(state.getFollowLatest()).toBe(false);
  });

  it('getViewportState-style downstream consumer sees the updated followLatest flag', () => {
    const state = new ChartViewState(200, 100);
    state.setRightEdgeBarIndex(120);
    expect(state.getState().followLatest).toBe(false);
    state.setRightEdgeBarIndex(199);
    expect(state.getState().followLatest).toBe(true);
  });
});
