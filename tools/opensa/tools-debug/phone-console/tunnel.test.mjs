import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  chooseProviders,
  isFatal,
  isReady,
  PROVIDERS,
  readToken,
  sshIdentity,
  stabilityHint,
  summary,
  tunnelUrl,
} from './tunnel.mjs';

const provider = (name) => PROVIDERS.find((entry) => entry.name === name);

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'opensa-token-')), 'mcp-token');

describe('panel tunnel', () => {
  describe('negative cases', () => {
    it('does not read a token out of an empty file — it makes one', () => {
      const file = tempFile();
      writeFileSync(file, '   \n', 'utf8');

      expect(readToken(file, () => 'fresh')).toBe('fresh');
    });

    it('finds no address in a line that is not the tunnel announcing one', () => {
      expect(tunnelUrl('2026-08-28T14:02:11Z INF Requesting new quick Tunnel...')).toBeNull();
      expect(tunnelUrl('https://example.com/mcp')).toBeNull();
    });

    it('offers nothing when no provider is installed, rather than spawning a command that is not there', () => {
      expect(chooseProviders(undefined, () => false)).toEqual([]);
    });

    it('does not fall back past a provider the operator named', () => {
      expect(chooseProviders('ngrok', () => true).map((entry) => entry.name)).toEqual(['ngrok']);
    });

    it('does not call cloudflared ready on the banner it prints before dialling the edge', () => {
      // 2026-08-28, verbatim: this line appeared, every dial after it failed, and the address was dead.
      const banner = 'INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):';

      expect(isReady(provider('cloudflared'), banner, 'https://teens-executed-standards-retro.trycloudflare.com')).toBe(
        false,
      );
    });

    it('is never ready before an address has been seen at all', () => {
      expect(isReady(provider('pinggy'), 'anything', null)).toBe(false);
    });

    it('drops cloudflared the moment its own pre-check says the network cannot carry it', () => {
      expect(isFatal(provider('cloudflared'), 'INF precheck complete hard_fail=true run_id=79757136-7e6c')).toBe(true);
      expect(isFatal(provider('cloudflared'), 'INF | SUMMARY: Environment has critical failures.')).toBe(true);
    });

    it('does not present a key it does not have — an anonymous localhost.run is still a tunnel', () => {
      expect(provider('localhost.run').args(8788)).toContain('nokey@localhost.run');
      expect(provider('localhost.run').args(8788)).not.toContain('-i');
    });

    it('finds no ssh identity in a home with no key, rather than naming one that is not there', () => {
      expect(sshIdentity('/home/nobody', () => false)).toBeNull();
    });

    it('does not pin ngrok to a domain the operator has not reserved', () => {
      expect(provider('ngrok').args(8788).join(' ')).not.toContain('--url');
    });

    it('says nothing about stability when the address is already stable', () => {
      expect(stabilityHint({ identity: '/home/u/.ssh/id_ed25519' })).toBe('');
      expect(stabilityHint({ ngrokDomain: 'https://opensa.ngrok-free.app' })).toBe('');
    });

    it('does not mistake a retry for a failure that is worth giving up on', () => {
      expect(isFatal(provider('cloudflared'), 'ERR Failed to dial a quic connection error="timeout"')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('keeps the token it made, so only the address has to be pasted again', () => {
      const file = tempFile();
      const first = readToken(file, () => 'once');

      expect(readToken(file, () => 'twice')).toBe(first);
      expect(readFileSync(file, 'utf8').trim()).toBe('once');
      expect(existsSync(file)).toBe(true);
    });

    it('reads the address out of the line cloudflared actually prints', () => {
      const line = '2026-08-28T14:02:14Z INF |  https://tidy-pine-mango-ab12.trycloudflare.com   |';

      expect(tunnelUrl(line)).toBe('https://tidy-pine-mango-ab12.trycloudflare.com');
    });

    it('reads the address each provider actually prints', () => {
      // ngrok logs key=value; serveo writes a sentence; cloudflared draws a box. One pattern, three shapes.
      expect(
        tunnelUrl('t=2026-08-28T14:30:02+0000 lvl=info msg="started tunnel" url=https://a1b2-c3.ngrok-free.app'),
      ).toBe('https://a1b2-c3.ngrok-free.app');
      // 2026-08-28, verbatim: ngrok handed out an `ngrok-free.dev` address, the pattern only knew `.app`,
      // and a connected tunnel was abandoned as "no address" 45s later.
      expect(
        tunnelUrl(
          't=2026-08-28T15:48:00+0000 lvl=info msg="started tunnel" obj=tunnels name=command_line ' +
            'addr=http://localhost:8788 url=https://prowling-volumes-smooth.ngrok-free.dev',
        ),
      ).toBe('https://prowling-volumes-smooth.ngrok-free.dev');
      expect(tunnelUrl('Forwarding HTTP traffic from https://frosty-lake.serveo.net')).toBe(
        'https://frosty-lake.serveo.net',
      );
      expect(tunnelUrl('INF |  https://tidy-pine-mango-ab12.trycloudflare.com   |')).toBe(
        'https://tidy-pine-mango-ab12.trycloudflare.com',
      );
      // pinggy and localhost.run both put more than one label in front of the domain.
      expect(tunnelUrl('http://ab12-cd.a.free.pinggy.link\nhttps://ab12-cd.a.free.pinggy.link')).toBe(
        'https://ab12-cd.a.free.pinggy.link',
      );
      expect(tunnelUrl('a1b2c3.lhr.life tunneled with tls termination, https://a1b2c3.lhr.life')).toBe(
        'https://a1b2c3.lhr.life',
      );
    });

    it('tries the ones that reach their edge over 443 BEFORE the one that needs 7844', () => {
      // The order is the finding, not a preference: this phone's carrier blocks 7844 both ways while 443
      // passes, so cloudflared cannot connect here however long it retries.
      expect(chooseProviders(undefined, () => true).map((entry) => entry.name)).toEqual([
        'ngrok',
        'localhost.run',
        'pinggy',
        'serveo',
        'cloudflared',
      ]);
      expect(PROVIDERS.at(-1).name).toBe('cloudflared');
    });

    it('never lets an ssh provider stop at a password prompt', () => {
      // pinggy did, on a phone with no key, and burned the whole timeout waiting on an invisible prompt.
      for (const name of ['localhost.run', 'pinggy', 'serveo']) {
        expect(provider(name).args(8788)).toContain('BatchMode=yes');
      }
    });

    it('asks every ssh provider that can be asked for port 443', () => {
      for (const name of ['pinggy', 'serveo']) {
        expect(provider(name).args(8788)).toContain('443');
      }
    });

    it('takes an ssh provider at its word: the address arrives on a connection that is already up', () => {
      expect(
        isReady(provider('pinggy'), 'https://ab12-cd.a.free.pinggy.link', 'https://ab12-cd.a.free.pinggy.link'),
      ).toBe(true);
    });

    it('announces cloudflared only once it says it registered a connection', () => {
      const line = 'INF Registered tunnel connection connIndex=0 connection=1ce3744e location=fra01';

      expect(isReady(provider('cloudflared'), line, 'https://x.trycloudflare.com')).toBe(true);
    });

    it('presents the phone key when it has one, which is what keeps the subdomain still', () => {
      const args = provider('localhost.run').args(8788, { identity: '/home/u/.ssh/id_ed25519' });

      expect(args).toContain('/home/u/.ssh/id_ed25519');
      expect(args).toContain('IdentitiesOnly=yes');
      expect(args).not.toContain('nokey@localhost.run');
    });

    it('prefers ed25519 over rsa when the phone carries both', () => {
      expect(sshIdentity('/home/u', (path) => path.endsWith('id_ed25519') || path.endsWith('id_rsa'))).toBe(
        '/home/u/.ssh/id_ed25519',
      );
    });

    it('pins ngrok to a reserved domain when one is configured', () => {
      expect(provider('ngrok').args(8788, { ngrokDomain: 'https://opensa.ngrok-free.app' })).toContain(
        '--url=https://opensa.ngrok-free.app',
      );
    });

    it('says how to stop the address moving when it still can', () => {
      const hint = stabilityHint({});

      expect(hint).toContain('ssh-keygen');
      expect(hint).toContain('NGROK_DOMAIN');
    });

    it('prints both values under the names the settings page asks for', () => {
      const printed = summary('https://x.trycloudflare.com/mcp', 'abc123');

      expect(printed).toContain('OPENSA_PHONE_URL    https://x.trycloudflare.com/mcp');
      expect(printed).toContain('OPENSA_PHONE_TOKEN  abc123');
      expect(printed).toContain('START A NEW SESSION');
    });
  });
});
