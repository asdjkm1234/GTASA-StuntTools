import { decodeOsm, decodeOsmTextures, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * Dump one converted model's `.osm` from a built pak: sections, DESC fixture (parts, submeshes with their
 * texture-array refs), and — for world-sourced models — whether the manifest still has those arrays.
 * Run: `npx tsx scripts/debug/dump-osm.ts <modelName> [--pak build/original/opensa]`.
 */
import { existsSync, readFileSync } from 'node:fs';

interface Fixture {
  parts: { name: string }[];
  submeshes: { array?: number; indexCount: number; part: number; translucent?: boolean; uvAnim?: number }[];
  textureSource?: 'world';
  uvAnimations?: { duration: number; keyframes: { time: number; uv: number[] }[]; name: string }[];
  vertexCount: number;
}

/**
 * One animation as a line: distinct UV-X offsets (a film strip's frame count) and the smallest positive
 * step between keyframe times (its cadence) — both READ off the keyframes, so a scrolling sign describes
 * itself just as honestly as the ferris wheel's 13-frame strip does.
 */
function describeUvAnim(animation: NonNullable<Fixture['uvAnimations']>[number]): string {
  const offsets = new Set(animation.keyframes.map((keyframe) => keyframe.uv[4].toFixed(5)));
  let cadence = Infinity;
  for (let at = 1; at < animation.keyframes.length; at += 1) {
    const step = animation.keyframes[at].time - animation.keyframes[at - 1].time;
    if (step > 0) {
      cadence = Math.min(cadence, step);
    }
  }

  return (
    `${animation.name} (${animation.keyframes.length} keyframes, ${offsets.size} distinct u-offsets` +
    `${cadence === Infinity ? '' : ` × ${cadence.toFixed(3)} s`}, loop ${animation.duration.toFixed(2)} s)`
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const pakFlag = args.indexOf('--pak');
  const pak = pakFlag === -1 ? 'build/original/opensa' : args[pakFlag + 1];
  const model = args
    .find((arg, index) => !arg.startsWith('--') && (pakFlag === -1 || index !== pakFlag + 1))
    ?.toLowerCase();
  if (!model) {
    console.error('usage: npx tsx scripts/debug/dump-osm.ts <modelName> [--pak build/original/opensa]');
    process.exit(1);
  }

  const archive = openArchive(new Uint8Array(readFileSync(`${pak}/models/gta3.img`)));
  const osm = archive.get(`${model}.osm`);
  if (!osm) {
    console.error(`${model}.osm is not in ${pak}/models/gta3.img`);
    process.exit(1);
  }

  const sections = decodeOsm(new Uint8Array(osm));
  const names = new Map(Object.entries(OsmSectionTag).map(([name, tag]) => [tag, name]));
  for (const [tag, bytes] of sections.sections) {
    console.log(`section ${names.get(tag) ?? tag}: ${bytes.byteLength} bytes`);
  }

  const desc = osmSection(sections, OsmSectionTag.DESC);
  if (!desc) {
    console.error('no DESC section');
    process.exit(1);
  }
  const fixture = JSON.parse(new TextDecoder().decode(desc)) as Fixture;
  console.log(`\ntextureSource: ${fixture.textureSource ?? '(own TEXS)'} · ${fixture.vertexCount} vertices`);
  console.log(`parts: ${fixture.parts.map((part) => part.name).join(', ')}`);
  for (const animation of fixture.uvAnimations ?? []) {
    console.log(`uvAnimation: ${describeUvAnim(animation)}`);
  }
  for (const submesh of fixture.submeshes) {
    console.log(
      `submesh part=${fixture.parts[submesh.part]?.name ?? submesh.part} array=${submesh.array ?? 0} ` +
        `indices=${submesh.indexCount} translucent=${submesh.translucent ?? false}` +
        (submesh.uvAnim === undefined
          ? ''
          : ` uvAnim=${submesh.uvAnim} (${fixture.uvAnimations?.[submesh.uvAnim]?.name ?? 'MISSING'})`),
    );
  }

  const texs = osmSection(sections, OsmSectionTag.TEXS);
  if (texs) {
    console.log(`\nown TEXS: ${decodeOsmTextures(texs).arrays.length} arrays`);
  }
  if (fixture.textureSource === 'world') {
    // Plan 086 phase 8: the pak manifest lives in the game dir's pak/; older builds nested/sibling it.
    const manifestPath =
      [`${pak}/pak/manifest.json`, `${pak}-pack/manifest.json`, `${pak}/opensa/manifest.json`].find((path) =>
        existsSync(path),
      ) ?? `${pak}/pak/manifest.json`;
    // `textures` is a RECORD keyed `array-<n>`, not a list — reading it as one reported every world model's
    // arrays as MISSING FROM MANIFEST while the game rendered them fine (found 2026-08-07, plan 099/01).
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      textures: Record<string, { format?: number; height?: number; layers?: number; width?: number }>;
    };
    const arrays = manifest.textures ?? {};
    console.log(`\nmanifest has ${Object.keys(arrays).length} world arrays; the model's refs:`);
    for (const array of new Set(fixture.submeshes.map((submesh) => submesh.array ?? 0))) {
      const info = arrays[`array-${array}`];
      const shown = info && { format: info.format, layers: info.layers, size: `${info.width}x${info.height}` };
      console.log(`array ${array}: ${shown ? JSON.stringify(shown) : 'MISSING FROM MANIFEST'}`);
    }
  }
}

main();
