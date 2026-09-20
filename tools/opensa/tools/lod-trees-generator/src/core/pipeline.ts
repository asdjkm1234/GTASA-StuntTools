import type { HdTree, Impostor, TreeLodAdapter, TreeLodConfig } from './types';

import { applyCardAlpha, solveCardAlpha } from './card-alpha';
import { renderImpostor } from './render';

/** SA tests the impostor row's alpha at reference 100 in its sorted pass — the floor the solver works to. */
const SA_ALPHA_REFERENCE = 100 / 255;

/**
 * Generic driver: enumerate the input HD trees, bake each impostor (render → card atlas), and hand them to the
 * adapter to encode + write (LOD DFFs + shared atlas TXD + COL) into `--out`.
 */
export function run(adapter: TreeLodAdapter, config: TreeLodConfig): void {
  const inputs = adapter.listInputs();
  console.log(
    `lod-trees-generator: ${inputs.length} HD tree(s) · ${config.blendCards}/${config.cards} cards · ${config.textureSize}px`,
  );

  const primary: Impostor[] = [];
  const alternate: Impostor[] = [];
  for (const input of inputs) {
    const tree = adapter.loadTree(input);
    // Two bakes per tree: the cage the built tree carries (real SA composites it, so fewer and thinner
    // cards) and the one the OpenSA split swaps in (its weld unions them). Plan 013 step 06.
    const blend = renderImpostor(tree, { ...config, cards: config.blendCards });
    blend.cardAlpha = solveCardAlpha(tree, blend, SA_ALPHA_REFERENCE);
    applyCardAlpha(blend, blend.cardAlpha);
    primary.push(blend);
    alternate.push(renderImpostor(tree, config));
    console.log(
      `  ${tree.name}: ${tree.triangles.length} tris · bbox ${bboxSize(tree)} · ` +
        `${config.blendCards} cards at alpha ${blend.cardAlpha.toFixed(2)} / ${config.cards} cards`,
    );
  }

  adapter.finalize(primary, alternate);
}

function bboxSize(tree: HdTree): string {
  const { max, min } = tree.bbox;

  return max.map((value, axis) => (value - min[axis]).toFixed(1)).join('×');
}
