import { describe, it, expect } from 'vitest';
import {
  IMBALANCE_RATIO,
  MIN_IMBALANCE_VOLUME,
  STACKED_MIN,
  calculateDiagonalImbalances,
  calculateStackedImbalances,
} from './footprintImbalance';
import type { FootprintLevel } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Constants', () => {
  it('should have IMBALANCE_RATIO === 3.0', () => {
    expect(IMBALANCE_RATIO).toBe(3.0);
  });

  it('should have MIN_IMBALANCE_VOLUME === 1.0', () => {
    expect(MIN_IMBALANCE_VOLUME).toBe(1.0);
  });

  it('should have STACKED_MIN === 3', () => {
    expect(STACKED_MIN).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// calculateDiagonalImbalances – boundary / >= buy
// ---------------------------------------------------------------------------

describe('calculateDiagonalImbalances – buy boundary', () => {
  it('buy(P) === 3.0 * sell(P - binSize) fires side==="buy" with ratio===3.0', () => {
    const bin = 0.5;
    const levels: FootprintLevel[] = [
      { price: 100, sell: 1, buy: 0 },
      { price: 100 + bin, sell: 0, buy: 3 },
    ];
    const results = calculateDiagonalImbalances(levels, bin);
    // level 0 (price 100) – no lower neighbor → diagonal 0, sell=1 ≥ minVol, ratio = 1/0 = Inf
    // but also buy=0, only possible 'sell' side
    // level 1 (price 100.5) – buy=3 / sell=1 at neighbor = 3 → 'buy'
    expect(results[1].side).toBe('buy');
    expect(results[1].ratio).toBe(3.0);
  });

  it('buy(P) === 2.9 * sell(P - binSize) returns side==="none"', () => {
    const bin = 0.5;
    const levels: FootprintLevel[] = [
      { price: 100, sell: 1, buy: 0 },
      { price: 100 + bin, sell: 0, buy: 2.9 },
    ];
    const results = calculateDiagonalImbalances(levels, bin);
    expect(results[1].side).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// calculateDiagonalImbalances – sell mirror
// ---------------------------------------------------------------------------

describe('calculateDiagonalImbalances – sell mirror', () => {
  it('sell(P) === 3.0 * buy(P + binSize) fires side==="sell" with ratio===3.0', () => {
    const bin = 0.5;
    const levels: FootprintLevel[] = [
      { price: 100, sell: 3, buy: 0 },
      { price: 100 + bin, sell: 0, buy: 1 },
    ];
    const results = calculateDiagonalImbalances(levels, bin);
    expect(results[0].side).toBe('sell');
    expect(results[0].ratio).toBe(3.0);
  });

  it('sell(P) === 2.9 * buy(P + binSize) returns side==="none"', () => {
    const bin = 0.5;
    const levels: FootprintLevel[] = [
      { price: 100, sell: 2.9, buy: 0 },
      { price: 100 + bin, sell: 0, buy: 1 },
    ];
    const results = calculateDiagonalImbalances(levels, bin);
    expect(results[0].side).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// calculateDiagonalImbalances – noise floor
// ---------------------------------------------------------------------------

describe('calculateDiagonalImbalances – noise floor', () => {
  it('dominant volume 0.99 with absent diagonal neighbor yields side==="none"', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0.99, buy: 0 },
    ];
    const results = calculateDiagonalImbalances(levels, 0.5);
    expect(results[0].side).toBe('none');
  });

  it('dominant volume 1.0 with absent diagonal neighbor yields an imbalance with ratio===Infinity', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 1.0, buy: 0 },
    ];
    const results = calculateDiagonalImbalances(levels, 0.5);
    expect(results[0].side).toBe('sell');
    expect(results[0].ratio).toBe(Infinity);
  });

  it('an explicit 0-volume neighbor and a missing bin produce identical results', () => {
    // Two scenarios:
    // (A) level at 100 with sell=1 has NO neighbor → sell/0 = Infinity
    // (B) level at 100 with sell=1 has a neighbor at 100+bin with buy=0
    const bin = 0.5;
    const levelsA: FootprintLevel[] = [
      { price: 100, sell: 1, buy: 0 },
    ];
    const levelsB: FootprintLevel[] = [
      { price: 100, sell: 1, buy: 0 },
      { price: 100 + bin, sell: 0, buy: 0 },
    ];
    const resA = calculateDiagonalImbalances(levelsA, bin);
    const resB = calculateDiagonalImbalances(levelsB, bin);
    expect(resA[0].side).toBe(resB[0].side);
    expect(resA[0].ratio).toBe(resB[0].ratio);
  });
});

// ---------------------------------------------------------------------------
// calculateDiagonalImbalances – sparse / float safety
// ---------------------------------------------------------------------------

describe('calculateDiagonalImbalances – sparse / float safety', () => {
  it('levels at bins i and i+2 (bin i+1 missing) use 0 as diagonal volume for bin i+2', () => {
    // prices 100 (bin 0) and 110 (bin 2) with binSize 5 → bin 1 is missing
    // level at 110 checks diagonal at bin 1 (sell missing → 0)
    const levels: FootprintLevel[] = [
      { price: 100, sell: 1, buy: 0 },
      { price: 110, sell: 0, buy: 3 },
    ];
    const results = calculateDiagonalImbalances(levels, 5);
    // At bin 2 (price 110): buy=3, sell diagonal = missing (0) → buy qualifies, ratio = Infinity
    expect(results[1].side).toBe('buy');
    expect(results[1].ratio).toBe(Infinity);
  });

  it('levels priced 0.1/0.2/0.3 with binSize 0.1 resolve adjacency with no false gaps', () => {
    const levels: FootprintLevel[] = [
      { price: 0.1, sell: 0, buy: 1 },
      { price: 0.2, sell: 1, buy: 0 },
      { price: 0.3, sell: 0, buy: 1 },
    ];
    // Bins via Math.round(p/0.1): 1, 2, 3 → consecutive, no gaps
    const results = calculateDiagonalImbalances(levels, 0.1);
    // At bin 2 (0.2): sell=1, buy diagonal = buy at bin 3 = 1, ratio = 1 → sell qualifies since >= 3*1? No, 1 < 3. So 'none'
    // At bin 1 (0.1): buy=1, sell diagonal = sell at bin 0 (missing) → 0, ratio = Infinity → 'buy'
    // At bin 3 (0.3): buy=1, sell diagonal = sell at bin 2 = 1, ratio = 1 < 3 → 'none'
    expect(results[0].side).toBe('buy');
    expect(results[1].side).toBe('none');
    expect(results[2].side).toBe('none');
    expect(results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// calculateDiagonalImbalances – shape, exclusivity, tie-break, edge cases
// ---------------------------------------------------------------------------

describe('calculateDiagonalImbalances – shape & exclusivity', () => {
  it('output array length equals input length in the same ascending order', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
      { price: 102, sell: 0, buy: 5 },
    ];
    const results = calculateDiagonalImbalances(levels, 1);
    expect(results).toHaveLength(3);
    expect(results[0].price).toBe(100);
    expect(results[1].price).toBe(101);
    expect(results[2].price).toBe(102);
  });

  it('each result has {price, side, ratio} shape', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
    ];
    const results = calculateDiagonalImbalances(levels, 1);
    expect(results[0]).toHaveProperty('price');
    expect(results[0]).toHaveProperty('side');
    expect(results[0]).toHaveProperty('ratio');
  });

  it('when both buy and sell conditions fire on one level, exactly one non-"none" side is returned, preferring the larger ratio', () => {
    // buy=6, sell=6 with ratio=3 → buy diagonal = 0 (missing), sell diagonal = 0 (missing)
    // buy qualifies (6>=1, 6>=0), sell qualifies (6>=1, 6>=0)
    // buy ratio = 6/0 = Inf, sell ratio = 6/0 = Inf → equal → larger dominant vol (equal) → 'buy'
    const levels: FootprintLevel[] = [
      { price: 100, sell: 6, buy: 6 },
    ];
    const results = calculateDiagonalImbalances(levels, 1);
    expect(results[0].side).not.toBe('none');
    expect(results[0].side).toBe('buy');

    // Test with unequal ratios: buy=13, sell=10; sell diagonal at bin -1 is missing (0)
    // buy: 13 >= 3*0=0 → qualifies, sell: 10 >= 3*1=3 → qualifies
    // buy ratio = 13/0 = Infinity, sell ratio = 10/1 = 10 → buy wins
    const levels2: FootprintLevel[] = [
      { price: 100, sell: 10, buy: 13 },
      { price: 101, sell: 1, buy: 1 },
    ];
    const results2 = calculateDiagonalImbalances(levels2, 1);
    expect(results2[0].side).toBe('buy');
    expect(results2[0].ratio).toBe(Infinity);
  });

  it('tie-break: equal ratios, larger dominant volume wins', () => {
    // Both diagonals missing → both ratios Infinity → equal
    // buy dominant = 7 vs sell dominant = 5 → buy wins
    const levels: FootprintLevel[] = [
      { price: 100, sell: 5, buy: 7 },
    ];
    const results = calculateDiagonalImbalances(levels, 1);
    expect(results[0].side).toBe('buy');

    // sell dominant larger → sell wins
    const levels2: FootprintLevel[] = [
      { price: 100, sell: 7, buy: 5 },
    ];
    const results2 = calculateDiagonalImbalances(levels2, 1);
    expect(results2[0].side).toBe('sell');
  });

  it('tie-break: equal ratios and equal dominant volumes defaults to "buy"', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 5, buy: 5 },
    ];
    const results = calculateDiagonalImbalances(levels, 1);
    expect(results[0].side).toBe('buy');
  });

  it('empty input returns []', () => {
    const results = calculateDiagonalImbalances([], 1);
    expect(results).toEqual([]);
  });

  it('binSize <= 0 never throws (all-"none" results)', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 10, buy: 0 },
    ];
    const zeroResult = calculateDiagonalImbalances(levels, 0);
    expect(zeroResult[0].side).toBe('none');
    expect(zeroResult[0].ratio).toBe(0);

    const negResult = calculateDiagonalImbalances(levels, -1);
    expect(negResult[0].side).toBe('none');
    expect(negResult[0].ratio).toBe(0);
  });

  it('opts overrides ratio and minVolume', () => {
    // With ratio=2, buy=2 / sell=1 = 2 ≥ 2 → qualifies
    const levels: FootprintLevel[] = [
      { price: 100, sell: 1, buy: 0 },
      { price: 101, sell: 0, buy: 2 },
    ];
    const results = calculateDiagonalImbalances(levels, 1, { ratio: 2 });
    expect(results[1].side).toBe('buy');
    expect(results[1].ratio).toBe(2);

    // With minVolume=5, dominant=3 should not qualify
    const levels2: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 3 },
    ];
    const results2 = calculateDiagonalImbalances(levels2, 1, { minVolume: 5 });
    expect(results2[0].side).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// calculateStackedImbalances
// ---------------------------------------------------------------------------

describe('calculateStackedImbalances – minimum & maximality', () => {
  it('three consecutive-bin same-side buy results yield exactly one StackedImbalanceRun', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
      { price: 102, sell: 0, buy: 5 },
    ];
    const diag = calculateDiagonalImbalances(levels, 1);
    const runs = calculateStackedImbalances(diag, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0].side).toBe('buy');
  });

  it('two consecutive buy results yield []', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
    ];
    const diag = calculateDiagonalImbalances(levels, 1);
    const runs = calculateStackedImbalances(diag, 1);
    expect(runs).toEqual([]);
  });

  it('five consecutive buy results yield ONE maximal run with endIndex - startIndex === 4', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
      { price: 102, sell: 0, buy: 5 },
      { price: 103, sell: 0, buy: 5 },
      { price: 104, sell: 0, buy: 5 },
    ];
    const diag = calculateDiagonalImbalances(levels, 1);
    const runs = calculateStackedImbalances(diag, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0].endIndex - runs[0].startIndex).toBe(4);
  });
});

describe('calculateStackedImbalances – breaking rules', () => {
  it('mixed sides break runs', () => {
    // buy,buy,none,buy,buy,buy on consecutive bins → one run of final 3 buys
    // (adjacent buy/sell is impossible with 3x ratio; 'none' correctly breaks runs)
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
      { price: 102, sell: 1, buy: 0 },  // sell=1 < 3*buy(103)=15 → none
      { price: 103, sell: 0, buy: 5 },
      { price: 104, sell: 0, buy: 5 },
      { price: 105, sell: 0, buy: 5 },
    ];
    const diag = calculateDiagonalImbalances(levels, 1);
    const runs = calculateStackedImbalances(diag, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0].side).toBe('buy');
    expect(runs[0].fromPrice).toBe(103);
    expect(runs[0].toPrice).toBe(105);
  });

  it('a bin gap breaks runs', () => {
    const diag = calculateDiagonalImbalances([
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
      { price: 103, sell: 0, buy: 5 },
    ], 1);
    // Bin 102 (price 102) is absent → buys at bins 100,101 run of 2 < 3
    const runs = calculateStackedImbalances(diag, 1);
    expect(runs).toEqual([]);
  });

  it('"none" entries break runs', () => {
    // buy, buy, none, buy, buy, buy → one run of final 3 buys
    // To get a 'none', we need a level where neither buy nor sell qualifies
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
      { price: 102, sell: 1, buy: 0 }, // buy=0 < minVol, sell=1 < 3*buy(103)=15 → none
      { price: 103, sell: 0, buy: 5 },
      { price: 104, sell: 0, buy: 5 },
      { price: 105, sell: 0, buy: 5 },
    ];
    const diag = calculateDiagonalImbalances(levels, 1);
    const runs = calculateStackedImbalances(diag, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0].side).toBe('buy');
    expect(runs[0].fromPrice).toBe(103);
  });

  it('minRun override 2 is honored', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 5 },
    ];
    const diag = calculateDiagonalImbalances(levels, 1);
    const runs = calculateStackedImbalances(diag, 1, 2);
    expect(runs).toHaveLength(1);
    expect(runs[0].side).toBe('buy');
  });

  it('empty input yields []', () => {
    const runs = calculateStackedImbalances([], 1);
    expect(runs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ratio semantics
// ---------------------------------------------------------------------------

describe('ratio semantics', () => {
  it('side==="none" entries report ratio 0', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 0 },
      { price: 101, sell: 0, buy: 0 },
    ];
    const results = calculateDiagonalImbalances(levels, 1);
    expect(results[0].side).toBe('none');
    expect(results[0].ratio).toBe(0);
    expect(results[1].side).toBe('none');
    expect(results[1].ratio).toBe(0);
  });

  it('side entries with zero/absent neighbor report ratio Infinity', () => {
    const levels: FootprintLevel[] = [
      { price: 100, sell: 0, buy: 5 },
      { price: 101, sell: 0, buy: 2 },
    ];
    // At 100, buy=5, sell diag at bin -1 missing → buy, ratio=Infinity
    // At 101, buy=2, sell diag at bin 0 = 0 → buy, ratio=Infinity
    const results = calculateDiagonalImbalances(levels, 1);
    expect(results[0].ratio).toBe(Infinity);
    expect(results[1].ratio).toBe(Infinity);
  });
});