/**
 * Consecutive blocks → { sample, input, output }[].
 * @param {{ id: string; text: string }[]} items
 * @returns {{ sample: number; input: string; output: string }[]}
 */
export function pairSamples(items) {
  /** @type { { sample: number; input: string; output: string }[] } */
  const pairs = [];
  for (let i = 0; i + 1 < items.length; i += 2) {
    pairs.push({
      sample: pairs.length + 1,
      input: items[i].text,
      output: items[i + 1].text,
    });
  }
  return pairs;
}
