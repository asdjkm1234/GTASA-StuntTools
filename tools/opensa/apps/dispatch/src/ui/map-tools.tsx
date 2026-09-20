/**
 * The operator's way around the map (201/7-03): search a place, fit the whole board, ride a unit, and keep
 * the views they come back to all shift.
 *
 * Everything here is a thin skin over the map handle — the camera owns the movement, this owns the words.
 * It never re-renders the map: the handle is called imperatively, exactly like the locate buttons in the
 * panels, and what comes back the other way (`following`) arrives through the readout the loop already
 * pushes four times a second.
 */
import { type ReactElement, useState } from 'react';

import type { MapTool, Measurement } from '../map/sketch';
import type { Selection } from '../ops/types';
import type { DispatchHandle } from '../world/boot';
import type { SearchedPlace } from '../world/zones';

import { type Bookmark, readBookmarks, removeBookmark, saveBookmark } from '../map/bookmarks';
import { viewLink } from '../map/view-link';
import { MeasureTools } from './measure-tools';
import { styles } from './styles';

export function MapTools({
  behindLive,
  compact = false,
  following,
  handle,
  measurement,
  selection,
  tool,
  touch = false,
}: {
  /** How far behind live the shift clock is, seconds — part of the view a link carries (201/8-03). */
  behindLive: number;
  /** Phone layout: the cluster narrows so it cannot crowd the map it sits on. */
  compact?: boolean;
  /** Whether the camera is currently riding a unit — read from the readout, never held here. */
  following: boolean;
  /** Null until the engine has booted; the cluster renders disabled rather than absent, so it does not
   *  appear under the operator's cursor a second after they started reaching for it. */
  handle: DispatchHandle | null;
  /** What the sketch in progress measures (201/7-05) — read from the readout, never held here. */
  measurement: Measurement | null;
  selection: Selection;
  /** What a tap on the map currently does. */
  tool: MapTool;
  /** The pointer is a finger: rows and buttons take a finger-sized target. */
  touch?: boolean;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchedPlace[]>([]);
  const [views, setViews] = useState<readonly Bookmark[]>(() => readBookmarks());
  /** The name being typed for a view about to be saved, or null when nothing is being saved. */
  const [naming, setNaming] = useState<null | string>(null);
  /** What the last share did, shown for a moment. A clipboard that refused is not an error worth a dialog,
   *  but it is one the operator has to see — the link is put on screen to copy by hand instead. */
  const [copied, setCopied] = useState('');
  /**
   * On a narrow screen the cluster opens on demand.
   *
   * Measured 2026-08-25 at 360 CSS px: expanded it is ~380x390 over a map ~350 px tall — the search box and
   * nine buttons covering the thing they are for. Nothing here is used every few seconds (search, fit,
   * follow, save, measure, share are all deliberate acts), so a handle costs one tap and buys back the map.
   */
  const [open, setOpen] = useState(false);

  const unitSelected = selection?.kind === 'unit' ? selection.id : null;
  const button = touch ? styles.buttonTouch : styles.button;
  const buttonPrimary = touch ? styles.buttonPrimaryTouch : styles.buttonPrimary;
  const hit = touch ? styles.mapToolsHitTouch : styles.mapToolsHit;
  const input = touch ? styles.mapToolsInputTouch : styles.mapToolsInput;

  const search = (next: string): void => {
    setQuery(next);
    setHits(next.trim() === '' ? [] : (handle?.searchPlaces(next) ?? []));
  };
  const goTo = (place: SearchedPlace): void => {
    handle?.goToPlace(place);
    setQuery('');
    setHits([]);
  };
  // The pose is read when SAVE is pressed, not when the name box opened: an operator who nudges the map
  // while typing a name means the view they are looking at.
  /**
   * The link is built from the map's own view plus the moment the board is showing, and the two halves come
   * from different owners on purpose: the console knows where it is looking, React knows what time it is
   * looking at. Copied rather than navigated to — a console that rewrites its own address bar breaks an
   * embedded host that does not own it (201/7-07).
   */
  const copyLink = (): void => {
    const view = handle?.sharedView();
    if (!view) {
      return;
    }
    const link = viewLink(window.location.href, { ...view, ...(behindLive > 0 ? { behindLive } : {}) });
    void navigator.clipboard?.writeText(link).then(
      () => setCopied('link copied'),
      () => setCopied(link),
    );
  };

  const saveImage = (): void => {
    void handle?.exportImage().then((image) => {
      if (image === null) {
        setCopied('no image');

        return;
      }
      const url = URL.createObjectURL(image);
      const anchor = document.createElement('a');
      anchor.download = `dispatch-${new Date().toISOString().replace(/[:.]/gu, '-')}.png`;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };

  const save = (): void => {
    const pose = handle?.pose();
    const name = naming?.trim() ?? '';
    if (pose && name !== '') {
      setViews(saveBookmark(name, pose));
    }
    setNaming(null);
  };

  if (compact && !open) {
    return (
      <button
        aria-expanded={false}
        onClick={() => setOpen(true)}
        style={styles.mapToolsHandle}
        title="Search, fit, follow, measure and share"
        type="button"
      >
        TOOLS
      </button>
    );
  }

  return (
    <div style={compact ? { ...styles.mapTools, maxWidth: 'min(232px, 56vw)' } : styles.mapTools}>
      {compact && (
        <button
          aria-expanded
          aria-label="Hide the tools"
          onClick={() => setOpen(false)}
          style={{ ...button, justifySelf: 'end' }}
          type="button"
        >
          ×
        </button>
      )}
      <input
        aria-label="Search places"
        onChange={(event) => search(event.target.value)}
        placeholder="Search a place"
        style={input}
        value={query}
      />

      {hits.map((place) => (
        <button key={place.name} onClick={() => goTo(place)} style={hit} type="button">
          {place.name}
        </button>
      ))}

      <div style={{ display: 'flex', gap: 5 }}>
        <button
          disabled={handle === null}
          onClick={() => handle?.fitBoard()}
          style={button}
          title="Put every active unit and call in frame"
          type="button"
        >
          Fit
        </button>
        <button
          disabled={handle === null || (unitSelected === null && !following)}
          onClick={() => handle?.follow(following ? null : unitSelected)}
          style={following ? buttonPrimary : button}
          title={following ? 'Stop riding the selected unit' : 'Ride the selected unit'}
          type="button"
        >
          {following ? 'Following' : 'Follow'}
        </button>
        <button
          disabled={handle === null}
          onClick={() => setNaming(naming === null ? `View ${views.length + 1}` : null)}
          style={naming === null ? button : buttonPrimary}
          title="Save this view"
          type="button"
        >
          {compact ? 'Save' : 'Save view'}
        </button>
      </div>

      <MeasureTools handle={handle} measurement={measurement} tool={tool} touch={touch} />

      <div style={{ display: 'flex', gap: 5 }}>
        <button
          disabled={handle === null}
          onClick={copyLink}
          style={button}
          title="Copy a link to this view — pose, projection, world hour and the moment on the clock"
          type="button"
        >
          {compact ? 'Link' : 'Copy link'}
        </button>
        <button
          disabled={handle === null}
          onClick={saveImage}
          style={button}
          title="Save a PNG of the map with its units, calls and a stamp"
          type="button"
        >
          {compact ? 'Image' : 'Save image'}
        </button>
      </div>

      {copied.startsWith('http') ? (
        // The clipboard refused — an insecure origin, or a browser that wants a gesture it did not get. The
        // link goes on screen to be copied by hand, in a field that can be SELECTED: a button would be
        // dismissed by the first click, which is the one thing the operator is trying not to do.
        <input
          aria-label="Link to this view"
          onFocus={(event) => event.target.select()}
          readOnly
          style={input}
          value={copied}
        />
      ) : (
        copied !== '' && (
          <button onClick={() => setCopied('')} style={{ ...hit, width: 'auto' }} title="Dismiss" type="button">
            {copied}
          </button>
        )
      )}

      {naming !== null && (
        <input
          aria-label="Name this view"
          autoFocus
          onBlur={save}
          onChange={(event) => setNaming(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              save();
            } else if (event.key === 'Escape') {
              setNaming(null);
            }
          }}
          style={input}
          value={naming}
        />
      )}

      {views.map((view) => (
        <div key={view.name} style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => handle?.recallView(view.pose)} style={hit} title="Fly back to this view" type="button">
            {view.name}
          </button>
          <button
            onClick={() => setViews(removeBookmark(view.name))}
            style={{ ...hit, width: 'auto' }}
            title={`Forget "${view.name}"`}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
