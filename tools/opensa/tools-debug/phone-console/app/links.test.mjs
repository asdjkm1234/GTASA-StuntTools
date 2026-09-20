import { describe, expect, it } from 'vitest';

import { consoleUrls, LINK_NAMES, portsFor } from './links.mjs';

/** What the panel's `/api/state` hands over, in the shape both readers take it in. */
const SERVED = {
  district: 'los-santos-centre',
  out: './build/phone',
  ports: { app: 5173, static: 3001 },
  webapp: true,
};

describe('the panel links', () => {
  describe('negative cases', () => {
    it('never hands out a link without agent=1 — a page that cannot be read is the whole point', () => {
      const links = consoleUrls(SERVED);

      for (const name of LINK_NAMES) {
        expect(links[name], name).toContain('agent=1');
      }
    });

    it('does not aim the app at the vite port when a prebuilt copy is what is served', () => {
      const links = consoleUrls({ ...SERVED, webapp: true });

      expect(links.field).not.toContain(':5173');
    });

    it('needs the static port even when the app is served from vite — the pak comes from it', () => {
      expect(portsFor({ ...SERVED, webapp: false })).toEqual([3001, 5173]);
    });

    it('encodes a district so a name with a space or an & cannot cut the query short', () => {
      const links = consoleUrls({ ...SERVED, district: 'los santos & centre' });

      expect(links.map).toContain('district=los%20santos%20%26%20centre&agent=1');
    });
  });

  describe('positive cases', () => {
    it('builds the field run at the count 201 declared', () => {
      expect(consoleUrls(SERVED).field).toBe(
        'http://localhost:3001/build/webapp/dispatch.html?src=http://localhost:3001/build/phone' +
          '&district=los-santos-centre&agent=1&units=150&calls=40&inventory=1',
      );
    });

    it('strips the leading ./ an operator types into the output field', () => {
      expect(consoleUrls({ ...SERVED, out: './build/phone-map3d' }).map).toContain('/build/phone-map3d&');
    });

    it('serves the share artifact out of the repo rather than out of the app', () => {
      expect(consoleUrls(SERVED).share).toContain('/dist-share/dispatch.html?');
    });

    it('asks only for the static port when the app is served beside the pak', () => {
      expect(portsFor(SERVED)).toEqual([3001]);
    });
  });
});

describe('the engine link (201/2)', () => {
  describe('negative cases', () => {
    it('does not let the field run carry the overlay switch — it is the half that DRAWS the symbology', () => {
      expect(consoleUrls(SERVED).field).not.toContain('overlay=0');
    });
  });

  describe('positive cases', () => {
    it('is the field run with the overlay off and nothing else changed', () => {
      const links = consoleUrls(SERVED);

      // The pair only measures the overlay if that is the ONLY difference between its halves.
      expect(links.engine).toBe(`${links.field}&overlay=0`);
    });
  });
});
