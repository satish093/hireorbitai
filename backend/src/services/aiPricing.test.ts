import { describe, it, expect } from 'vitest';
import { estimateCostUsd, priceFor } from './aiPricing';

// Pure module — no env/db/logger import, so this needs no mocks or setup.
describe('aiPricing', () => {
  describe('priceFor', () => {
    it('resolves dated / point-release model ids to their family by longest prefix', () => {
      expect(priceFor('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5 });
      expect(priceFor('claude-sonnet-4-6')).toEqual({ input: 3, output: 15 });
      expect(priceFor('claude-opus-4-7')).toEqual({ input: 15, output: 75 });
      expect(priceFor('claude-3-5-haiku-20241022')).toEqual({ input: 0.8, output: 4 });
    });

    it('falls back to a Haiku-class price for unknown models (never under-warn)', () => {
      expect(priceFor('some-future-model')).toEqual({ input: 1, output: 5 });
    });
  });

  describe('estimateCostUsd', () => {
    it('prices Haiku 4.5 at $1/MTok in + $5/MTok out', () => {
      const cost = estimateCostUsd('claude-haiku-4-5-20251001', {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      });
      expect(cost).toBeCloseTo(6, 6); // $1 + $5
    });

    it('matches the ~1.5¢ batch-match estimate (6400 in / 1800 out, Haiku)', () => {
      const cost = estimateCostUsd('claude-haiku-4-5', {
        input_tokens: 6400,
        output_tokens: 1800,
      });
      // 6400*$1 + 1800*$5 = 15,400 / 1e6 = $0.0154
      expect(cost).toBeCloseTo(0.0154, 4);
    });

    it('counts cached-read tokens at ~10% of input price', () => {
      const cost = estimateCostUsd('claude-haiku-4-5', { cache_read_input_tokens: 1_000_000 });
      expect(cost).toBeCloseTo(0.1, 6); // 1M * ($1 * 0.1)
    });

    it('counts cache-write tokens at ~125% of input price', () => {
      const cost = estimateCostUsd('claude-haiku-4-5', { cache_creation_input_tokens: 1_000_000 });
      expect(cost).toBeCloseTo(1.25, 6);
    });

    it('treats missing / null token fields as zero', () => {
      expect(estimateCostUsd('claude-haiku-4-5', {})).toBe(0);
      expect(estimateCostUsd('claude-haiku-4-5', { input_tokens: null, output_tokens: null })).toBe(
        0,
      );
    });
  });
});
