import type { PrelitContextResult, PrelitVerdict } from '../adapters/gta-sa/prelit-context';

/**
 * Self-contained HTML review page for the world-context prelight verdicts (plan 019 Phase 2). Pure string
 * builder — thumbnails arrive as `data:image/png;base64,…` URIs. Each row shows the verdict numbers and the
 * day/night before→after pairs; an "exclude" checkbox per row collects a copyable JSON list of model names to
 * feed back into `PrelitContextOptions.exclude` (the semi-auto curation loop).
 */
export interface ReviewEntry {
  name: string;
  thumbs: { dayAfter: string; dayBefore: string; nightAfter: null | string; nightBefore: null | string };
  verdict: PrelitVerdict;
}

export interface ReviewMeta {
  game: string;
  /** How many verdict models were rendered (≤ limit) vs the run's total. */
  rendered: number;
  stats: PrelitContextResult['stats'];
  totalVerdicts: number;
}

/** The verdict's review section: what kind of correction dominates it. */
export function verdictClass(verdict: PrelitVerdict): 'flat' | 'lift' | 'lower' | 'night' {
  if (verdict.flat) {
    return 'flat';
  }
  if (verdict.level) {
    return verdict.level.shift > 0 ? 'lift' : 'lower';
  }

  return 'night';
}

/** Review-ordering weight: big day moves first, then night rewrites, then flags. */
export function verdictSeverity(verdict: PrelitVerdict): number {
  let severity = verdict.level ? Math.abs(verdict.level.shift) : 0;
  if (verdict.night?.kind === 'repair') {
    severity += Math.abs(1 - verdict.night.scale) * 64;
  } else if (verdict.night?.kind === 'synthesize' || verdict.night?.kind === 'cap') {
    severity += 32;
  }

  return severity + (verdict.flat ? 16 : 0);
}

const SECTIONS: readonly { key: ReturnType<typeof verdictClass>; title: string }[] = [
  { key: 'flat', title: 'Flat (broken export — AO rebake queue)' },
  { key: 'lower', title: 'Day lowered' },
  { key: 'lift', title: 'Day lifted' },
  { key: 'night', title: 'Night only' },
];

export function buildReviewHtml(entries: readonly ReviewEntry[], meta: ReviewMeta): string {
  const sorted = [...entries].sort((a, b) => verdictSeverity(b.verdict) - verdictSeverity(a.verdict));
  const sections = SECTIONS.map(({ key, title }) => {
    const rows = sorted.filter((entry) => verdictClass(entry.verdict) === key);

    return rows.length === 0
      ? ''
      : `<details open><summary>${escapeHtml(title)} — ${rows.length}</summary>${rows.map(renderRow).join('')}</details>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>prelit review — ${escapeHtml(meta.game)}</title>
<style>
  body { background: #1c1c1e; color: #ddd; font-family: monospace; font-size: 13px; margin: 16px; }
  table.stats { border-collapse: collapse; margin: 8px 0 16px; }
  table.stats td { border: 1px solid #444; padding: 3px 10px; }
  details { margin: 10px 0; }
  summary { cursor: pointer; font-weight: bold; font-size: 14px; padding: 4px 0; }
  .row { display: flex; gap: 12px; align-items: center; border-top: 1px solid #333; padding: 8px 0; }
  .row .info { width: 320px; flex: none; }
  .row .name { font-weight: bold; color: #fff; }
  .row .verdict { color: #aaa; white-space: pre-line; }
  .pair { text-align: center; }
  .pair .label { color: #888; margin-bottom: 2px; }
  .pair img { background: #333; image-rendering: pixelated; }
  .pair .none { display: inline-block; background: #262628; color: #666; }
  .arrow { color: #666; align-self: center; }
  #exclude-box { width: 100%; height: 60px; background: #111; color: #9c9; border: 1px solid #444; }
</style>
</head>
<body>
<h2>prelit review — ${escapeHtml(meta.game)}</h2>
<table class="stats"><tr>
  <td>verdicts ${meta.totalVerdicts}</td><td>rendered ${meta.rendered}</td>
  <td>lift ${meta.stats.liftDay}</td><td>lower ${meta.stats.lowerDay}</td><td>flat ${meta.stats.flat}</td>
  <td>night repair ${meta.stats.repairNight}</td><td>night synth ${meta.stats.synthesizeNight}</td>
  <td>ok ${meta.stats.ok}</td><td>no context ${meta.stats.noContext}</td>
</tr></table>
<p>Tick <b>exclude</b> on over-corrected models; paste the list into <code>PrelitContextOptions.exclude</code>:</p>
<textarea id="exclude-box" readonly>[]</textarea>
${sections}
<script>
  const box = document.getElementById('exclude-box');
  document.body.addEventListener('change', () => {
    const names = [...document.querySelectorAll('input[data-model]:checked')].map((el) => el.dataset.model);
    box.value = JSON.stringify(names);
  });
</script>
</body>
</html>
`;
}

export function describeVerdict(verdict: PrelitVerdict): string {
  const parts: string[] = [];
  if (verdict.flat) {
    parts.push('flat (no baked AO)');
  }
  if (verdict.level) {
    parts.push(
      `day ${verdict.level.shift > 0 ? '+' : ''}${verdict.level.shift} (guard ${Math.round(verdict.level.protectFrom)}→${Math.round(verdict.level.protectTo)})`,
    );
  }
  if (verdict.night?.kind === 'repair') {
    parts.push(
      `night ×${verdict.night.scale.toFixed(2)} (guard ${Math.round(verdict.night.protectFrom)}→${Math.round(verdict.night.protectTo)})`,
    );
  } else if (verdict.night?.kind === 'cap') {
    parts.push(`night glow capped at ${Math.round(verdict.night.max)}`);
  } else if (verdict.night?.kind === 'synthesize') {
    parts.push(`night synth ratio ${verdict.night.ratio.toFixed(2)}`);
  }

  return parts.join('\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function img(src: null | string): string {
  return src ? `<img src="${src}" alt="">` : '<span class="none">no night set</span>';
}

function pair(label: string, before: null | string, after: null | string): string {
  return `<div class="pair"><div class="label">${label} before → after</div>${img(before)} <span class="arrow">→</span> ${img(after)}</div>`;
}

function renderRow(entry: ReviewEntry): string {
  const name = escapeHtml(entry.name);

  return `<div class="row">
  <div class="info">
    <div class="name">${name}</div>
    <div class="verdict">${escapeHtml(describeVerdict(entry.verdict))}</div>
    <label><input type="checkbox" data-model="${name}"> exclude</label>
  </div>
  ${pair('day', entry.thumbs.dayBefore, entry.thumbs.dayAfter)}
  ${pair('night', entry.thumbs.nightBefore, entry.thumbs.nightAfter)}
</div>`;
}
