/**
 * Prelit review report CLI (plan 019 Phase 2). Computes the world-context verdicts on `--game` and writes a
 * self-contained HTML review page (`--report`) with day/night before→after thumbnails per corrected model —
 * the "after" is the verdict applied in memory, so no optimizer run is needed. Rows are ordered by severity;
 * `--limit` caps how many get thumbnails (the rest are counted in the stats table). Usage:
 * `tsx map-optimizer/src/review-cli.ts --game <dir> --report <file.html> [--limit 200] [--exclude <file.json>]`.
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { PrelitVerdict } from './adapters/gta-sa/prelit-context';

import { createGtaSaAdapter } from './adapters/gta-sa';
import { encodePng } from './review/png';
import { renderVerdictThumbnails, type VerdictThumbnails } from './review/render-verdict';
import { buildReviewHtml, type ReviewEntry, verdictSeverity } from './review/report';

async function main(): Promise<void> {
  const gameArg = argValue('--game');
  const reportArg = argValue('--report');
  if (!gameArg || !reportArg) {
    throw new Error(
      'usage: tsx map-optimizer/src/review-cli.ts --game <dir> --report <file.html> [--limit 200] [--exclude <file.json>]',
    );
  }
  const limit = Number(argValue('--limit') ?? 200);
  const excludeArg = argValue('--exclude');
  const exclude = excludeArg ? (JSON.parse(readFileSync(fromCwd(excludeArg), 'utf8')) as string[]) : undefined;

  const gameDir = fromCwd(gameArg);
  const adapter = createGtaSaAdapter(basename(gameDir), gameDir);
  const { stats, verdicts, warnings } = adapter.buildPrelitContext(exclude ? { exclude } : {});
  for (const warning of warnings) {
    console.warn(`⚠ ${warning}`);
  }
  console.log(
    `verdicts ${verdicts.size} — lift ${stats.liftDay}, lower ${stats.lowerDay}, flat ${stats.flat}, ` +
      `night repair ${stats.repairNight} / synth ${stats.synthesizeNight}, excluded ${stats.excluded}`,
  );

  const bySeverity = [...verdicts.entries()].sort(([, a], [, b]) => verdictSeverity(b) - verdictSeverity(a));
  const entries: ReviewEntry[] = [];
  let failed = 0;
  for (const [name, verdict] of bySeverity.slice(0, limit)) {
    const thumbs = await renderModel(adapter, name, verdict);
    if (thumbs) {
      entries.push({
        name,
        thumbs: {
          dayAfter: toDataUri(thumbs.dayAfter)!,
          dayBefore: toDataUri(thumbs.dayBefore)!,
          nightAfter: toDataUri(thumbs.nightAfter),
          nightBefore: toDataUri(thumbs.nightBefore),
        },
        verdict,
      });
    } else {
      failed += 1;
    }
  }

  const html = buildReviewHtml(entries, {
    game: basename(gameDir),
    rendered: entries.length,
    stats,
    totalVerdicts: verdicts.size,
  });
  writeFileSync(fromCwd(reportArg), html);
  console.log(`report — ${entries.length} model(s) rendered (${failed} failed), → ${fromCwd(reportArg)}`);
}

async function renderModel(
  adapter: ReturnType<typeof createGtaSaAdapter>,
  name: string,
  verdict: PrelitVerdict,
): Promise<null | VerdictThumbnails> {
  try {
    const asset = await adapter.read({ name });

    return renderVerdictThumbnails(parseDff(toArrayBuffer(asset.source)), verdict);
  } catch {
    return null; // unparseable/missing — best-effort, like the pipeline itself
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toDataUri(image: null | { height: number; rgba: Uint8Array; width: number }): null | string {
  return image
    ? `data:image/png;base64,${Buffer.from(encodePng(image.rgba, image.width, image.height)).toString('base64')}`
    : null;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
