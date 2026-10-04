/**
 * Visualise the project architecture as a Mermaid flowchart, derived from the **actual** workspace packages and
 * their `@opensa/*` (plus Rapier) imports — so the picture can't drift from the code.
 *
 *   tsx scripts/arch-graph.ts                 # print the Mermaid graph to stdout
 *   tsx scripts/arch-graph.ts --out docs/architecture.generated.md
 *   tsx scripts/arch-graph.ts --no-externals  # internal packages only (drop Rapier)
 *   tsx scripts/arch-graph.ts --include-tests  # also follow imports in *.test.ts
 *   tsx scripts/arch-graph.ts --svg docs/architecture/assets/packages.svg   # render the graph to an SVG
 *   tsx scripts/arch-graph.ts --render docs/architecture   # render every named ```mermaid block in the dir's
 *                                                          # *.md files to <dir>/assets/<name>.svg
 *
 * Paste the output into a ```mermaid block (GitHub renders it) or https://mermaid.live.
 *
 * `--render` picks up only blocks whose FIRST line is a `%%| <file-name>` directive, e.g.
 *   ```mermaid
 *   %%| loader-flow
 *   flowchart LR
 *   ```
 * so each committed image has an explicit, rename-stable name. `npm run arch:render` refreshes them all.
 */
import { type Dirent, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { type MermaidDiagram, renderMermaidSvgs } from './lib/mermaid-render';
import { type Layer, layerOf } from './lib/package-layer';

const ROOT = process.cwd();

interface Pkg {
  /** Mermaid-safe node id (e.g. `lod_generator`). */
  id: string;
  label: string;
  layer: Layer;
  name: string;
  srcDir: string;
}

function loadPackages(): Map<string, Pkg> {
  const byName = new Map<string, Pkg>();
  for (const dir of workspaceDirs()) {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as {
      description?: string;
      name: string;
      nx?: { tags?: readonly string[] };
    };
    const desc = shortDesc(manifest.description ?? '');
    byName.set(manifest.name, {
      id: manifest.name.replace('@opensa/', '').replace(/[^a-z0-9]/gi, '_'),
      label: desc ? `${manifest.name.replace('@opensa/', '')} · ${desc}` : manifest.name.replace('@opensa/', ''),
      layer: layerOf(dir, manifest.nx?.tags ?? []),
      name: manifest.name,
      srcDir: join(ROOT, dir, 'src'),
    });
  }

  return byName;
}

/** A short, diagram-friendly label from the package.json description (the bit that lists what it does). */
function shortDesc(description: string): string {
  const afterColon = description.includes(':') ? description.slice(description.indexOf(':') + 1) : description;
  const clause = afterColon
    .split(/[(;.]|\s—\s/)[0]
    .trim()
    .replace(/\s+/g, ' ');

  return clause.length > 56 ? `${clause.slice(0, 53)}…` : clause;
}

/** Workspace globs are flat (`packages/x`, not `packages/*`), so each entry is a concrete dir. */
function workspaceDirs(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { workspaces?: string[] };

  return (pkg.workspaces ?? []).filter((w) => !w.includes('*'));
}

const SKIP_DIRS = new Set(['.nx', 'build', 'coverage', 'dist', 'node_modules', 'out']);
/** Quoted module specifiers we map to a graph node: `@opensa/*`, `@dimforge/rapier3d…`. */
const TARGET_RE = /['"](@opensa\/[^'"]+|@dimforge\/rapier3d[^'"]*)['"]/g;

/** Every interesting module specifier imported under a package's `src/` (optionally including test files). */
function importsOf(srcDir: string, includeTests: boolean): Set<string> {
  const specifiers = new Set<string>();
  for (const file of walkFiles(srcDir)) {
    if (!/\.tsx?$/.test(file) || (!includeTests && /\.(?:test|spec)\.tsx?$/.test(file))) {
      continue;
    }
    for (const match of readFileSync(file, 'utf8').matchAll(TARGET_RE)) {
      specifiers.add(match[1]);
    }
  }

  return specifiers;
}

/** Map a module specifier to the node it depends on: an internal package, an external lib, or null. */
function resolveTarget(specifier: string, packages: Map<string, Pkg>, externals: boolean): null | string {
  const opensa = /^(@opensa\/[^/]+)/.exec(specifier)?.[1];
  if (opensa) {
    return packages.has(opensa) ? packages.get(opensa)!.id : null;
  }
  if (!externals) {
    return null;
  }

  return specifier.startsWith('@dimforge/rapier3d') ? 'ext_rapier' : null;
}

/** Recursively list every file under `dir` (skipping build/dep folders); [] when the folder is absent. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }

  return out;
}

const COLORS: Record<string, string> = {
  app: 'fill:#FFE0B2,stroke:#E65100,color:#000',
  engine: 'fill:#BBDEFB,stroke:#1565C0,color:#000',
  external: 'fill:#ECEFF1,stroke:#607D8B,color:#000',
  tool: 'fill:#C8E6C9,stroke:#2E7D32,color:#000',
};

function buildMermaid(
  packages: Map<string, Pkg>,
  externals: boolean,
  includeTests: boolean,
  layers: null | readonly Layer[] = null,
): string {
  const pkgs = [...packages.values()]
    .filter((p) => layers === null || layers.includes(p.layer))
    .sort((a, b) => a.layer.localeCompare(b.layer) || a.name.localeCompare(b.name));
  const { edges, usedExternals } = collectEdges(pkgs, packages, externals, includeTests);

  const lines = ['flowchart TD', '  %% generated by scripts/arch-graph.ts — do not edit by hand'];
  const layerTitles: Record<Layer, string> = { app: 'apps', engine: 'packages', tool: 'tools' };
  for (const layer of ['app', 'engine', 'tool'] as const) {
    const members = pkgs.filter((p) => p.layer === layer);
    if (members.length === 0) {
      continue;
    }
    lines.push(`  subgraph ${layer}s["${layerTitles[layer]}"]`);
    for (const pkg of members) {
      lines.push(`    ${pkg.id}["${pkg.label}"]`);
    }
    lines.push('  end');
  }
  if (usedExternals.has('ext_rapier')) {
    lines.push('  ext_rapier["Rapier — physics"]');
  }
  lines.push('');
  for (const edge of [...edges].sort()) {
    lines.push(`  ${edge}`);
  }
  lines.push('');
  for (const [name, style] of Object.entries(COLORS)) {
    lines.push(`  classDef ${name} ${style};`);
  }
  for (const layer of ['app', 'engine', 'tool'] as const) {
    const ids = pkgs.filter((p) => p.layer === layer).map((p) => p.id);
    if (ids.length > 0) {
      lines.push(`  class ${ids.join(',')} ${layer};`);
    }
  }
  if (usedExternals.size > 0) {
    lines.push(`  class ${[...usedExternals].sort().join(',')} external;`);
  }

  return lines.join('\n');
}

function collectEdges(
  pkgs: readonly Pkg[],
  packages: Map<string, Pkg>,
  externals: boolean,
  includeTests: boolean,
): { edges: Set<string>; usedExternals: Set<string> } {
  const included = new Set(pkgs.map((p) => p.id));
  const edges = new Set<string>();
  const usedExternals = new Set<string>();
  for (const pkg of pkgs) {
    for (const specifier of importsOf(pkg.srcDir, includeTests)) {
      const target = resolveTarget(specifier, packages, externals);
      if (!target || target === pkg.id || (!target.startsWith('ext_') && !included.has(target))) {
        continue;
      }
      edges.add(`${pkg.id} --> ${target}`);
      if (target.startsWith('ext_')) {
        usedExternals.add(target);
      }
    }
  }

  return { edges, usedExternals };
}

const BLOCK_RE = /```mermaid\n%%\|\s*([a-z0-9][a-z0-9-]*)\n([\s\S]*?)```/g;

/** Every named (`%%| name`) mermaid block in the dir's markdown files (or in a single md file). */
function collectNamedBlocks(target: string): MermaidDiagram[] {
  const files = target.endsWith('.md')
    ? [join(ROOT, target)]
    : readdirSync(join(ROOT, target))
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(ROOT, target, f));
  const diagrams: MermaidDiagram[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(BLOCK_RE)) {
      const [, name, code] = match;
      if (seen.has(name)) {
        throw new Error(`duplicate diagram name "${name}" (${basename(file)})`);
      }
      seen.add(name);
      diagrams.push({ code: code.trim(), name });
    }
  }

  return diagrams;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const externals = !args.includes('--no-externals');
  const includeTests = args.includes('--include-tests');
  const argValue = (flag: string): null | string => {
    const index = args.indexOf(flag);

    return index >= 0 ? args[index + 1] : null;
  };
  const out = argValue('--out');
  const svg = argValue('--svg');
  const render = argValue('--render');
  const layers = argValue('--layers')?.split(',') as Layer[] | undefined;

  const graph = buildMermaid(loadPackages(), externals, includeTests, layers ?? null);
  if (out) {
    const body = out.endsWith('.md') ? `# Architecture\n\n\`\`\`mermaid\n${graph}\n\`\`\`\n` : `${graph}\n`;
    writeFileSync(join(ROOT, out), body, 'utf8');
    process.stdout.write(`wrote ${out}\n`);
  }
  if (svg) {
    const outDir = join(ROOT, dirname(svg));
    mkdirSync(outDir, { recursive: true });
    await renderMermaidSvgs([{ code: graph, name: basename(svg).replace(/\.svg$/, '') }], outDir);
    process.stdout.write(`wrote ${svg}\n`);
  }
  if (render) {
    const diagrams = collectNamedBlocks(render);
    const outDir = join(ROOT, render.endsWith('.md') ? dirname(render) : render, 'assets');
    mkdirSync(outDir, { recursive: true });
    const written = await renderMermaidSvgs(diagrams, outDir);
    process.stdout.write(`rendered ${written.length} diagram(s) into ${outDir}\n`);
  }
  if (!out && !svg && !render) {
    process.stdout.write(`${graph}\n`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
