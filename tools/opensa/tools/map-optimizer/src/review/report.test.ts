import { describe, expect, it } from 'vitest';

import type { PrelitVerdict } from '../adapters/gta-sa/prelit-context';

import { buildReviewHtml, type ReviewEntry, verdictClass, verdictSeverity } from './report';

const URI = 'data:image/png;base64,AA==';

function entry(name: string, verdict: PrelitVerdict): ReviewEntry {
  return { name, thumbs: { dayAfter: URI, dayBefore: URI, nightAfter: null, nightBefore: null }, verdict };
}

const STATS = {
  excluded: 0,
  flat: 1,
  liftDay: 1,
  lowerDay: 1,
  noContext: 0,
  ok: 0,
  repairNight: 0,
  synthesizeNight: 0,
};

describe('review report', () => {
  describe('negative cases', () => {
    it('omits sections that have no rows', () => {
      const html = buildReviewHtml([entry('a', { flat: true, level: { protectFrom: 0, protectTo: 0, shift: -5 } })], {
        game: 'g',
        rendered: 1,
        stats: STATS,
        totalVerdicts: 1,
      });

      expect(html).toContain('Flat');
      expect(html).not.toContain('Night only');
    });

    it('escapes markup in model names', () => {
      const html = buildReviewHtml([entry('<img>', { flat: true })], {
        game: 'g',
        rendered: 1,
        stats: STATS,
        totalVerdicts: 1,
      });

      expect(html).not.toContain('<img>');
      expect(html).toContain('&lt;img&gt;');
    });
  });

  describe('positive cases', () => {
    it('classes verdicts by their dominating correction', () => {
      expect(verdictClass({ flat: true })).toBe('flat');
      expect(verdictClass({ flat: false, level: { protectFrom: 0, protectTo: 0, shift: 9 } })).toBe('lift');
      expect(verdictClass({ flat: false, level: { protectFrom: 0, protectTo: 0, shift: -9 } })).toBe('lower');
      expect(verdictClass({ flat: false, night: { kind: 'synthesize', ratio: 0.3 } })).toBe('night');
    });

    it('ranks a big day move above a small night repair', () => {
      const big = verdictSeverity({ flat: false, level: { protectFrom: 0, protectTo: 0, shift: -70 } });
      const small = verdictSeverity({
        flat: false,
        night: { kind: 'repair', protectFrom: 0, protectTo: 0, scale: 0.9 },
      });

      expect(big).toBeGreaterThan(small);
    });

    it('renders rows with exclude checkboxes and the stats header', () => {
      const html = buildReviewHtml(
        [entry('clubgate01_lax', { flat: false, level: { protectFrom: 49, protectTo: 255, shift: 31 } })],
        { game: 'original', rendered: 1, stats: STATS, totalVerdicts: 6164 },
      );

      expect(html).toContain('verdicts 6164');
      expect(html).toContain('clubgate01_lax');
      expect(html).toContain('data-model="clubgate01_lax"');
      expect(html).toContain('day +31 (guard 49→255)');
    });
  });
});
