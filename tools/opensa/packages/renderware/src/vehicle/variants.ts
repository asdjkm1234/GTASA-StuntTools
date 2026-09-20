/**
 * VehFuncs "recursive extras" — the `f_extras` / `f_class` frame convention 59 of the 213 mod cars in the
 * original fleet ship (census 2026-08-17; 32 carry classes). The plugin picks per SPAWN, at random, from a
 * tree of selectors: every node selects some of its children (`:N` exactly N, `:0` none-or-one, `:0+`
 * any number, `:N+` at least N, a bare name one), a `f_class` container's chosen children become the
 * spawn's class TAGS, and an option written `name[a,b]` is only eligible when one of those tags was chosen.
 * Without the plugin SA draws every variant at once — the jumble our runtime showed until this file.
 *
 * Two halves, one tree: {@link variantTree} is the BUILDER's (the frames → the tree that ships in the
 * `.osm` DESC, plus which option each mesh frame belongs to) and {@link pickVariants} is the RUNTIME's
 * (one walk per spawn, `random` injected so a test can pin it). The wheel container's own chosen path is
 * separate and deterministic — see `chosenContainerWheel` in the builder.
 *
 * NOT honoured yet, carried verbatim so no rebake is needed when it is: the `?condition` on a node (city,
 * weather, hour — treated as always true, `docs/hacks/vehfuncs-conditions-always-true.md`) and the
 * `!characteristics` subtree (paint jobs / colours a class implies — skipped).
 */
import type { RWClump } from '../parsers/binary/types';
import type { VehicleVariantNode, VehicleVariants } from './types';

const CLASS_CONTAINER_RE = /^f_class/;
const EXTRAS_CONTAINER_RE = /^f_extras/;
/** Damage twins and LOD meshes ride their `_ok` twin — never an option of their own. */
const RIDER_RE = /_(?:dam|vlo)$/;

export interface VariantTree {
  /** Frame index → the option id its meshes belong to. Frames on a container ROOT are not in here: the
   *  root is always shown ("it can be empty"). */
  optionOfFrame: ReadonlyMap<number, string>;
  variants: null | VehicleVariants;
}

/**
 * `vegas[wbc]:1` → name `vegas`, requires `[wbc]`, select `[1, 1]`; `rural?c0?c4` → name `rural`, condition
 * `c0?c4`; `int:0` → `[0, 1]`; `trunkbay:0+` → `[0, all]`. Order of the decorations follows the field:
 * the tag bracket sits before the count, the condition after the bare name.
 */
export function parseName(raw: string): Pick<VehicleVariantNode, 'condition' | 'name' | 'requires' | 'select'> {
  let name = raw;
  let select: [number, number] = [1, 1];
  const count = /:(\d+)(\+?)$/.exec(name);
  if (count) {
    const n = Number(count[1]);
    select = count[2] ? [n, -1] : n === 0 ? [0, 1] : [n, n];
    name = name.slice(0, count.index);
  } else if (name.endsWith('+')) {
    select = [1, -1];
    name = name.slice(0, -1);
  }
  let requires: string[] | undefined;
  const tags = /\[([^\]]*)\]/.exec(name);
  if (tags) {
    requires = tags[1]
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    name = name.slice(0, tags.index) + name.slice(tags.index + tags[0].length);
  }
  let condition: string | undefined;
  const at = name.indexOf('?');
  if (at >= 0) {
    condition = name.slice(at + 1);
    name = name.slice(0, at);
  }

  return {
    ...(condition !== undefined ? { condition } : {}),
    name: name.trim(),
    ...(requires?.length ? { requires } : {}),
    select,
  };
}

/**
 * One spawn's choice: the set of option ids whose meshes are shown. Classes first (their chosen tags gate
 * the `[tag]` options), then every extras container; a node's children are only visited when the node
 * itself was chosen. `random` is `Math.random`-shaped — a test injects its own.
 */
export function pickVariants(variants: VehicleVariants, random: () => number = Math.random): Set<string> {
  const tags = new Set<string>();
  const chosen = new Set<string>();
  const walkClasses = (node: VehicleVariantNode): void => {
    for (const child of choose(node, node.children, random)) {
      tags.add(child.name);
      walkClasses(child);
    }
  };
  const walkExtras = (node: VehicleVariantNode): void => {
    const eligible = node.children.filter((child) => !child.requires || child.requires.some((tag) => tags.has(tag)));
    for (const child of choose(node, eligible, random)) {
      chosen.add(child.id);
      walkExtras(child);
    }
  };
  variants.classes.forEach(walkClasses);
  variants.extras.forEach(walkExtras);

  return chosen;
}

/**
 * The tree of every top-level `f_extras*` / `f_class*` container — an inner one is an ordinary option of
 * its parent, which is what "recursive" means. Frames in `excluded` (the wheel container) are not walked.
 */
export function variantTree(clump: RWClump, excluded: ReadonlySet<number> = new Set()): VariantTree {
  const children: number[][] = clump.frames.map(() => []);
  clump.frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0) {
      children[frame.parentIndex].push(index);
    }
  });
  const nameOf = (index: number): string => clump.frames[index].name.trim().toLowerCase();
  const isContainer = (index: number): boolean =>
    CLASS_CONTAINER_RE.test(nameOf(index)) || EXTRAS_CONTAINER_RE.test(nameOf(index));
  const underContainer = (index: number): boolean => {
    for (let at = clump.frames[index].parentIndex; at >= 0; at = clump.frames[at].parentIndex) {
      if (isContainer(at)) {
        return true;
      }
    }

    return false;
  };

  const optionOfFrame = new Map<number, string>();
  const optionNode = (index: number, option: string): VehicleVariantNode => {
    optionOfFrame.set(index, option);
    const decorated = parseName(nameOf(index));

    return {
      ...decorated,
      children: children[index]
        .filter((child) => !RIDER_RE.test(nameOf(child)))
        .map((child) => optionNode(child, String(child))),
      id: String(index),
    };
  };
  const classNode = (index: number): VehicleVariantNode => ({
    ...parseName(nameOf(index)),
    // A class tag's own children are its `!characteristics` (skipped) or nested `f_class` groups (AND).
    children: children[index]
      .filter((child) => CLASS_CONTAINER_RE.test(nameOf(child)))
      .map((child) => classNode(child)),
    id: String(index),
  });
  // A rider (`x_dam`, `x_vlo`) belongs to the option of its twin — the sibling `x` / `x_ok` — and failing
  // that to the option it hangs under, so a `_vlo` inside an `int:0` group hides with the clutter it LODs.
  const riderOption = (index: number): void => {
    const parent = clump.frames[index].parentIndex;
    if (parent < 0) {
      return;
    }
    const base = nameOf(index).replace(RIDER_RE, '');
    const twin = children[parent].find((sibling) => [`${base}_ok`, base].includes(nameOf(sibling)));
    const option = (twin !== undefined ? optionOfFrame.get(twin) : undefined) ?? optionOfFrame.get(parent);
    if (option !== undefined) {
      optionOfFrame.set(index, option);
    }
  };

  const classes: VehicleVariantNode[] = [];
  const extras: VehicleVariantNode[] = [];
  clump.frames.forEach((_frame, index) => {
    if (excluded.has(index) || !isContainer(index) || underContainer(index)) {
      return;
    }
    if (CLASS_CONTAINER_RE.test(nameOf(index))) {
      classes.push({
        ...parseName(nameOf(index)),
        children: children[index].map((child) => classNode(child)),
        id: String(index),
      });

      return;
    }
    // The container root itself is not an option — its meshes always show — but it selects its children.
    extras.push({
      ...parseName(nameOf(index)),
      children: children[index]
        .filter((child) => !RIDER_RE.test(nameOf(child)))
        .map((child) => optionNode(child, String(child))),
      id: String(index),
    });
  });
  clump.frames.forEach((_frame, index) => {
    if (RIDER_RE.test(nameOf(index)) && !optionOfFrame.has(index)) {
      riderOption(index);
    }
  });

  return {
    optionOfFrame,
    variants: classes.length + extras.length > 0 ? { classes, extras } : null,
  };
}

/** `select` applied to the eligible children: how many, then which — both uniform. */
function choose(
  node: VehicleVariantNode,
  eligible: readonly VehicleVariantNode[],
  random: () => number,
): VehicleVariantNode[] {
  const [min, max] = node.select;
  const upper = Math.min(max < 0 ? eligible.length : max, eligible.length);
  const lower = Math.min(min, upper);
  const count = lower + Math.floor(random() * (upper - lower + 1));
  const pool = [...eligible];
  const picked: VehicleVariantNode[] = [];
  for (let at = 0; at < count && pool.length > 0; at += 1) {
    picked.push(...pool.splice(Math.floor(random() * pool.length), 1));
  }

  return picked;
}
