# 1 — Device truth: measure the target before spending anything on it

**Nothing in this bundle may be optimised for a device we cannot measure, and nothing may ship to a platform
the build does not know about.** This chain is short, cheap and first for one reason: today a pak that is
undisplayable on a platform we are targeting passes every test we have and fails on the user's phone, at the
first texture, by name.

> **Caught:** partly. `beginOstexUpload` throws by name — but *nothing in the build or in CI tells you a pak
> is undisplayable on a platform you are targeting.*
> — [restrictions/assets-and-data.md](../../../restrictions/assets-and-data.md#a-worlds-texture-format-decides-which-gpus-can-display-it)

## 01 — The pak declares which GPUs can display it

`opensa-pack` already knows: it chose every texture's format. Write it into the manifest as the set of
adapter features the pak **demands** (`texture-compression-bc`, `-astc`, `-etc2`, or none for RGBA8 /
universal), and have the shell read it at the gate instead of discovering it at the first upload.

- The shell's `webgpu-gate.ts` already gates before boot for hosts that know their world is BC — this
  replaces "know" with "read".
- A `--platforms` assertion in the pack CLI + a CI check per shipped build: a build declaring mobile support
  whose manifest demands BC fails the build.
- **Same change:** the manifest field is a name that carries behaviour → a row in `docs/contracts/`.
- Verification: a synthetic BC pak and an RGBA8 pak, each asserted against a fake adapter with and without
  the feature; the failure must name the pak, not the texture.

## 02 — A bench methodology that works where `timestamp-query` does not

The Mali row has no `gpuMs` column at all — the adapter offers no `timestamp-query`, and the HUD falls back
to CPU timings by design. Every comparison rule in `docs/benchmarks/readme.md` assumes that column exists.

- Define the mobile run's schema: frame avg/p95, draws, resident MB, cells, and the `[slow]` census — plus
  the fields the 08-04 row is missing (adapter features, `featureLevel`, DPR, CSS size, pak build **and** its
  platform field).
- State plainly, in the schema, that **a mobile row and a desktop row are never comparable** — the same rule
  that already separates the lab and in-game families.
- **Same change:** `docs/benchmarks/readme.md` schema + index note.

## 03 — A repeatable way to capture a phone

The 08-04 capture needed `#enable-unsafe-webgpu` and a browser restart, on a device whose adapter was
blocklisted. That proves the hardware and is **not a shipping path**, so it cannot be the only path.

- **Emulation gate (CI-able):** a Chromium run with `texture-compression-bc` filtered out of the adapter —
  already proven on 2026-08-04 against an emulated Pixel 7. This is the gate that catches a BC regression
  without a phone in the room.
- **Real-device ritual (human):** the documented steps, what it records, and what it may *not* be used to
  claim (a flagged browser is evidence about hardware, never about reach).
- Note for the harness: over plain `http://` on a LAN IP, `caches` is undefined and every asset re-downloads
  silently — a phone run must be served over https or the run says it was not
  ([browser-runtime.md](../../../edge-cases/browser-runtime.md)).
- **Same change:** a row in `docs/debug/README.md` if it produces a script.

## 04 — The budget, derived rather than declared

**What a phone can hold resident is unknown today.** The desktop record runs 265–637 MB in the lab and
1805 MB on the soak; the one mobile row is a 37 MB synthetic city. Any number written before this step is
measured is a fitted constant with no residual — the thing `CLAUDE.md` forbids.

**Shipped so far: the inputs, not the ceiling.** `describeDevice` (`engine.deviceReport`) emits the adapter's
features, what it lacks, its feature level, and the CSS size and DPR, as `[bench] device` once per sweep — so
every capture from here on carries the facts a budget would be derived from. **The ceiling itself is
deliberately absent**: WebGPU exposes no VRAM, so a number written before a device has been measured is a
fitted constant with nothing to check it against, which is the thing `CLAUDE.md` forbids outright.

- Derive the ceiling from what the device actually reports (`adapter.limits`, the feature set, DPR, viewport)
  plus a **measured pressure probe** — allocate until the device complains, once, and record where.
- **The rule this step exists to protect:** no per-device table. "Mali → 0.6" is the hardware version of
  hardcoding a value for `comet`; the budget must derive from what the adapter carries so it applies to
  whatever phone is in the slot next year.
- Output: one number and one signal that chains 2 and 4 spend against — the residency ceiling, and how the
  streamer learns it is near it.
- **Same change:** the numbers into `docs/benchmarks/`, before they are analysed.

## Acceptance

- A deliberately-BC pak, declared mobile, **fails CI**.
- A phone capture exists that a stranger could reproduce from the doc alone, and it names everything the
  08-04 row had to leave blank.
- Chains 2–5 have a residency ceiling to design against that nobody typed in by hand.
