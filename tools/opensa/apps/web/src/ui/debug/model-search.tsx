import type { ModelSearchHit } from '@opensa/renderware';

import { MODEL_SEARCH_LIMIT } from '@opensa/renderware';
import { type ReactElement, useMemo, useState } from 'react';

import { styles } from './debug-styles';

/**
 * Find a model by name and jump to it (plan 094, phases 4–5). Shared UI: `MapInspector` renders it for any
 * host that implements the two optional `MapGame` members, so the standalone viewer and the in-game debugger
 * show the same field.
 *
 * Enter focuses the row the field is on, and pressing it again CYCLES that name's placements (the host's
 * index owns the order) — the only way to reach the second `tree_hipoly11` of several hundred. The rows are
 * capped by {@link MODEL_SEARCH_LIMIT}; when the cap bites the panel says so rather than pretending the
 * match list ended.
 */
export function ModelSearch({
  onFocus,
  search,
}: {
  /** Centre on the next placement of this name; the string it returns (if any) is shown as the result. */
  onFocus: (name: string) => null | string;
  search: (query: string) => ModelSearchHit[];
}): ReactElement {
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<null | string>(null);
  const hits = useMemo(() => search(query), [query, search]);

  function focus(name: string): void {
    setNote(onFocus(name));
  }

  return (
    <div style={styles.group}>
      <div style={styles.groupLabel}>FIND MODEL</div>
      <input
        onChange={(event) => {
          setQuery(event.target.value);
          setNote(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && hits[0]) {
            focus(hits[0].name);
          }
        }}
        placeholder="model name…"
        style={styles.filterInput}
        type="text"
        value={query}
      />
      {hits.map((hit) => (
        <button key={hit.name} onClick={() => focus(hit.name)} style={styles.actionButton} type="button">
          {hit.name} · {hit.count}
        </button>
      ))}
      {hits.length === MODEL_SEARCH_LIMIT && <div style={styles.hint}>first {MODEL_SEARCH_LIMIT} matches — refine</div>}
      {query.trim() !== '' && hits.length === 0 && <div style={styles.hint}>no placed model matches</div>}
      {note !== null && <div style={styles.info}>{note}</div>}
    </div>
  );
}
