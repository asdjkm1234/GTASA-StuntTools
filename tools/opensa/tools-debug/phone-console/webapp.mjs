/**
 * Is the app being served the app in the repository?
 *
 * **By content, never by time.** The obvious check — compare the unpacked copy's mtime against the archive's
 * — is wrong in a way that always fails the same direction: `tar -x` restores the times recorded INSIDE the
 * archive (when the app was built, on another machine), while the archive file itself is written by `git
 * pull` (now). So the served copy is always "older" than the archive it came out of, and the check stays red
 * however many times it is fixed. Measured 2026-08-23: extracted `index.html` 22:40:27, archive 22:40:46.
 *
 * What is compared instead is every `.html` entry — the files that NAME the content-hashed chunks. Two
 * builds that differ anywhere differ in at least one of them, and comparing them needs no cooperation from
 * whoever extracted the archive.
 */
import { createHash } from 'node:crypto';

/**
 * A fingerprint of the app's HTML entry points.
 *
 * Deterministic and order-independent, so the two sides can be built by different code — one walking a tar,
 * one reading a directory — and still compare.
 */
export function htmlFingerprint(files) {
  return files
    .filter((file) => file.name.endsWith('.html'))
    .map((file) => `${file.name}:${createHash('sha256').update(file.body).digest('hex').slice(0, 16)}`)
    .sort()
    .join('\n');
}

/** The HTML names an archive carries — what the served side must be read from disk by. */
export function htmlNames(files) {
  return files.filter((file) => file.name.endsWith('.html')).map((file) => file.name);
}

/**
 * The regular files in a (gunzipped) tar.
 *
 * Enough of the format for our own archive and nothing more: 512-byte headers, `name` at 0, octal `size` at
 * 124, `typeflag` at 156, data padded to 512. Directories and metadata entries are skipped by type, and the
 * walk stops at the zero block that ends an archive.
 */
export function listTarFiles(bytes) {
  const files = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = field(header, 0, 100);
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) {
      break;
    }
    const type = String.fromCodePoint(header[156]);
    const start = offset + 512;
    if (type === '0' || header[156] === 0) {
      files.push({ body: bytes.subarray(start, start + size), name: normalise(name) });
    }
    offset = start + Math.ceil(size / 512) * 512;
  }

  return files;
}

function field(header, at, length) {
  const raw = header.subarray(at, at + length);
  const end = raw.indexOf(0);

  return Buffer.from(end === -1 ? raw : raw.subarray(0, end)).toString('latin1');
}

/** `./dispatch.html` and `dispatch.html` are the same file — tar writes the first, a directory read the second. */
function normalise(name) {
  return name.replace(/^\.\//, '');
}
