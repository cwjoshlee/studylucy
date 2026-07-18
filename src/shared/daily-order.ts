function nextSeed(seed: number): number {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  let state = seed || 1;

  for (let index = items.length - 1; index > 0; index -= 1) {
    state = nextSeed(state);
    const swapIndex = state % (index + 1);
    const current = items[index];
    const replacement = items[swapIndex];
    if (current !== undefined && replacement !== undefined) {
      items[index] = replacement;
      items[swapIndex] = current;
    }
  }

  return items;
}

export function getDailyItems<T extends { id: string }>(
  items: readonly T[],
  date: string
): T[] {
  return seededShuffle([...items], hashSeed(date));
}
