<p align="center">
  <img src="./assets/logo-repo.png" alt="OpenSA — an open-source game engine compatible with RenderWare, in the browser" width="420" />
</p>

<p align="center">
  <a href="https://opensa.cc"><img src="https://img.shields.io/badge/site-opensa.cc-2a7ae2" alt="Website" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-2a7ae2" alt="License: AGPL-3.0" /></a>
</p>

An open-source, from-scratch, high-performance **game engine, built compatible with RenderWare** — the engine
behind GTA San Andreas. Bring your own game files (or a total-conversion mod) and it streams the real world,
models and physics straight into the browser, with no install.

**It is not a reimplementation.** Compatibility is how your files get in, not the ceiling for what happens
next. San Andreas shipped in 2004 against a 32 MB console budget; OpenSA reads its data honestly and then does
the job the way modern hardware allows — its own streaming, generated far LODs the original never had, a
WebGPU renderer, and none of the object-count limits that corrupt a large map. Where we can beat the original,
we do; where we keep its behaviour, we say why. The target is an AAA-grade engine and a world worth driving
through — the goals, and the rules that keep them honest, are in
[docs/project-goals.md](./docs/project-goals.md).

> Unofficial, non-commercial fan project. Not affiliated with Rockstar Games or Take-Two.

<p align="center">
  <a href="https://opensa.cc"><img src="https://img.shields.io/badge/%E2%96%B6%20Play%20the%20Demo-opensa.cc-F55C07?style=for-the-badge" alt="Play the demo" /></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=eA1gVWzANRU&amp;list=PLB21jFrZE9wA" title="Watch the OpenSA 0.4.0 trailer">
    <img src="https://img.youtube.com/vi/eA1gVWzANRU/maxresdefault.jpg" alt="OpenSA — an open-source game engine compatible with RenderWare, in the browser — 0.4.0 trailer" width="640" />
  </a>
</p>

## Blog

Dev notes and progress - in [`/blog`](./blog).

- 2026-06-18 - [I ran GTA San Andreas on my own engine in the browser - solo with Claude, in 3 weeks](./blog/1-i-ran-gta-san-andreas-on-my-own-engine-in-the-browser-solo-with-claude-in-3-weeks.md)
- 2026-07-08 - [How I built a perfect GTA San Andreas map with my own engine](./blog/2-how-i-built-a-perfect-gta-san-andreas-map-with-my-own-engine.md)
- 2026-08-03 - [An AAA engine for GTA San Andreas in the browser - and rewriting Three.js](./blog/3-an-aaa-engine-for-gta-san-andreas-in-the-browser-and-rewriting-threejs.md)

## Contributing

Contributions are welcome - see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, the dev workflow, and
conventions. First-time asset setup: [docs/development/getting-started.md](./docs/development/getting-started.md).

## License

Copyright (c) 2026 Aleksandrov Sergey

The OpenSA source code is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0). You may use, modify and redistribute it under the terms of that license; if
you run a modified version as a network service, you must offer its source to users. See
[LICENSE](./LICENSE) for the full text.

**This license covers only the original OpenSA code.** GTA San Andreas assets, models,
maps, names and trademarks are the property of Rockstar Games / Take-Two Interactive and
are **not** covered by it or distributed with this project. OpenSA is an unofficial,
non-commercial fan project, not affiliated with Rockstar Games or Take-Two.

## Legal & takedowns

OpenSA is an **experiment** and an unofficial, **non-commercial fan project**. It is **not affiliated with,
endorsed by, or sponsored by Rockstar Games or Take-Two Interactive**, and it is **not** a way to obtain,
copy, or redistribute their games — it's an alternative way to run a copy you already own.

- **No game assets are included or distributed in this repository.** To run the engine you must supply files
  from your own legitimate copy of the game (or a community mod you have the right to use).
- "Grand Theft Auto", "GTA", "San Andreas", RenderWare, and related names, logos and trademarks belong to
  their respective owners. They are used here **only descriptively**, to state what the engine is compatible
  with — not as branding.
- The public demo at [opensa.cc](https://opensa.cc) may load community **mod** content; all such content
  remains the property of its respective authors.

If you are a rights holder and believe anything here infringes your rights, please open an issue at
<https://github.com/AlexSergey/opensa/issues> or email the maintainer, Aleksandrov Sergey, at
<gooddev.sergey@gmail.com>, and we will review it in good faith and, where appropriate, **remove the material
promptly**.
