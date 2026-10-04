/**
 * Finding a model on the map by NAME (plan 094, decision 5) — the pure half, shared by both hosts: the
 * standalone viewer's `ViewerMapGame` and (phase 5) the in-game debugger's map screen.
 *
 * The index is built over PLACED instances, not over the whole IDE catalog. A catalog name with no instance
 * cannot be centred on, and offering it would make the autocomplete answer with rows that do nothing. Names
 * are matched case-insensitively (IDE and IPL disagree on case all over the stock map), and the resolved
 * display name is the catalog's spelling.
 *
 * A name is placed many times (`tree_hipoly11` alone is placed in the hundreds), so focusing CYCLES: the
 * first focus orders that name's placements by distance from where the camera stands and takes the nearest,
 * every further focus of the same name steps one outwards. The order is frozen at the first focus on
 * purpose — re-sorting after each jump would rank the placement you just flew to as nearest and never move
 * again.
 */
import type { MapDefinitions } from '../parsers/text';

/** One autocomplete row: a model name and how many times the map places it. */
export interface ModelSearchHit {
  count: number;
  name: string;
}

/**
 * Most rows an autocomplete returns. The stock map places ~13 000 distinct names; a UI that renders all
 * matches of `a` renders a page nobody can read. The caller is expected to say the list was cut.
 */
export const MODEL_SEARCH_LIMIT = 20;

export class ModelIndex {
  private cursor = 0;
  /** The focused name's placements, ordered by distance from the camera at the FIRST focus. */
  private order: readonly (readonly [number, number, number])[] = [];
  private ordered: null | string = null;
  private readonly placements = new Map<string, (readonly [number, number, number])[]>();
  /** Lowercased name → the catalog's spelling, so a hit reports the name as the IDE writes it. */
  private readonly spelling = new Map<string, string>();

  constructor(defs: MapDefinitions) {
    for (const instance of defs.instances) {
      const def = defs.catalog.get(instance.id) ?? defs.timedCatalog?.get(instance.id);
      const name = def?.modelName ?? instance.modelName;
      const key = name.toLowerCase();
      let list = this.placements.get(key);
      if (!list) {
        list = [];
        this.placements.set(key, list);
        this.spelling.set(key, name);
      }
      list.push(instance.position);
    }
  }

  /**
   * The next placement of `name` to centre on, in GTA coords, or `null` for an unplaced name. `from` is the
   * camera's ground position; it only decides the ORDER, and only on the first focus of that name.
   */
  focusNext(name: string, from: readonly [number, number]): null | readonly [number, number, number] {
    const key = name.toLowerCase();
    const list = this.placements.get(key);
    if (!list || list.length === 0) {
      return null;
    }
    if (this.ordered === key) {
      this.cursor = (this.cursor + 1) % this.order.length;
    } else {
      this.ordered = key;
      this.cursor = 0;
      this.order = [...list].sort((a, b) => distance2(a, from) - distance2(b, from));
    }

    return this.order[this.cursor] ?? null;
  }

  /**
   * Case-insensitive substring match, prefix matches first then alphabetical — with tens of thousands of
   * names a plain scan costs under a millisecond, so there is no index structure to keep in sync. An empty
   * query answers nothing (the panel shows the field, not the whole map).
   */
  search(query: string, limit = MODEL_SEARCH_LIMIT): ModelSearchHit[] {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
      return [];
    }
    const matches: string[] = [];
    for (const key of this.placements.keys()) {
      if (key.includes(needle)) {
        matches.push(key);
      }
    }
    matches.sort((a, b) => {
      const byPrefix = Number(b.startsWith(needle)) - Number(a.startsWith(needle));

      return byPrefix === 0 ? a.localeCompare(b) : byPrefix;
    });

    return matches.slice(0, limit).map((key) => ({
      count: this.placements.get(key)?.length ?? 0,
      name: this.spelling.get(key) ?? key,
    }));
  }
}

/** Squared 2D distance — the camera focus is a ground point, and the ordering never needs the root. */
function distance2(position: readonly [number, number, number], from: readonly [number, number]): number {
  const dx = position[0] - from[0];
  const dy = position[1] - from[1];

  return dx * dx + dy * dy;
}
