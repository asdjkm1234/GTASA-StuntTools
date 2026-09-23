# HANDOFF — GTASA StuntTools（特技飞行录制 + WebGPU 3D 回放）

> 接手先读这一份。它是这个项目的唯一上下文来源：目标、结构、已完成、**已踩过的坑与根因**、如何构建/运行/自测、以及下一步。
> 同目录 `README.md` 是用户向说明；本文件是工程/交接说明。两者冲突时以本文件和代码为准。

## 0. 一句话

在 GTA SA / SA-MP 里常驻录制 Hydra(520)/Rustler(476) 的飞行数据成 CSV，再用 **OpenSA 的 WebGPU 引擎**
读取**用户自己的 GTA 安装**在浏览器里 3D 回放。全部本地运行，不分发任何游戏资源。

## 1. 环境与路径（本机事实）

| 项 | 值 |
|---|---|
| 项目根 | `C:\Users\asdjk\Desktop\GTASA-StuntTools` |
| 游戏目录 | `<项目根>\GTA San Andreas`（`models\gta3.img` 约 940MB；SA-MP 0.3.7-R5 + CLEO + ModLoader） |
| 回放服务 | `web-replay\local-server.mjs`，默认 `127.0.0.1:4173` |
| WebGPU 引擎 | `tools\opensa`（OpenSA 源码，**AGPL-3.0**，见 `tools\opensa\LICENSE`） |
| 回放 app | `tools\opensa\apps\web\src\flight\*` + `...\standalone\flight-replay.ts`，入口 `tools\opensa\flight-replay.html` |
| 编译器 | `tools\zig\zig-windows-x86_64-0.14.0\zig.exe` |
| 显卡/浏览器 | Intel Arc A380 + Chrome 153（WebGPU 可用，见 §5 配置坑） |
| 另一个旧目录 | `..\GTASA-FlightTools` **已于 2026-09-20 删除**（废弃的旧实现；其 `tools\plugin-sdk` 未保留，若日后要重新推导 GTA 内存偏移需重新获取 plugin-sdk） |

## 2. 目录结构

```
GTASA-StuntTools/
  README.md / HANDOFF.md / AGENTS.md
  GTA San Andreas/                    游戏；录制器与 flight_recordings/ 都在这里
  recorder/
    src/FlightRecorderASI.cpp         录制器 v6 源（无 CLEO opcode）
    build.ps1 / install.ps1           zig 编译 / 安装（安装前自动备份到 recorder/backups）
    README.md                          字段与规则
  web-replay/
    local-server.mjs                   静态页 + /game-src（含 Range）+ /local-recording + /webgpu-report
    dist/opensa/                       构建产物（flight-replay.html + assets）
    启动本地回放.cmd / backups/
  tools/
    opensa/                            OpenSA 源码 + 本项目的 flight app
      build-flight-replay.ps1           构建并发布到 web-replay/dist/opensa
      vite.flight.config.ts             只构建 flight-replay 入口
      public/webgpu-check.html          WebGPU 诊断页（结果 POST 到 /webgpu-report）
      scripts/                          自测脚本（见 §6）
    zig/
  （根目录还有）启动本地回放.cmd / 启动回放-Chrome.cmd / 重置回放浏览器配置.cmd / 修复Chrome-WebGPU缓存.cmd
```

## 3. 构建 / 运行 / 自测（命令）

```powershell
# 录制器（如改了 cpp）
cd recorder
powershell -ExecutionPolicy Bypass -File .\build.ps1      # 产出 32 位 PE，脚本校验 machine=0x014C
powershell -ExecutionPolicy Bypass -File .\install.ps1    # 装到游戏目录（覆盖前备份）

# 回放页（如改了 app）
cd tools\opensa
npm install --ignore-scripts --no-audit --no-fund          # 首次
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1

# 运行
cd web-replay  &&  .\启动本地回放.cmd
# 打开 http://127.0.0.1:4173/?local=latest   （或直接拖 CSV 到页面）

# 类型检查（本机实测 0 错误）
cd tools\opensa  &&  npx tsc --noEmit -p tsconfig.json
```

自测脚本（都在 `tools/opensa`，均**自结束自己启动的 Chrome**）：

```powershell
# Route A：本地离线烘焙整张图（也可只烘一个矩形：minCx maxCx minCy maxCy）
cd tools\opensa
npx tsx scripts\bake-map.mts map-pak                 # 整图 → map-pak\（约 40s，~760MB）
npx tsx scripts\bake-map.mts map-pak -4 2 1 7        # 只烘一个 cell 矩形
```
烘焙产物由本地服务以 `/map-pak/*` 提供（`MAP_PAK_ROOT` 可覆盖，默认 `../tools/opensa/map-pak`）；回放页启动时若探测到 `/map-pak/index.json` 就自动用 pak，否则回退原始安装实时焊接。**装了地图 mod 后需重新烘焙。**

```powershell
node scripts\smoke-map.mts            # tsx 跑；GPU 无关，验证 IMG/IDE/IPL/DFF/TXD→cell 焊接
node scripts\capture-replay.mjs  "<url>" 30     # 连续截图 + 控制台
node scripts\test-replay-sequence.mjs "<url>" <tag>  # 播放/机舱/跟随/拖动全流程截图
node scripts\capture-cockpit.mjs <tag>          # 机舱单帧（唯一文件名）
node scripts\test-hud.mjs                       # 天气/时间 HUD 滑块：录制裁剪对比 + 截图
node scripts\test-multitrack.mjs                # 导入 3 个 CSV 并逐个切换（复现/验证多文件黑屏）
node scripts\soak-replay.mjs   "<url>" 150        # 长跑压测（查 GPU TDR）；第3参=秒，第4参=速度(默认4)
node scripts\probe-webgpu-chrome.mjs 4199        # 逐组 Chrome 参数实测适配器
```

**配置一律走 HUD，不要靠 URL 参数**（URL 参数仅作为脚本测试的可选覆盖保留；不填参数时页面自动载入最新本地记录）。播放条下的 HUD：

- 天气/时间滑块 + `跟随录制`：即时切换环境（见下）。
- `载入最新记录`：重新拉取 `flight-recordings` 最新 CSV。
- `高清半径`(100–1200, 默认 450) / `远景半径`(300–3000, 默认 1200)：流送半径，改动会清空准备队列并按新半径重算。
- `分辨率`(0.5–1.0)：`engine.renderScale`。
- `后台准备`(开关) / `每批`(10–200, 默认 60) / `间隔`(250–3000ms, 默认 1000)：后台航迹准备的批量与节奏。
- `调试轴`：显示飞机 forward/up/right 三色世界线（绿/蓝/红），用于判定模型朝向。

脚本测试仍可用可选 URL 覆盖：`?src=/game-src`、`?hd=`/`?lod=`、`?scale=`、`?axes=1`、`?weather=`/`?hour=`、`?prepare=0`、`?budget=`/`?prepareInterval=`。

**天气/时间 HUD**：播放条下方有两根滑块（天气 0–22、时间 0–24，步进 0.25）与 `跟随录制` 勾选框。滑块即时生效（天气变化会重建环境驱动）；取消“跟随录制”会**冻结在当前值**再交给滑块。实时数据里的 `环境(显示)` 行显示生效值及来源。状态探针：`debug.envHud`（`hud/force/rec/eff`）。实现见 `applyEnvironment()` 与 `syncEnvControls()`。

## 4. 关键架构与已完成

- **录制器 v6**（`recorder/src/FlightRecorderASI.cpp`）：独立 ASI，25Hz，仅 520/476；进入即录、下车/爆炸/失效/换机/QuickHome(≥120m/采样) 切档。v6 额外写：
  - `game_hour/minute/second`（`CClock`）与 `weather_new/old/forced`（`CWeather`）；
  - **真实动画节点四元数**（`CPlane::m_aCarNodes` 的 `RwFrame` 局部建模矩阵，7 个：rudder/elevator_l,elevator_r,aileron_l,aileron_r,gear_l,gear_r），用 `node_status` 位掩码 + `surface_source=real|partial|inferred` 标注。
  - **诚实规则**：Q/A/E/D/上下键是输入列；真实节点读不到就写 `nan` 且标 `inferred`，绝不把按键伪装成舵面。
- **地图流送**（`apps/web/src/flight/`）：OpenSA `loadMapSource` 读 `gta.dat` 全部 IDE/IPL + IMG 二进制 `*_streamN.ipl`；按 300m cell 用 `weldCell` 焊接，HD 近 + LOD 远。实测：**562 cells / 50849 instances / 14098 models**，中心 cell 焊出 17770 顶点/13189 三角。
- **姿态**：从 CSV 的 right/up/forward 正交基构造四元数并 SLERP；GTA→引擎换轴只在 `flight/math.ts:gtaToEngine` 一处。
- **环境**：`water.dat` + `timecyc.dat`，时间取 CSV 游戏时钟、天气取 `weather_*`（v5 旧文件无这些字段→回退参数化晴天中午，界面显示 `—:00`）。
- **飞机**：真实 `hydra.dff`/`rustler.dff` + TXD，经 OpenSA `buildVehicleModel` 上传；颜色取 `carcols.dat`。

## 5. 已踩的坑与根因（务必不要重犯）

1. **Chrome WebGPU 配置会被写坏**：同一个 Chrome，**全新 profile** `requestAdapter` 正常返回 Arc D3D12；**日常/被强杀过的 profile** 返回 `null`（日志 `SharedTextureMemory::BeginAccess() failed` / `Error creating wgpu::Texture`）。
   - 应对：`local-server.mjs` 的 `openBrowser` 与 `启动回放-Chrome.cmd` **每次用全新临时 profile**；测试脚本用 `tmpdir()` 唯一 profile。
   - **绝不要 `taskkill /F` 一个会被复用的 profile**（会把 GPU 缓存写坏）。强杀只对自己当次创建的临时 profile 用。
   - 日常 profile 想修：`修复Chrome-WebGPU缓存.cmd`（关掉 Chrome 后**重命名** GPU/Dawn 缓存目录，可回溯）。
2. **黑屏/TDR 的根因（结构性，读引擎源码确认）**：世界贴图存在 `texture_2d_array`，`TextureArrays.load()` 是**幂等**的（已存在即返回），因此数组**只能靠 `unload()`+`load()` 增长** → **替换 GPUTexture** → 所有引用它的 render bundle 立即失效。在 Intel Arc 上**反复替换、或一次性同步上传大数组都会 `DXGI_ERROR_DEVICE_HUNG`**（后者是 Route A 早期实现也黑的原因：一次同步上传 240MB 纹理）。
   - **Route A（默认，推荐）**：本地离线烘焙 → `CellRenderer/PakWorld` 运行期只读字节、**分帧上传、零替换**。见下方“地图来源”。
   - **原始安装回退**：找不到 `/map-pak/index.json` 时走实时焊接（`CellRenderer`），此时选中录像会一次性提交该航迹纹理（安全但慢）。
   - **必须保留的修复**：任何替换数组前**先卸载全部常驻 cell**；**所有纹理上传走 `engine.textures.beginLoad()` + 每帧 `drainUploads(budget)`**，禁止一次性同步 `load()` 大数组。`PakWorld` 每帧地块创建并发 `MAX_PARALLEL_LOADS=2`（一次创建太多 render bundle 也会触发驱动重置）。
3. **相机**：
   - `ReplayCamera` 有自己的 `mode`，切换视角时必须同步 `camera.mode`（只改模块变量会导致两视角相同）。
   - 追尾相机高度是 **`+ WORLD_UP×height`**（写成减号会跑到机腹下变仰视）。
   - **相机的 forward/up/right 必须从 SLERP 后的 `pose.orientation` 旋转本地轴得到**（`rotateVec(q,[0,1,0]/[0,0,1]/[1,0,0])`），**不要**直接用未插值的 `pose.row.forward/up/right`——原始采样只有 25Hz，桶滚时每帧跳变会让机舱相对机身抖动。验证方法：`debug.maxUpStepDeg`（每帧 up 轴最大转角）在 1× 约 6°、4× 约 25°（等比即正确；速度无关的大跳变才是抖动）。
4. **模型朝向**：用**直接基** `quatToMatrix(orientation)`（identity 时等于引擎自带 ROOT）。`?axes=1` 可视化判定；不要凭肉眼猜。
5. **机舱相机**锚定到真实座舱零件（Hydra 是 `door_lf`，见 `parts` 探针）；且必须 `engine.updateVehicles()` **在求相机之前**（否则读到上一帧零件矩阵）。
6. **`@opensa/renderware` 桶文件在 Node ESM(tsx) 下丢失 `./map` 再导出**：脚本里请用子路径导入（`@opensa/renderware/map/world-grid` 等）。
7. **PowerShell 5.1 会把无 BOM 的 UTF-8 `.ps1` 当 ANSI 读**：`.ps1` 只写 ASCII 注释，否则解析报错。
8. **端口占用陷阱**：若 4173 上跑的是**另一个 checkout 的**服务，页面会 404/看到旧版。`local-server.mjs` 的 EADDRINUSE 分支会探测并提示“不是本项目服务”。
9. **时间轴拖动**：必须每帧同步 `scrub.max = duration`，否则拖动被钳到 0。
10. **回放页启动阶段**会上报 `/webgpu-report`（`engine-ready → world-indexed → loop-started`），用于远程判断引擎是否真的起来。
11. **约 2 次/秒的顿感（桶滚时最明显）= 纹理数组每 tick 被重编码**：`TexturePlanner.build()` 每次都会 `encodeArray`/`packOstexPayload` **重编码全部数组**（全量分配+拷贝）；`CellRenderer.syncTextures()` 在每次流送都调它，而 `requestStream` 旧逻辑**每 500 ms 强制流送一次**（时间阈值），正好 2 Hz 主线程卡顿。
    - 修法：`CellRenderer.texturesDirty` 仅在**真的焊到新地块**时才重建；`requestStream` 改为**按所在 cell 变化**触发（不是按时间）。
    - 量化判据：`debug.maxFrameMs`（播放中最大帧时长）与 `debug.slowFrames`（>30ms 帧数）。1× 跑 40s 实测 `slowFrames=0`。
12. **录制器“进了游戏却没有 CSV” = 与 CLEO 的挂钩竞态**：CLEO 会在**它自己初始化时**替换同一个 game-process 调用（`0x53E981`），且初始化时刻不固定（实测 4.8s），旧代码固定 `Sleep(3000)` 去“等 CLEO”，结果被 CLEO 覆盖 → 回调再也不被调用（`FlightRecorder.asi.log` 只有 ASI loaded/unloaded，无任何 `diagnostic`，无 CSV）。
    - 修法：`recorder/src/FlightRecorderASI.cpp` 用**看门狗线程**每秒检查该调用是否仍指向我们，被改写就重新挂钩并把新目标链进 trampoline（`gOriginalGameProcess`，支持 0xE8 CALL 与 0xE9 JMP）；并加 `heartbeat calls=…` 日志确认回调在跑。
    - 排查顺序：先看 `FlightRecorder.asi.log` 是否有 `heartbeat` / `diagnostic` 行——没有 `heartbeat` 说明回调没被调用（挂钩问题），有 `heartbeat` 但无 CSV 说明是在 `captureSample`/目标机型判断处（例如驾驶的不是 520/476）。
13. **多文件切换黑屏 = `preloadTargets` 增长纹理数组后没重建常驻 cell**：`syncTextures()` 在数组增长时会**销毁旧纹理并上传新数组**，所有已驻留 cell 的 render bundle 随即引用已销毁纹理（控制台 `Destroyed texture [...] used in a submit` → `DXGI_ERROR_DEVICE_HUNG` → 黑屏）。`setTargets()` 用 `loadCells()` 重建了，但 `preloadTargets()` 漏了，于是**切换/新增录像**触发预焊增长就黑屏。
    - 修法：`preloadTargets()` 中 `syncTextures()` 返回 changed 时调用 `recreateResident()`（从缓存重建全部常驻 cell）。
    - 复现/验证脚本：`node scripts/test-multitrack.mjs`（导入 3 个 CSV 后逐个切换并截图）。
    - 相关：切换时会显示预焊进度覆盖层（大航迹可能数百个 cell，几十秒）；这属正常，不是卡死。

## 6. 数据格式（CSV）

列名驱动、**向后兼容 v4/v5**（缺列为 `null`）。v6 表头（顺序）：
`local_timestamp,model,health,x,y,z,heading_deg,right_x/y/z,up_x/y/z,forward_x/y/z,vx,vy,vz,ax,ay,az,steer,throttle,brake,color_primary/secondary/tertiary/quaternary,landing_gear_status,key_q,key_a,key_e,key_d,key_up,key_down,game_hour,game_minute,game_second,weather_new,weather_old,weather_forced,node_status,surface_source,` 然后 7 组 `<node>_qx,qy,qz,qw`（rudder,elevator_l,elevator_r,aileron_l,aileron_r,gear_l,gear_r）。
`node_status` 位：0 rudder、1 elevator_l、2 elevator_r、3 aileron_l、4 aileron_r、5 gear_l、6 gear_r；该位为 0 时四元数写 `nan`。
文件以 `# session_start,…` 开头、`# session_end,<reason>,…` 结束。旧 v5 无游戏时钟/天气/节点列。

## 7. 当前状态与遗留

**已实测通过**：地图管线（562 cells 焊接）、引擎启动（`loop-started`）、播放/暂停/重启/逐帧/拖动/速度、两种视角切换且不同、机舱过鼻视角、150s 全程无 TDR 黑屏、服务接口（`/`、`/opensa/*`、`/game-src/__index`+Range、`/local-recording/latest.csv`）、`tsc` 0 错误。

**待办 / 风险**：
- **v6 录制已在本机实测通过**（CLEO 竞态修复后）：`node_status=127`、`surface_source=real`、真实游戏时钟/天气，回放 1× 30s `slowFrames=0`、无 TDR。若再出现“进游戏无 CSV”，按 §5 第 12 条看 `heartbeat`。
- OpenSA 只合并 `models/*.img`，**SA-MP 的 `SAMP.img`/`custom.img` 覆盖模型不生效**；若服务器用自定义 Hydra/Rustler 需评估。
- 机舱锚点目前按零件名 `door_lf`；Rustler 的座舱零件名未确认，回退到 `chassis`。
- Rustler/其它机型的 `CPlane` 节点可能不足 7 个，`surface_source` 会退化为 `partial`（属正常，界面已标注）。
- `stream.firstLoad`/旧加载覆盖层逻辑与预焊流程并存，后续可清理。

## 8. 架构变更：**仅 pak**（2026-09-21，取代第 2 条中的“原始安装回退”）

用户决定彻底删除“原始安装实时焊接”这条路，回放**必须**使用预烘焙 pak。已删除：

- app 侧：`apps/web/src/flight/cell-renderer.ts`（`CellRenderer` 实时焊接器）已删除；`flight-replay.ts` 移除
  `requestStream/drainStream/buildCellTargets`、后台准备泵（`pumpPrepare/buildRouteTargets/prepareState`）、
  `DYNAMIC_LOAD/PREPARE_*`，以及 HUD 的 `动态加载(实验)/后台准备/每批/间隔` 与 `航迹准备` 行。
- 启动时若 `/map-pak/index.json` 不存在 → 直接提示并停止（显示烘焙命令），不再回退。
- 仍需读安装的小文件：`data/timecyc.dat`、`data/water.dat`、`data/carcols.dat`、飞机 DFF/TXD（经 `loadMapSource`），
  这不属于“地图流送”，保留。

保留的关键修复：`PakWorld` 用 `engine.textures.beginLoad()` + 每帧 `drainUploads(budget)`（分帧上传、**零数组替换**）、
每帧地块创建并发 `MAX_PARALLEL_LOADS=2`、`device.lost` 监听（自动重启渲染 + 每分钟一次上限）。

第 2 条与第 13 条里“原始安装回退 / preloadTargets 顺序修复”的描述**已作废**，仅作历史记录。

## 9. 交接速查
- 目标：录制→CSV→浏览器 WebGPU 回放；**不分发游戏资源**；OpenSA 为 AGPL-3.0。
- 改动后：`build-flight-replay.ps1` 发布，`tsc --noEmit` 必须 0 错误，跑对应 `scripts/*` 自测并看截图。
- 原则：**先定位根因再改**（本项目多个 bug 都来自符号/状态未同步/架构性增长，而非表面参数）；不要靠加大半径或强杀进程掩盖。
