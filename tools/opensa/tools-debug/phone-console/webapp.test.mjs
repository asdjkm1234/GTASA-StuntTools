import { describe, expect, it } from 'vitest';

import { htmlFingerprint, htmlNames, listTarFiles } from './webapp.mjs';

/** One tar record: a 512-byte header (with a real checksum) plus the body padded to 512. */
function record(name, body, type = '0') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'latin1');
  header.write('0000644\0', 100, 'latin1');
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  header.write('        ', 148, 'latin1');
  header.write(type, 156, 'latin1');
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);

  return Buffer.concat([header, padded]);
}

function tar(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

const APP = tar([
  record('./', Buffer.alloc(0), '5'),
  record('./index.html', Buffer.from('<script src="./assets/main-AAA.js">')),
  record('./dispatch.html', Buffer.from('<script src="./assets/dispatch-AAA.js">')),
  record('./assets/dispatch-AAA.js', Buffer.from('console.log(1)')),
]);

describe('phone console webapp', () => {
  describe('negative cases', () => {
    it('reads nothing out of an empty buffer', () => {
      expect(listTarFiles(Buffer.alloc(0))).toEqual([]);
      expect(listTarFiles(Buffer.alloc(1024))).toEqual([]);
    });

    it('skips the directory entries', () => {
      expect(listTarFiles(APP).map((file) => file.name)).toEqual([
        'index.html',
        'dispatch.html',
        'assets/dispatch-AAA.js',
      ]);
    });

    it('does not move the fingerprint when a chunk changes but the pages do not', () => {
      // The pages NAME the content-hashed chunks, so a real rebuild changes them; a chunk edited in place
      // without them is not a build this check can or should distinguish.
      const other = tar([
        record('./index.html', Buffer.from('<script src="./assets/main-AAA.js">')),
        record('./dispatch.html', Buffer.from('<script src="./assets/dispatch-AAA.js">')),
        record('./assets/dispatch-AAA.js', Buffer.from('console.log(2)')),
      ]);

      expect(htmlFingerprint(listTarFiles(other))).toBe(htmlFingerprint(listTarFiles(APP)));
    });
  });

  describe('positive cases', () => {
    it('notices a page that names a different chunk — which is what a rebuild produces', () => {
      const rebuilt = tar([
        record('./index.html', Buffer.from('<script src="./assets/main-AAA.js">')),
        record('./dispatch.html', Buffer.from('<script src="./assets/dispatch-BBB.js">')),
      ]);

      expect(htmlFingerprint(listTarFiles(rebuilt))).not.toBe(htmlFingerprint(listTarFiles(APP)));
    });

    it('compares the same build across a tar and a directory read', () => {
      // The two sides are built by different code — one walks the archive, one reads files off disk — so
      // the fingerprint must not depend on order or on the `./` a tar writes.
      const fromDisk = [
        { body: Buffer.from('<script src="./assets/dispatch-AAA.js">'), name: 'dispatch.html' },
        { body: Buffer.from('<script src="./assets/main-AAA.js">'), name: 'index.html' },
      ];

      expect(htmlFingerprint(fromDisk)).toBe(htmlFingerprint(listTarFiles(APP)));
    });

    it('names the pages the served side has to be read by', () => {
      expect(htmlNames(listTarFiles(APP))).toEqual(['index.html', 'dispatch.html']);
    });
  });
});
