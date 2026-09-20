import { looseGroup } from '@opensa/game-build/partition';

/**
 * Base for the {@link InstallSource}-driven loaders (plan 079 phase 1). `init` / `load` / `openWorld` are
 * identical whether the install is a user-picked FSA folder ({@link AssetLocalLoader}) or a perfect-map-builder
 * output served over HTTP ({@link AssetHttpDirLoader}); the two differ ONLY in {@link resolveSource}. Reads the
 * selected asset set (same buckets as the fetch build (`@opensa/game-build` partition)) into the VFS with count-based progress.
 */
import type { AssetLoader, AssetLoaderEvents, ChunkInfo, GroupName, Manifest } from '../types';
import type { InstallPlan, InstallSource } from './build-vfs';

import { Emitter } from '../emitter';
import { GROUP_NAMES } from '../manifest';
import { readEntry, selectInstallEntries } from './build-vfs';

/** The build label + VFS sink shared by every InstallSource-driven loader. */
export interface InstallLoaderConfig {
  /** The build variant + version, used to label the synthesised manifest. */
  game: string;
  /** Where resolved file bytes go — the VFS. Optional so the loader runs/tests standalone. */
  sink?: { addFiles(chunkId: string, entries: Iterable<readonly [string, Uint8Array]>): Promise<void> | void };
  version: string;
}

/** One file to materialise into the VFS — its VFS key + how to read its bytes from the install. */
interface FileTask {
  name: string;
  read: (source: InstallSource) => Promise<Uint8Array>;
}

export abstract class InstallSourceLoader implements AssetLoader {
  readonly events = new Emitter<AssetLoaderEvents>();

  protected plan: InstallPlan | null = null;
  protected source: InstallSource | null = null;

  constructor(protected readonly config: InstallLoaderConfig) {}

  async init(): Promise<Manifest> {
    const { plan } = await this.ensureSource();

    return synthManifest(this.config, plan);
  }

  async load(groups: readonly GroupName[] = GROUP_NAMES): Promise<void> {
    const { plan, source } = await this.ensureSource();
    const work = groups.map((group) => ({ files: filesForGroup(plan, group), group }));
    const total = work.reduce((sum, item) => sum + item.files.length, 0);

    let done = 0;
    let completedGroups = 0;
    const emit = (): void =>
      this.events.emit('progress', {
        loadedBytes: done,
        loadedChunks: completedGroups,
        totalBytes: total,
        totalChunks: work.length,
      });
    emit();

    for (const { files, group } of work) {
      const entries: [string, Uint8Array][] = [];
      for (const file of files) {
        entries.push([file.name, await file.read(source)]);
        done += 1;
        emit();
      }
      await this.config.sink?.addFiles(`local-${group}`, entries);
      completedGroups += 1;
    }
  }

  /**
   * Open a world-pak file from the game dir's `pak/` folder (plan 086 phase 8 — the self-contained
   * layout), falling back to the legacy homes: the nested `opensa/` (pre-phase-7 builds) and the
   * `opensa-pack/` sibling of a root pick (the short-lived phase-7 layout). This is what makes the
   * loading MODE select the world: the pak comes from the picked/served install, never the app's
   * `public/`. Absent file ⇒ null, so the streaming setup fails loudly instead of falling back.
   */
  async openWorld(name: string): Promise<Blob | null> {
    const { source } = await this.ensureSource();
    const lower = name.toLowerCase();

    return (
      (await source.openLoose(`pak/${lower}`)) ??
      (await source.openLoose(`opensa/${lower}`)) ??
      source.openLoose(`opensa-pack/${lower}`)
    );
  }

  /** Resolve the backing install (picker + FSA, or a served dir). Called once; the base memoises the result. */
  protected abstract resolveSource(): Promise<InstallSource>;

  /** Resolve the install source + selection once (memoised). */
  private async ensureSource(): Promise<{ plan: InstallPlan; source: InstallSource }> {
    this.source ??= await this.resolveSource();
    this.plan ??= await selectInstallEntries(this.source);

    return { plan: this.plan, source: this.source };
  }
}

/** A task reading an archive entry's bytes (model/texture/world). */
function entryTask(entry: InstallPlan['models'][number]): FileTask {
  return { name: entry.name, read: (source) => readEntry(source, entry) };
}

/** The files to ingest for one group: the loose files bucketed into it + its img archive entries. */
function filesForGroup(plan: InstallPlan, group: GroupName): FileTask[] {
  const loose = plan.loose
    .filter((path) => looseGroup(path) === group)
    .map((path): FileTask => ({ name: path, read: (source) => source.readLoose(path) }));
  if (group === 'models') {
    return [...loose, ...plan.models.map(entryTask)];
  }
  if (group === 'textures') {
    return [...loose, ...plan.textures.map(entryTask)];
  }
  if (group === 'others') {
    return [...loose, ...plan.others.map(entryTask)];
  }

  return loose; // data — loose files under data/ only
}

/** A manifest mirroring the selection (one synthetic chunk per group) so `Vfs.verify` matches the ingest. */
function synthManifest(config: InstallLoaderConfig, plan: InstallPlan): Manifest {
  const chunk = (group: GroupName, count: number): ChunkInfo => ({
    bytes: count,
    cached: false, // these loaders read from disk/HTTP every boot — nothing goes through Cache Storage
    entries: count,
    file: `local-${group}`,
    hash: '',
  });
  const groupCount = (group: GroupName): number => filesForGroup(plan, group).length;

  return {
    chunks: {
      data: [chunk('data', groupCount('data'))],
      models: [chunk('models', groupCount('models'))],
      others: [chunk('others', groupCount('others'))],
      textures: [chunk('textures', groupCount('textures'))],
    },
    game: config.game,
    version: config.version,
  };
}
