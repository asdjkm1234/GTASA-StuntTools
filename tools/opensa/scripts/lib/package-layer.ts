/**
 * Which layer a workspace package belongs to, for the architecture graph.
 *
 * `nx.tags` is the AUTHORITY — it is what `@nx/enforce-module-boundaries` reads, so it is what the picture
 * has to draw. The folder rule is only the fallback for a package that declares no tag. Where the two
 * disagree the folder is the wrong answer and the wrongness is silent: `packages/validation` is a
 * `type:tool` that reads `node:fs`, and by folder alone the runtime graph drew it inside the browser
 * runtime; `apps/cutscene-converter` is an Electron app, and by folder alone it landed there too.
 */
export type Layer = 'app' | 'engine' | 'tool';

const TAG_LAYERS: Record<string, Layer> = { 'type:app': 'app', 'type:engine': 'engine', 'type:tool': 'tool' };

const TOOL_DIRS = ['tools/', 'tools-debug/', 'asi/', 'cleo/'];

export function layerOf(dir: string, tags: readonly string[]): Layer {
  for (const tag of tags) {
    if (tag in TAG_LAYERS) {
      return TAG_LAYERS[tag];
    }
  }

  if (dir.startsWith('apps/')) {
    return 'app';
  }

  return TOOL_DIRS.some((prefix) => dir.startsWith(prefix)) ? 'tool' : 'engine';
}
