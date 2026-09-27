// allow: SIZE_OK — this disposable gate keeps device lifetime, replay setup, readback, and its evidence atomic.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Engine, type CameraState } from '../packages/engine/src/index.ts';
import { OstexFormat, readOstexFormat } from '../packages/engine-formats/src/index.ts';
import { loadAircraft, type AircraftHandle } from '../apps/web/src/flight/aircraft.ts';
import { parseFlightCsv, sampleTrack, type FlightTrack } from '../apps/web/src/flight/csv.ts';
import { PakResources } from '../apps/web/src/flight/pak-resources.ts';
import { create, globals } from 'webgpu';

const WIDTH = 1920;
const HEIGHT = 1080;
const BYTES_PER_PIXEL = 4;
const ROW_ALIGNMENT = 256;
const UPLOAD_BUDGET_MS = 4;
const RUN_TIMEOUT_MS = 180_000;
const INSTALL_COMMAND = 'npm install --save-dev webgpu@0.6.1 --ignore-scripts --no-audit --no-fund';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const EVIDENCE_PATH = resolve(
  REPO_ROOT,
  '.omo/evidence/gate-G1-flight-analysis-remediation-and-worktree-cleanup.json',
);

interface CliOptions {
  readonly adapter: 'arc' | 'none';
  readonly csv: string;
  readonly pak: string;
}

interface PakIndex {
  readonly arrays: readonly { readonly ref: number }[];
  readonly cellSize: number;
  readonly cells: readonly { readonly cx: number; readonly cy: number; readonly lod: boolean }[];
}

interface AdapterRecord {
  architecture: string;
  description: string;
  device: string;
  vendor: string;
}

interface ReadbackRecord {
  readonly conversionMs: number;
  readonly copyAndMapMs: number;
  readonly format: GPUTextureFormat;
  readonly hash: string;
  readonly mappedBytes: number;
  readonly outputBytes: number;
  readonly rowPitch: number;
  readonly seconds: number;
}

interface RunRecord {
  readonly adapter: AdapterRecord;
  readonly backend: 'd3d12';
  readonly bcFormats: readonly number[];
  readonly bcUploadSuccess: boolean;
  readonly cellsLoaded: number;
  readonly deviceLoss: {
    readonly handlerInstalled: boolean;
    readonly message: string;
    readonly reason: string;
  };
  readonly readbacks: readonly ReadbackRecord[];
  readonly textureArraysLoaded: number;
  readonly validationErrors: readonly string[];
}

interface Predicates {
  adapterIsArc: boolean;
  adapterNonNull: boolean;
  backendD3d12OrVulkan: boolean;
  bcUploadSuccess: boolean;
  deterministicSha256: boolean;
  readbackReturnedBytes: boolean;
  zeroValidationErrors: boolean;
}

interface Evidence {
  HEADLESS: 'GO' | 'NO-GO';
  readonly dependency: {
    readonly installCommand: string;
    readonly package: 'webgpu@0.6.1';
  };
  failingPrimitive: string | null;
  readonly inputs: {
    readonly adapter: 'arc' | 'none';
    readonly csv: string;
    readonly pak: string;
    readonly resolution: '1920x1080';
  };
  predicates: Predicates;
  runs: RunRecord[];
}

interface ConfiguredSurface {
  readonly clientHeight: number;
  readonly clientWidth: number;
  height: number;
  width: number;
  takeCurrentTexture(): SurfaceTexture;
}

interface SurfaceTexture {
  readonly format: GPUTextureFormat;
  readonly texture: GPUTexture;
}

interface RuntimeState {
  readonly fetch: typeof globalThis.fetch;
  readonly navigator: PropertyDescriptor | undefined;
}

interface WebGpuFacade {
  readonly wgslLanguageFeatures: WGSLLanguageFeatures;
  getPreferredCanvasFormat(): GPUTextureFormat;
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

class GateError extends Error {
  constructor(
    readonly primitive: string,
    message: string,
  ) {
    super(message);
    this.name = 'GateError';
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
  let adapter: CliOptions['adapter'] = 'arc';
  let csv = '';
  let pak = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pak') {
      pak = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--csv') {
      csv = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--adapter=none') {
      adapter = 'none';
    } else if (arg !== '--adapter=arc') {
      throw new GateError('cli-arguments', `Unknown argument: ${arg}`);
    }
  }
  if (adapter === 'arc' && (!pak || !csv)) {
    throw new GateError('cli-arguments', 'Usage: --pak <map-pak> --csv <hydra.csv> [--adapter=arc|none]');
  }

  return { adapter, csv: csv ? resolve(csv) : '', pak: pak ? resolve(pak) : '' };
}

function emptyPredicates(): Predicates {
  return {
    adapterIsArc: false,
    adapterNonNull: false,
    backendD3d12OrVulkan: false,
    bcUploadSuccess: false,
    deterministicSha256: false,
    readbackReturnedBytes: false,
    zeroValidationErrors: false,
  };
}

function createEvidence(options: CliOptions): Evidence {
  return {
    HEADLESS: 'NO-GO',
    dependency: { installCommand: INSTALL_COMMAND, package: 'webgpu@0.6.1' },
    failingPrimitive: null,
    inputs: {
      adapter: options.adapter,
      csv: options.csv,
      pak: options.pak,
      resolution: '1920x1080',
    },
    predicates: emptyPredicates(),
    runs: [],
  };
}

function createSurface(): ConfiguredSurface {
  let device: GPUDevice | null = null;
  let format: GPUTextureFormat = 'bgra8unorm';
  let viewFormats: GPUTextureFormat[] = ['bgra8unorm-srgb'];
  let current: GPUTexture | null = null;
  const context = {
    canvas: undefined,
    configure(configuration: GPUCanvasConfiguration): void {
      device = configuration.device;
      format = configuration.format;
      viewFormats = [...(configuration.viewFormats ?? [])];
    },
    getCurrentTexture(): GPUTexture {
      if (!device) {
        throw new GateError('surface-configure', 'getCurrentTexture called before configure');
      }
      current = device.createTexture({
        format,
        label: 'gate-g1-offscreen-surface',
        size: { height: HEIGHT, width: WIDTH },
        usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
        viewFormats,
      });

      return current;
    },
    getConfiguration(): GPUCanvasConfiguration | null {
      return device ? { device, format, usage: GPUTextureUsage.RENDER_ATTACHMENT, viewFormats } : null;
    },
    unconfigure(): void {
      device = null;
    },
  };
  const surface = {
    clientHeight: HEIGHT,
    clientWidth: WIDTH,
    context,
    height: HEIGHT,
    width: WIDTH,
    getContext(contextId: string) {
      return contextId === 'webgpu' ? context : null;
    },
    takeCurrentTexture(): SurfaceTexture {
      if (!current) {
        throw new GateError('surface-current-texture', 'Engine.frame did not acquire an offscreen texture');
      }
      const texture = current;
      current = null;

      return { format, texture };
    },
  };

  return surface;
}

function installRuntime(gpu: WebGpuFacade): RuntimeState {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousFetch = globalThis.fetch;
  Object.assign(globalThis, globals);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { gpu },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { devicePixelRatio: 1 },
  });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL
      ? input
      : typeof input === 'string'
        ? new URL(input)
        : new URL(input.url);
    if (url.protocol !== 'file:') {
      return previousFetch(input, init);
    }
    try {
      return new Response(await readFile(fileURLToPath(url)), { status: 200 });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return new Response(null, { status: 404 });
      }
      throw error;
    }
  };

  return { fetch: previousFetch, navigator: previousNavigator };
}

function restoreRuntime(state: RuntimeState): void {
  globalThis.fetch = state.fetch;
  Reflect.deleteProperty(globalThis, 'window');
  if (state.navigator) {
    Object.defineProperty(globalThis, 'navigator', state.navigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
}

function cameraFor(track: FlightTrack, seconds: number): CameraState {
  const pose = sampleTrack(track, seconds);
  const [x, y, z] = pose.pos;

  return {
    aspect: WIDTH / HEIGHT,
    eye: [x - 35, z + 14, -y + 35],
    far: 10_000,
    fovYRad: Math.PI / 3,
    near: 0.5,
    target: [x, z, -y],
    up: [0, 1, 0],
  };
}

function applyAircraftFrame(aircraft: AircraftHandle, track: FlightTrack, seconds: number): void {
  const pose = sampleTrack(track, seconds);
  aircraft.applyPose(pose.pos, pose.orientation);
  aircraft.applyPaint(pose.row.colors);
  aircraft.applyNodes(pose.nodes, pose.row.gear, { pitch: 0, roll: 0, yaw: 0 });
  aircraft.applyProps({ nodes: pose.row.propNodes, nozzleRotation: pose.row.nozzleRotation });
}

async function uploadTextures(engine: Engine, pakPath: string, index: PakIndex): Promise<{
  readonly bcFormats: readonly number[];
  readonly loaded: number;
}> {
  const bcFormats = new Set<number>();
  const refs: number[] = [];
  for (const entry of index.arrays) {
    const bytes = new Uint8Array(await readFile(resolve(pakPath, `textures/${entry.ref}.ostex`)));
    const format = readOstexFormat(bytes);
    if (format !== OstexFormat.RGBA8 && format !== OstexFormat.ASTC4x4) {
      bcFormats.add(format);
    }
    engine.textures.beginLoad(entry.ref, bytes);
    refs.push(entry.ref);
  }
  const deadline = performance.now() + RUN_TIMEOUT_MS;
  while (!refs.every((ref) => engine.textures.has(ref))) {
    if (performance.now() >= deadline) {
      throw new GateError('texture-upload-timeout', `Texture upload exceeded ${RUN_TIMEOUT_MS} ms`);
    }
    engine.textures.drainUploads(UPLOAD_BUDGET_MS);
    await engine.device.queue.onSubmittedWorkDone();
    await new Promise<void>((done) => setImmediate(done));
  }

  return { bcFormats: [...bcFormats].sort(), loaded: refs.length };
}

async function loadNearestCell(engine: Engine, pakPath: string, index: PakIndex, track: FlightTrack): Promise<number> {
  const first = track.rows[0];
  const candidates = index.cells.filter((cell) => !cell.lod);
  const cell = [...candidates].sort((a, b) => {
    const ax = (a.cx + 0.5) * index.cellSize - first.pos[0];
    const ay = (a.cy + 0.5) * index.cellSize - first.pos[1];
    const bx = (b.cx + 0.5) * index.cellSize - first.pos[0];
    const by = (b.cy + 0.5) * index.cellSize - first.pos[1];

    return ax * ax + ay * ay - (bx * bx + by * by);
  })[0];
  if (!cell) {
    throw new GateError('pak-cell', 'Pak index contains no HD cells');
  }
  const key = `${cell.cx},${cell.cy}`;
  const bytes = new Uint8Array(await readFile(resolve(pakPath, `cells/${cell.cx}_${cell.cy}.bin`)));
  engine.cells.load(key, bytes);

  return 1;
}

async function readback(device: GPUDevice, surfaceTexture: SurfaceTexture, seconds: number): Promise<ReadbackRecord> {
  const { format, texture } = surfaceTexture;
  if (format !== 'bgra8unorm' && format !== 'rgba8unorm') {
    throw new GateError('readback-format', `Unsupported measured surface format: ${format}`);
  }
  const tightRow = WIDTH * BYTES_PER_PIXEL;
  const rowPitch = Math.ceil(tightRow / ROW_ALIGNMENT) * ROW_ALIGNMENT;
  const buffer = device.createBuffer({
    label: 'gate-g1-readback',
    size: rowPitch * HEIGHT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const started = performance.now();
  const encoder = device.createCommandEncoder({ label: 'gate-g1-copy' });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow: rowPitch, rowsPerImage: HEIGHT },
    { height: HEIGHT, width: WIDTH },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const copyAndMapMs = performance.now() - started;
  const mapped = new Uint8Array(buffer.getMappedRange());
  const conversionStarted = performance.now();
  const rgba = new Uint8Array(tightRow * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const sourceRow = y * rowPitch;
    const outputRow = y * tightRow;
    for (let x = 0; x < WIDTH; x += 1) {
      const source = sourceRow + x * BYTES_PER_PIXEL;
      const output = outputRow + x * BYTES_PER_PIXEL;
      rgba[output] = mapped[source + (format === 'bgra8unorm' ? 2 : 0)];
      rgba[output + 1] = mapped[source + 1];
      rgba[output + 2] = mapped[source + (format === 'bgra8unorm' ? 0 : 2)];
      rgba[output + 3] = mapped[source + 3];
    }
  }
  const conversionMs = performance.now() - conversionStarted;
  const hash = createHash('sha256').update(rgba).digest('hex');
  const mappedBytes = mapped.byteLength;
  buffer.unmap();
  buffer.destroy();
  texture.destroy();

  return {
    conversionMs,
    copyAndMapMs,
    format,
    hash,
    mappedBytes,
    outputBytes: rgba.byteLength,
    rowPitch,
    seconds,
  };
}

async function runOnce(options: CliOptions, track: FlightTrack): Promise<RunRecord> {
  let gpu: GPU | null = create(['backend=d3d12', 'adapter=Arc']);
  const adapterRecord: AdapterRecord = { architecture: '', description: '', device: '', vendor: '' };
  const facade: WebGpuFacade = {
    getPreferredCanvasFormat: () => gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm',
    requestAdapter: async (requestOptions) => {
      const adapter = await gpu?.requestAdapter(requestOptions) ?? null;
      if (adapter) {
        adapterRecord.architecture = adapter.info.architecture;
        adapterRecord.description = adapter.info.description;
        adapterRecord.device = adapter.info.device;
        adapterRecord.vendor = adapter.info.vendor;
      }

      return adapter;
    },
    wgslLanguageFeatures: gpu.wgslLanguageFeatures,
  };
  const runtimeState = installRuntime(facade);
  let engine: Engine | null = null;
  let aircraft: AircraftHandle | null = null;
  let device: GPUDevice | null = null;
  const validationErrors: string[] = [];
  try {
    engine = new Engine();
    const surface = createSurface();
    await Reflect.apply(engine.init, engine, [surface]);
    device = engine.device;
    device.addEventListener('uncapturederror', (event) => {
      validationErrors.push(event.error.message);
    });
    device.pushErrorScope('validation');

    const indexText = await readFile(resolve(options.pak, 'index.json'), 'utf8');
    const index = JSON.parse(indexText) as PakIndex;
    const upload = await uploadTextures(engine, options.pak, index);
    const cellsLoaded = await loadNearestCell(engine, options.pak, index, track);
    const pakDirectory = options.pak.endsWith(sep) ? options.pak : `${options.pak}${sep}`;
    const resources = await PakResources.load(pathToFileURL(pakDirectory).href);
    aircraft = await loadAircraft(engine, resources, 520);
    const times = [0, track.duration / 2, track.duration];
    const readbacks: ReadbackRecord[] = [];
    for (const seconds of times) {
      applyAircraftFrame(aircraft, track, seconds);
      engine.particleClock = seconds;
      engine.updateVehicles();
      engine.frame(cameraFor(track, seconds));
      readbacks.push(await readback(device, surface.takeCurrentTexture(), seconds));
    }
    const scopedError = await device.popErrorScope();
    if (scopedError) {
      validationErrors.push(scopedError.message);
    }
    await device.queue.onSubmittedWorkDone();

    aircraft.dispose();
    aircraft = null;
    const lost = device.lost;
    device.destroy();
    const lossInfo = await Promise.race([
      lost,
      new Promise<null>((done) => setTimeout(() => done(null), 2_000)),
    ]);
    device = null;

    return {
      adapter: adapterRecord,
      backend: 'd3d12',
      bcFormats: upload.bcFormats,
      bcUploadSuccess: upload.bcFormats.length > 0,
      cellsLoaded,
      deviceLoss: {
        handlerInstalled: true,
        message: lossInfo?.message ?? 'device.lost did not resolve within 2000 ms',
        reason: lossInfo?.reason ?? 'timeout',
      },
      readbacks,
      textureArraysLoaded: upload.loaded,
      validationErrors,
    };
  } finally {
    aircraft?.dispose();
    device?.destroy();
    engine = null;
    device = null;
    restoreRuntime(runtimeState);
    gpu = null;
  }
}

function evaluate(evidence: Evidence): void {
  const adapterNames = evidence.runs.map((run) =>
    `${run.adapter.vendor} ${run.adapter.architecture} ${run.adapter.device} ${run.adapter.description}`.toLowerCase(),
  );
  const firstHashes = evidence.runs[0]?.readbacks.map((readback) => readback.hash) ?? [];
  const secondHashes = evidence.runs[1]?.readbacks.map((readback) => readback.hash) ?? [];
  evidence.predicates = {
    adapterIsArc: adapterNames.length === 2 && adapterNames.every((name) => name.includes('arc')),
    adapterNonNull: evidence.runs.length === 2,
    backendD3d12OrVulkan: evidence.runs.length === 2 && evidence.runs.every((run) => run.backend === 'd3d12'),
    bcUploadSuccess: evidence.runs.length === 2 && evidence.runs.every((run) => run.bcUploadSuccess),
    deterministicSha256:
      firstHashes.length > 0 &&
      firstHashes.length === secondHashes.length &&
      firstHashes.every((hash, index) => hash === secondHashes[index]),
    readbackReturnedBytes:
      evidence.runs.length === 2 && evidence.runs.every((run) => run.readbacks.every((item) => item.outputBytes > 0)),
    zeroValidationErrors:
      evidence.runs.length === 2 && evidence.runs.every((run) => run.validationErrors.length === 0),
  };
  const failed = Object.entries(evidence.predicates).find(([, passed]) => !passed);
  evidence.HEADLESS = failed ? 'NO-GO' : 'GO';
  evidence.failingPrimitive = failed?.[0] ?? null;
}

async function writeEvidence(evidence: Evidence): Promise<void> {
  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const fallback: CliOptions = { adapter: 'none', csv: '', pak: '' };
    const evidence = createEvidence(fallback);
    evidence.failingPrimitive = error instanceof GateError ? error.primitive : 'cli-arguments';
    await writeEvidence(evidence);
    console.error(error instanceof Error ? error.message : String(error));

    return;
  }
  const evidence = createEvidence(options);
  if (options.adapter === 'none') {
    evidence.failingPrimitive = 'requestAdapter-forced-none';
    await writeEvidence(evidence);
    console.log(`HEADLESS=NO-GO (${evidence.failingPrimitive})`);

    return;
  }
  try {
    const csvText = await readFile(options.csv, 'utf8');
    const track = parseFlightCsv(csvText, options.csv);
    if (track.model !== 520) {
      throw new GateError('hydra-csv', `Expected Hydra model 520, got ${track.model}`);
    }
    evidence.runs.push(await runOnce(options, track));
    evidence.runs.push(await runOnce(options, track));
    evaluate(evidence);
  } catch (error) {
    evidence.HEADLESS = 'NO-GO';
    evidence.failingPrimitive = error instanceof GateError
      ? error.primitive
      : error instanceof DOMException && error.name === 'AbortError'
        ? 'dawn-operation-aborted'
        : 'headless-run';
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  await writeEvidence(evidence);
  console.log(`HEADLESS=${evidence.HEADLESS}${evidence.failingPrimitive ? ` (${evidence.failingPrimitive})` : ''}`);
}

await main();
