import { describe, expect, it } from 'vitest';

import type { MapPose } from './map-camera';

import { readView, viewLink, viewOfPose, viewQuery } from './view-link';

/**
 * A link that opens the wrong view fails SILENTLY: nothing throws, the console ignores what it does not
 * understand, and the operator on the other end is looking at the default view while being told it is the
 * right one. So the round trip is the test — what this module writes is what it reads.
 */
const POSE: MapPose = { at: [1480.44, -1720.51], height: 900, pitch: -1.15, projection: 'ortho', yaw: Math.PI };

describe('view-link', () => {
  describe('negative cases', () => {
    it('ignores a coordinate that is not a pair of numbers', () => {
      expect(readView(new URLSearchParams('at=banana')).at).toBeUndefined();
      expect(readView(new URLSearchParams('at=1480')).at).toBeUndefined();
      expect(readView(new URLSearchParams('at=1480,-1720,5')).at).toBeUndefined();
    });

    it('invents no defaults: what a link does not say, it does not answer', () => {
      expect(readView(new URLSearchParams(''))).toEqual({});
    });

    it('ignores a projection it does not have', () => {
      expect(readView(new URLSearchParams('proj=isometric')).projection).toBeUndefined();
    });

    it('ignores a number it cannot read rather than turning it into one', () => {
      expect(readView(new URLSearchParams('h=&pitch=banana&hour=')).height).toBeUndefined();
      expect(readView(new URLSearchParams('pitch=banana')).pitch).toBeUndefined();
    });

    it('does not write a moment for a live view', () => {
      expect(viewQuery({ behindLive: 0 }).has('back')).toBe(false);
      expect(readView(new URLSearchParams('back=0')).behindLive).toBeUndefined();
    });

    it("carries no selection — ids are somebody else's board", () => {
      const query = viewQuery({ ...viewOfPose(POSE), hour: 21 });

      expect(query.has('unit')).toBe(false);
      expect(query.has('incident')).toBe(false);
      expect(query.has('selection')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('round-trips a whole view through a query string', () => {
      const view = {
        ...viewOfPose(POSE),
        behindLive: 120,
        district: 'los-santos-centre',
        hour: 21.5,
        src: '/build',
        theme: 'mark43',
      };
      const back = readView(viewQuery(view));

      expect(back.at?.[0]).toBeCloseTo(1480.4, 1);
      expect(back.at?.[1]).toBeCloseTo(-1720.5, 1);
      expect(back.height).toBe(900);
      expect(back.pitch).toBeCloseTo(POSE.pitch, 3);
      expect(back.yaw).toBeCloseTo(POSE.yaw, 3);
      expect(back.projection).toBe('ortho');
      expect(back.hour).toBe(21.5);
      expect(back.behindLive).toBe(120);
      expect(back.district).toBe('los-santos-centre');
      expect(back.src).toBe('/build');
      expect(back.theme).toBe('mark43');
    });

    it('writes angles in degrees, because a human edits these by hand', () => {
      const query = viewQuery(viewOfPose({ ...POSE, pitch: -Math.PI / 4, yaw: Math.PI }));

      expect(query.get('pitch')).toBe('-45');
      expect(query.get('yaw')).toBe('180');
    });

    it('builds a link on the page it is served from, dropping any query already there', () => {
      const link = viewLink('http://phone.local/dispatch.html?demo=1#frag', { at: [10, 20], height: 400 });

      expect(link).toBe('http://phone.local/dispatch.html?at=10,20&h=400');
    });

    it('is stable: the same view is the same string, so two links compare', () => {
      const view = { ...viewOfPose(POSE), hour: 12 };

      expect(viewQuery(view).toString()).toBe(viewQuery(view).toString());
    });

    it('keeps the projection, because the same pose is a different picture in plan view', () => {
      expect(readView(viewQuery(viewOfPose(POSE))).projection).toBe('ortho');
      expect(readView(viewQuery(viewOfPose({ ...POSE, projection: 'perspective' }))).projection).toBe('perspective');
    });
  });
});
