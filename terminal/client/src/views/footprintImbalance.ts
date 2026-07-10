import type { FootprintLevel } from '../types.js';

export const IMBALANCE_RATIO = 3.0;
export const MIN_IMBALANCE_VOLUME = 1.0;
export const STACKED_MIN = 3;

export type ImbalanceSide = 'buy' | 'sell' | 'none';

export interface DiagonalImbalanceResult {
  price: number;
  side: ImbalanceSide;
  ratio: number;
}

export interface ImbalanceOptions {
  ratio?: number;
  minVolume?: number;
}

export interface StackedImbalanceRun {
  side: 'buy' | 'sell';
  fromPrice: number;
  toPrice: number;
  startIndex: number;
  endIndex: number;
}

function getBinIndex(price: number, binSize: number): number {
  return Math.round(price / binSize);
}

function buildBinMap(levels: FootprintLevel[], binSize: number): Map<number, FootprintLevel> {
  const map = new Map<number, FootprintLevel>();
  for (const level of levels) {
    const idx = getBinIndex(level.price, binSize);
    map.set(idx, level);
  }
  return map;
}

export function calculateDiagonalImbalances(
  levels: FootprintLevel[],
  binSize: number,
  opts?: ImbalanceOptions,
): DiagonalImbalanceResult[] {
  const ratioThreshold = opts?.ratio ?? IMBALANCE_RATIO;
  const minVolume = opts?.minVolume ?? MIN_IMBALANCE_VOLUME;

  if (levels.length === 0 || binSize <= 0) {
    return levels.map((l) => ({ price: l.price, side: 'none' as ImbalanceSide, ratio: 0 }));
  }

  const binMap = buildBinMap(levels, binSize);
  const results: DiagonalImbalanceResult[] = [];

  for (const level of levels) {
    const binIdx = getBinIndex(level.price, binSize);

    const buyDominant = level.buy;
    const sellNeighborLevel = binMap.get(binIdx - 1);
    const sellDiagonal = sellNeighborLevel ? sellNeighborLevel.sell : 0;

    const sellDominant = level.sell;
    const buyNeighborLevel = binMap.get(binIdx + 1);
    const buyDiagonal = buyNeighborLevel ? buyNeighborLevel.buy : 0;

    const buyQualifies = buyDominant >= minVolume && buyDominant >= ratioThreshold * sellDiagonal;
    const sellQualifies = sellDominant >= minVolume && sellDominant >= ratioThreshold * buyDiagonal;

    let side: ImbalanceSide = 'none';
    let ratio = 0;

    if (buyQualifies || sellQualifies) {
      const buyRatio = sellDiagonal === 0 ? Infinity : buyDominant / sellDiagonal;
      const sellRatio = buyDiagonal === 0 ? Infinity : sellDominant / buyDiagonal;

      if (buyQualifies && !sellQualifies) {
        side = 'buy';
        ratio = buyRatio;
      } else if (sellQualifies && !buyQualifies) {
        side = 'sell';
        ratio = sellRatio;
      } else {
        const buyDominantVolume = buyDominant;
        const sellDominantVolume = sellDominant;

        if (buyRatio > sellRatio) {
          side = 'buy';
          ratio = buyRatio;
        } else if (sellRatio > buyRatio) {
          side = 'sell';
          ratio = sellRatio;
        } else if (buyDominantVolume > sellDominantVolume) {
          side = 'buy';
          ratio = buyRatio;
        } else if (sellDominantVolume > buyDominantVolume) {
          side = 'sell';
          ratio = sellRatio;
        } else {
          side = 'buy';
          ratio = buyRatio;
        }
      }
    }

    results.push({ price: level.price, side, ratio });
  }

  return results;
}

export function calculateStackedImbalances(
  diagonalResults: DiagonalImbalanceResult[],
  binSize: number,
  minRun?: number,
): StackedImbalanceRun[] {
  const minRunLength = minRun ?? STACKED_MIN;

  if (diagonalResults.length === 0 || binSize <= 0) {
    return [];
  }

  const binToResult = new Map<number, { result: DiagonalImbalanceResult; index: number }>();
  for (let i = 0; i < diagonalResults.length; i++) {
    const r = diagonalResults[i];
    const binIdx = getBinIndex(r.price, binSize);
    binToResult.set(binIdx, { result: r, index: i });
  }

  const sortedBins = Array.from(binToResult.keys()).sort((a, b) => a - b);

  const runs: StackedImbalanceRun[] = [];
  let currentRun: { side: 'buy' | 'sell'; bins: number[] } | null = null;

  function flushRun(): void {
    if (!currentRun) return;
    if (currentRun.bins.length >= minRunLength) {
      const firstBin = currentRun.bins[0];
      const lastBin = currentRun.bins[currentRun.bins.length - 1];
      const firstEntry = binToResult.get(firstBin)!;
      const lastEntry = binToResult.get(lastBin)!;
      runs.push({
        side: currentRun.side,
        fromPrice: firstEntry.result.price,
        toPrice: lastEntry.result.price,
        startIndex: firstEntry.index,
        endIndex: lastEntry.index,
      });
    }
    currentRun = null;
  }

  for (const binIdx of sortedBins) {
    const entry = binToResult.get(binIdx)!;
    const result = entry.result;

    if (result.side === 'none') {
      flushRun();
      continue;
    }

    if (currentRun === null) {
      currentRun = { side: result.side, bins: [binIdx] };
    } else if (result.side === currentRun.side && binIdx === currentRun.bins[currentRun.bins.length - 1] + 1) {
      currentRun.bins.push(binIdx);
    } else {
      flushRun();
      currentRun = { side: result.side, bins: [binIdx] };
    }
  }

  flushRun();

  return runs;
}