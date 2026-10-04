import { decodeScript } from '@opensa/cleo';
/**
 * The referee test (plan cleo-sdk/002): the decoded operand union is lossless, so re-assembling a
 * decoded corpus script must reproduce its code region EXACTLY. Any mismatch is an encoding fact
 * the writer got wrong — fix the writer, never special-case the test. Skip-gated like every corpus
 * suite (`npm run test:fixtures` stages the real scripts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { irFromDecoded } from '../ir';
import { assembleCode } from './assemble';

const CORPUS = 'fixtures/original/cleo';

describe.skipIf(!existsSync(CORPUS))('corpus re-encode', () => {
  describe('positive cases', () => {
    const names = existsSync(CORPUS) ? readdirSync(CORPUS).filter((name) => name.endsWith('.cs')) : [];

    it('has the corpus staged', () => {
      expect(names.length).toBeGreaterThan(0);
    });

    for (const name of names) {
      it(`re-encodes ${name} byte-identically over its code region`, () => {
        const bytes = new Uint8Array(readFileSync(`${CORPUS}/${name}`));
        const decoded = decodeScript(bytes);
        const reencoded = assembleCode(irFromDecoded(decoded.instructions));
        expect(reencoded.length).toBe(decoded.codeEnd);
        expect(Buffer.from(reencoded).equals(Buffer.from(bytes.subarray(0, decoded.codeEnd)))).toBe(true);
      });
    }
  });
});
