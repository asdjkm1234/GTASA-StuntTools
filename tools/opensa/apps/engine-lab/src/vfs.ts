/**
 * The lab's read side onto a served perfect-map-builder output (plan 079 phase 2). The lab inspects ONE model
 * at a time, so it does not build the game's full VFS — it opens the served build's archives lazily
 * (`fetchInstallSource`, the same primitive the http-dir game loader uses) and reads a single converted `.osm`
 * by name. The FORMAT is the game's (`readModelOsm` / `readVehicleOsm` / `readPedOsm` decode these bytes), so
 * the lab and the game render the same asset from the same file — no lab-only fixture format.
 */
import { type DirIndexEntry, fetchDirIndex, fetchInstallSource, type InstallSource } from '@opensa/loaders';

/** Open the served build's archives (needs the game dir — `resolvePakSource(...).gameDir`, an opensa-pack `--out`). */
export async function labInstallSource(gameDir: string): Promise<InstallSource> {
  const index: DirIndexEntry[] = await fetchDirIndex(gameDir);

  return fetchInstallSource(gameDir, index);
}

/** Read a converted model `.osm` by bare name from the build's archives (gta3, then the merged overrides). */
export async function readModelBytes(source: InstallSource, name: string): Promise<null | Uint8Array> {
  return (await source.gta3.read(name)) ?? (await source.gtaInt?.read(name)) ?? null;
}
