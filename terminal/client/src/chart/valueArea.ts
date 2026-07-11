export const VALUE_AREA_PCT = 0.70;

export interface ValueAreaLevel {
  price: number;
  total: number;
}

export interface ValueAreaResult {
  vah: number;
  val: number;
  poc: number;
}

export function calculateValueArea(
  levels: ValueAreaLevel[] | null | undefined,
  pocPrice: number | null | undefined,
): ValueAreaResult | null {
  if (!levels || levels.length === 0) {
    return null;
  }
  if (pocPrice == null) {
    return null;
  }

  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const totalVolume = sorted.reduce((sum, l) => sum + l.total, 0);
  const targetVolume = totalVolume * VALUE_AREA_PCT;

  const pocIndex = sorted.findIndex((l) => l.price === pocPrice);
  if (pocIndex === -1) {
    return null;
  }

  if (sorted.length === 1) {
    return { vah: pocPrice, val: pocPrice, poc: pocPrice };
  }

  let accumulated = sorted[pocIndex].total;
  let valIndex = pocIndex;
  let vahIndex = pocIndex;

  let leftIdx = pocIndex - 1;
  let rightIdx = pocIndex + 1;

  while (accumulated < targetVolume && (leftIdx >= 0 || rightIdx < sorted.length)) {
    const leftCandidate = leftIdx >= 0
      ? { price: sorted[leftIdx].price, total: sorted[leftIdx].total }
      : null;
    const rightCandidate = rightIdx < sorted.length
      ? { price: sorted[rightIdx].price, total: sorted[rightIdx].total }
      : null;

    let chosenSide: 'left' | 'right';

    if (leftCandidate && rightCandidate) {
      if (leftCandidate.total > rightCandidate.total) {
        chosenSide = 'left';
      } else if (rightCandidate.total > leftCandidate.total) {
        chosenSide = 'right';
      } else {
        chosenSide = 'right';
      }
    } else if (leftCandidate) {
      chosenSide = 'left';
    } else {
      chosenSide = 'right';
    }

    if (chosenSide === 'left') {
      accumulated += sorted[leftIdx].total;
      valIndex = leftIdx;
      leftIdx--;
    } else {
      accumulated += sorted[rightIdx].total;
      vahIndex = rightIdx;
      rightIdx++;
    }
  }

  return {
    vah: sorted[vahIndex].price,
    val: sorted[valIndex].price,
    poc: pocPrice,
  };
}