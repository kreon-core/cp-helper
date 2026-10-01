import type { Sample, SampleItem } from "../types";

/**
 * Consecutive blocks -> { sample, input, output }[].
 */
export function pairSamples(items: SampleItem[]): Sample[] {
  const pairs: Sample[] = [];
  for (let i = 0; i + 1 < items.length; i += 2) {
    pairs.push({
      sample: pairs.length + 1,
      input: items[i].text,
      output: items[i + 1].text,
    });
  }
  return pairs;
}
