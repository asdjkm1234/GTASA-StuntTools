# HANDOFF — GTASA StuntTools（特技飞行录制 + WebGPU 3D 回放）

> 接手先读这一份。它是这个项目的唯一上下文来源：目标、结构、已完成、**已踩过的坑与根因**、如何构建/运行/自测、以及下一步。
> 同目录 `README.md` 是用户向说明；本文件是工程/交接说明。两者冲突时以本文件和代码为准。

## 0. 一句话

在 GTA SA / SA-MP 里常驻录制 Hydra(520)/Rustler(476) 的飞行数据成 CSV，再用 **OpenSA 的 WebGPU 引擎**
读取本地预烘焙 pak 在浏览器里 3D 回放。烘焙时读取用户自己的 GTA 安装；回放时只需 pak 和 CSV。
全部本地运行，不分发任何游戏资源。

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
    src/FlightRecorderASI.cpp         录制器 v7 源（无 CLEO opcode）
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
烘焙产物由本地服务以 `/map-pak/*` 提供（`MAP_PAK_ROOT` 可覆盖，默认 `../tools/opensa/map-pak`）。
pak 包含地图、Hydra(520)/Rustler(476) 模型和贴图，以及 `timecyc.dat`、`water.dat`、`vehicles.ide`、`carcols.dat`；
回放必须有新版 pak，运行时不读取 GTA 安装。旧版 pak、地图或飞机 mod 更新后需重新烘焙。
游戏安装只在烘焙时读取，`/game-src` 首次被烘焙器请求时才建立索引。录像不在游戏目录时可用 `RECORDINGS_ROOT` 指定 CSV 文件夹，也可直接拖入 CSV。

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
- 页面启动时自动载入 `flight-recordings` 最新 CSV。
- 地图流送半径固定为高清 1200、远景 3000；回放使用原生渲染比例 `engine.renderScale=1`。
- `调试轴`：显示飞机 forward/up/right 三色世界线（绿/蓝/红），用于判定模型朝向。

脚本测试仍可用可选 URL 覆盖：`?axes=1`、`?weather=`/`?hour=`。旧 `?src=` 已不再使用。

**天气/时间 HUD**：播放条下方有两根滑块（天气 0–22、时间 0–24，步进 0.25）与 `跟随录制` 勾选框。滑块即时生效（天气变化会重建环境驱动）；取消“跟随录制”会**冻结在当前值**再交给滑块。实时数据里的 `环境(显示)` 行显示生效值及来源。状态探针：`debug.envHud`（`hud/force/rec/eff`）。实现见 `applyEnvironment()` 与 `syncEnvControls()`。

## 4. 关键架构与已完成

- **录制器 v7**（`recorder/src/FlightRecorderASI.cpp`）：独立 ASI，25Hz，仅 520/476；进入即录、下车/爆炸/失效/换机/QuickHome(≥120m/采样) 切档。保留 v6 字段，并额外记录 Hydra `misc_a`/`misc_b` 的局部四元数、局部位置与有效位；v6 原有字段包括：
  - `game_hour/minute/second`（`CClock`）与 `weather_new/old/forced`（`CWeather`）；
  - **真实动画节点四元数**（`CPlane::m_aCarNodes` 的 `RwFrame` 局部建模矩阵，7 个：rudder/elevator_l,elevator_r,aileron_l,aileron_r,gear_l,gear_r），用 `node_status` 位掩码 + `surface_source=real|partial|inferred` 标注。
  - **诚实规则**：Q/A/E/D/上下键是输入列；真实节点读不到就写 `nan` 且标 `inferred`，绝不把按键伪装成舵面。
- **地图烘焙与流送**（`apps/web/src/flight/`）：烘焙器用 `loadMapSource` 读 `gta.dat` 全部 IDE/IPL + IMG 二进制 `*_streamN.ipl`，按 300m cell 用 `weldCell` 焊接；回放只流送 pak 中的 HD 近 + LOD 远。实测：**562 cells / 50849 instances / 14098 models**，中心 cell 焊出 17770 顶点/13189 三角。
- **姿态**：从 CSV 的 right/up/forward 正交基构造四元数并 SLERP；GTA→引擎换轴只在 `flight/math.ts:gtaToEngine` 一处。
- **环境**：`water.dat` + `timecyc.dat`，时间取 CSV 游戏时钟、天气取 `weather_*`（v5 旧文件无这些字段→回退参数化晴天中午，界面显示 `—:00`）。
- **飞机**：pak 内的真实 `hydra.dff`/`rustler.dff` + TXD，经 OpenSA `buildVehicleModel` 上传；颜色取 pak 内 `carcols.dat`。

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
14. **Hydra 回放轮子偏大 + 收起起落架时轮子不跟随 = 两处配置/关系丢失**（2026-09-25）：
    - 现象：回放轮子比原版明显大；`landing_gear_status` 从 0→1 时 `gear_l/gear_r`（真实节点四元数，绕 X 约 −90°）已正确收起，但主轮仍停在原位。
    - 根因一：`apps/web/src/flight/aircraft.ts` 写死 `wheelScale: [1, 1]`，而本机 `vehicles.ide` 中 Hydra(520) 是 `0.7, 0.3`（前/后直径，米）。`buildVehicleModel` 的 `wheelFit()` 把 `wheelScale` 当作“轮子直径（米）”去归一化真实网格（见 `build-vehicle-model.ts` 注释），于是 `[1,1]` 把网格放大成半径 0.5 m 而非 0.15/0.35 m，视觉偏大。
    - 根因二：引擎（`RigidEntity`）每帧把每个 part 扁平化为 `root × T × R × S`，父子关系在 GPU 上丢失（截面/仓门/起落架都是“扁平 + 相对绑定旋转”的补偿）。Hydra 的主轮挂在起落架支架下（`wheel_rb_dummy → gear_r`、`wheel_lf_dummy → misc_b`、`wheel_rf_dummy → misc_a`），支架收起时轮子不会跟着动。
    - 修法：`aircraft.ts` 用 `parseVehicleDefs` 读 `data/vehicles.ide` 取该模型的 `wheelScale`；`buildVehicleModel` 在 `VehicleModelPart` 上记录 `parent`（最近祖先 part），`aircraft.ts` 在 `applyNodes` 里对该 part 的子树做刚性携带（把已用于门成员的数学推广到任意孩子，`world` 逐层下传）。父级动画 = `q ⊗ anim ⊗ q⁻¹`，子级 = `conj(childQ) ⊗ world ⊗ childQ` + 绕父 pivot 的平移修正。
    - 注意：`wheel_lm_dummy`/`wheel_rm_dummy` 是**带网格的 dummy 帧**（不是轮子），也未被动画，故不应被携带——`parent` 只记录“最近祖先 part”，不受同帧多 part 影响。
    - 验证：同一录像 `flight_20260925_170435_271_m520_001.csv`（Hydra，前 1.7 s 收放起落架），对照原版 MP4 逐帧截图；`debug.parts` 显示 20 个 part，`wheel_rb/wheel_lb → gear`、`wheel_lf → misc_b`、`wheel_rf → misc_a`；`tsc` 0 错误，`capture-replay` 20 s 无 TDR。
15. **边玩边回放时 `?local=latest` 失败 = 服务端读到正在写入的最新录像**（2026-09-25）：
    - 现象：页面先正常，几秒后 `启动失败：Failed to fetch`（控制台 `ERR_CONTENT_LENGTH_MISMATCH`）。
    - 根因：`web-replay/local-server.mjs` 的 `/local-recording/latest.csv` 永远返回 mtime 最新的文件；玩家在游戏里录制时该文件仍在追加，`createReadStream` 读到一半长度变了，浏览器按 Content-Length 校验中断。
    - 修法：`chooseSettledRecording()`——间隔 120 ms 两次 stat，若最新文件大小在变（仍在写入）就回退到**最新一个已写完的**录像；全部都在写才退回最新。无需手动选文件。
    - 验证：一边向最新 CSV 追加、一边请求该路由，返回的是已写完的旧录像（不含追加内容），`?local=latest` 30 s 正常载入。

## 6. 数据格式（CSV）

列名驱动、**向后兼容 v4/v5/v6**（缺列为 `null`）。v6 基础表头（顺序）：
`local_timestamp,model,health,x,y,z,heading_deg,right_x/y/z,up_x/y/z,forward_x/y/z,vx,vy,vz,ax,ay,az,steer,throttle,brake,color_primary/secondary/tertiary/quaternary,landing_gear_status,key_q,key_a,key_e,key_d,key_up,key_down,game_hour,game_minute,game_second,weather_new,weather_old,weather_forced,node_status,surface_source,` 然后 7 组 `<node>_qx,qy,qz,qw`（rudder,elevator_l,elevator_r,aileron_l,aileron_r,gear_l,gear_r）。
`node_status` 位：0 rudder、1 elevator_l、2 elevator_r、3 aileron_l、4 aileron_r、5 gear_l、6 gear_r；该位为 0 时四元数写 `nan`。
文件以 `# session_start,…` 开头、`# session_end,<reason>,…` 结束。旧 v5 无游戏时钟/天气/节点列。
v7 在相机调试列之后追加 `center_gear_status`、`misc_a` 与 `misc_b` 各自的 `qx/qy/qz/qw/x/y/z`。2026-09-26 的完整收放录像表明两节点每帧都可读、位置不变，收起角分别为 −80°、+130°；回放优先使用实测四元数，旧 CSV 按该角度和收轮进度补全。

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
- 2026-09-26 后，小文件 `timecyc.dat`、`water.dat`、`vehicles.ide`、`carcols.dat` 和两架飞机 DFF/TXD
  也在一次烘焙中写入 pak；回放不再执行 `loadMapSource` 或建立游戏目录索引。

保留的关键修复：`PakWorld` 用 `engine.textures.beginLoad()` + 每帧 `drainUploads(budget)`（分帧上传、**零数组替换**）、
每帧地块创建并发 `MAX_PARALLEL_LOADS=2`、`device.lost` 监听（自动重启渲染 + 每分钟一次上限）。

第 2 条与第 13 条里“原始安装回退 / preloadTargets 顺序修复”的描述**已作废**，仅作历史记录。

## 9. 交接速查
- 目标：录制→CSV→浏览器 WebGPU 回放；**不分发游戏资源**；OpenSA 为 AGPL-3.0。
- 改动后：`build-flight-replay.ps1` 发布，`tsc --noEmit` 必须 0 错误，跑对应 `scripts/*` 自测并看截图。
- 原则：**先定位根因再改**（本项目多个 bug 都来自符号/状态未同步/架构性增长，而非表面参数）；不要靠加大半径或强杀进程掩盖。

## 10. v1.0 版本与接续开发（git tag: `v1.0`）

**版本状态**：路线 A（仅 pak）完成并通过本机验证。配置全部走 HUD，不再依赖 URL 参数；回放**必须**有预烘焙 pak。

数据路径：`npx tsx scripts/bake-map.mts map-pak` → `map-pak/` →`local-server.mjs` 的 `/map-pak/*` → `PakWorld` + `PakResources`（分帧上传、零数组替换）。

**已实测通过**：`tsc --noEmit` 0 错误；pak 模式单文件 / 多文件切换 / 大文件拖动 / 60s@4× 均**无 DXGI**；
播放/暂停/重启/逐帧/拖动/速度、延迟跟随↔机舱、天气/时间/调试轴 HUD 均正常；服务接口正常。当前回放固定原生分辨率。

**已知环境问题**：Intel Arc 驱动偶发 `DXGI_ERROR_DEVICE_HUNG`（黑屏）——应用会**自动重启渲染**（每分钟最多一次）；这不是数据 bug（见 §5 第 2 条）。

### 下一对话/下一个 AI 的入口
- 录制器：`recorder/src/FlightRecorderASI.cpp`（`build.ps1`/`install.ps1`，用 `tools/zig`）。
- 回放 app：`tools/opensa/apps/web/src/standalone/flight-replay.ts` + `apps/web/src/flight/{pak-world,pak-resources,camera,csv,aircraft,math}.ts`。`map-source`/`asset-store` 仅供烘焙器用。
- 烘焙器：`tools/opensa/scripts/bake-map.mts`。
- 服务：`web-replay/local-server.mjs`（`/map-pak`、`/game-src`、`/local-recording/latest.csv`、`/webgpu-report`）。
- 启动：双击 `start-replay.cmd` → `http://127.0.0.1:4173/`（无参数自动载入最新录像）。
- 自测：`tools/opensa/scripts/{bake-map.mts, smoke-map.mts, capture-replay, test-multitrack, test-scrub, soak-replay, test-hud, test-standalone-pak}`。

### 建议的下一步（按优先级）
1. **烘焙瘦身**：只烘“录像航迹附近”的 cell（按 CSV 轨迹包围盒）→ pak 从 ~760MB 降到几十 MB；可加 HUD“一键烘焙”。
2. **画质总开关**：一键关 bloom/godrays/云层，进一步降低驱动重置概率。
3. **Route B（可选）**：给引擎加“就地追加层”，以支持真正无需预烘焙的动态流送。
4. **兼容性**：SA-MP `SAMP.img/custom.img` 覆盖模型的烘焙；Rustler(476) 的座舱锚点与节点数。

### 硬性约束（务必遵守）
见 `AGENTS.md` 与 §5。每次改完必须：`npx tsc --noEmit -p tsconfig.json`（0 错误）→ `build-flight-replay.ps1` 发布 →
跑对应 `scripts/*` 自测并看截图。纹理上传只能走 `beginLoad`+`drainUploads`；`.cmd/.ps1` 只写 ASCII。

## 11. 2026-09-26：回放脱离游戏安装

- 同一次 `bake-map.mts` 烘焙写入完整地图、碰撞、纹理、`data/{timecyc.dat,water.dat,vehicles.ide,carcols.dat}`
  和 `aircraft/{hydra,rustler}.{dff,txd}`、共享 `aircraft/vehicle.txd`，`index.json` 用 `replayAssets.version=2` 标识。只打包 520/476；
  录制器的 `isTrackedModel` 也只接受 520/476，其他载具不会生成录像。
- 回放 app 用 `PakResources` 读取上述小文件和飞机；不再调用 `loadMapSource`。服务只在烘焙器请求
  `/game-src/*` 时建立 GTA 文件索引。没有 GTA 安装时，服务仍能从 pak 加载地图和两架飞机。
- 重新烘焙后 pak 大小约 828 MB（本机整图）。验证方式：将测试服务的 `GAME_ROOT` 指向不存在的目录，
  用 `RECORDINGS_ROOT` 指向已有 CSV，运行 `scripts/test-standalone-pak.mjs <Hydra CSV>`。该脚本在临时 Chrome
  profile 中分别载入真实 Hydra CSV 与把模型 ID 临时改为 476 的测试数据，检查两架飞机可渲染、无游戏目录请求，
  并输出两张截图到 `captures/`。Rustler 的真实飞行/动画仍需真实 476 录像核对。

### Hydra/Rustler 贴图与重叠修复

- 原因一：`engine.createVehicle()` 默认把所有子网格设为可见；Hydra 有 4 片、Rustler 有 5 片
  `chassis_vlo` 远景简化模型，同时压在精细机身和活动舵面上。回放创建飞机和从第一人称返回时，
  只显示 `kind=body` 的精细子网格；隐藏 `lod`/`dam`。
- 原因二：两机 DFF 都引用 `vehiclegeneric256`，Rustler 还引用 `vehicletyres128`；这些贴图在
  `models/generic/vehicle.txd` 而不在各自的 TXD。新版 pak 一并烘焙共享 TXD，加载飞机时按
  “飞机 TXD 优先、共享 TXD 补缺”的顺序构造 `VehicleTextures`。旧 pak 必须重新烘焙。
- 用 Hydra 真实录像 `flight_20260925_232431_484_m520_002.csv` 的 00:58.817 截图检查近景；
  第一人称切回第三人称后仍保持精细模型。Rustler 用同一 CSV 临时改模型 ID 做模型/贴图冒烟测试，
  不等同于真实 Rustler 动画核对。

## 11. 镜头对照调试（临时）

- 三档跟随镜头现参考 SACarCam 的飞机参数和有状态的目标/视点历史、水平/垂直角平滑；第一人称和机舱镜头保持独立。
- v6/v7 历史调试录像在 CSV 中带有 `camera_*` 列，文件头标记 `camera_debug=1`；V1.1 新录像已暂时关闭相机调试列（`camera_debug=0`）。录制器源码保留在 `FLIGHT_RECORDER_CAMERA_DEBUG` 编译开关后。
  `camera_valid` 对应活动 CCam；`camera_matrix_valid` 对应最终 CCamera 矩阵。两者按现有飞机采样节奏
  约 25 Hz 同步读取，不要把它误认为每一渲染帧的精确镜头轨迹。
- 用户会在不动鼠标的情况下录制几段第一人称和第三人称飞行。取得新 CSV 后先确认 valid 值和
  活动镜头模式/缩放，再对齐原版镜头与回放；调试完成后移除这些临时列。
- 2026-09-25 的 `flight_20260925_142533_893_m520_001.csv` 有 1951 个有效镜头样本，均为第三人称中档。
  `scripts/analyze-camera-trace.mts <csv>` 比较原版活动 CCam 与回放。由该记录量出 Hydra 原版目标高度
  约 0.84104 米、跟随距离约 20.559 米；镜头按游戏实测约 100 Hz 的固定时步预计算，避免浏览器
  刷新率改变跟随结果。调好后此段位置误差中位数约 0.08 米、方向误差中位数约 0.21°；近地面碰撞
  仍有偏差。当时将原版 70° 水平 FOV 直接按网页宽高比换算成引擎的垂直 FOV，画面里的飞机
  因此比旧版更大；随后又发现游戏的宽屏插件会修正这个 FOV，见下条。第一人称、近档和远档
  尚无原版镜头样本，不能声称已校准。
- 2026-09-25 用游戏 1920×1080 与回放 1920×945 的同地点截图发现飞机显宽。游戏安装了
  `GTASA.WidescreenFix.asi`，`DontTouchFOV=0`；CCam 调试列的 70° 仍是宽屏修正前的值。
  回放第三人称现按该插件的 4:3 基准先换算到游戏显示器宽高比，再换算到浏览器画布宽高比。
  因此同为 1920 像素宽时，网页窗口高 1080 或 945 不会改变飞机的横向像素大小；第一人称和机舱镜头未动。
  对照脚本：`node scripts/capture-camera-reference.mjs <csv> <tag>`，会用独立 Chrome profile 输出两张截图。
- 上述截图不能据此改飞机模型尺寸：回放根矩阵没有缩放，飞机仍是本机 `hydra.dff`。
  修正视野后起始帧飞机仍偏小。已有相近机场的原版镜头记录前约 2 秒相机离飞机约 18.1 米，
  回放则固定 20.56 米；约 3 秒时原版恢复到约 20.5 米。很可能是附近场景导致原版镜头临时缩近，
  但该录像没有 `camera_debug` 列，不能把这个数值作为所有录像的通用距离。后续须实现镜头碰撞，
  或取得同一画面带镜头调试列的记录再校准。

## 12. 2026-09-25 启动黑屏复现

- 冷启动复现 Chrome/Dawn `DXGI_ERROR_DEVICE_HUNG`。同一页面启动记录显示：98 组 pak 纹理已排队，
  渲染 29 帧后 WebGPU `device-lost`，当时纹理尚未就绪、地块数为 0。因此这次黑屏发生在纹理上传期，
  与录像 CSV 和地图地块加载无关。
- 旧的 6ms CPU 上传预算不能限制 GPU 队列积压。`PakWorld.pump()` 现在每批使用 1ms CPU 预算，
  并等 `GPUQueue.onSubmittedWorkDone()` 确认显卡完成上一批后再提交下一批；仍只用
  `beginLoad()` + `drainUploads()`，且不替换常驻纹理数组。
- `web-replay/local-server.mjs` 现在把带时间的启动阶段和设备丢失记录追加到 gitignored 的
  `web-replay/webgpu-events.jsonl`；每个页面启动有独立 `bootId`，丢失事件含纹理/地块进度。
  已有 4173 服务必须退出后重新运行启动脚本，才会加载新的服务端日志代码。
- 修复后两次全新 Chrome 启动（其中一次完整切换视角和拖动进度）无设备丢失、截图正常。
  间歇性问题不能由两次成功证明彻底消失；若用户仍遇到黑屏，先读事件日志按 `bootId` 对照阶段。

## 13. V1.1 发布

- 版本主题：修复第三人称视角和 Hydra 起落架。第三人称有近、中、远三档；机身中线起落架在 v7 CSV 中使用 `misc_a`/`misc_b` 的实测四元数，旧 CSV 使用原版收放录像量得的 −80°/+130° 补全。
- 录制器仍为 v7 格式，但 V1.1 暂时不采集或写出相机调试数据。文件头为 `camera_debug=0`，没有 `camera_*` 列，起落架和其他飞行列继续保留。要恢复相机调试，把 `recorder/src/FlightRecorderASI.cpp` 中的 `FLIGHT_RECORDER_CAMERA_DEBUG` 改为 1 后重新构建、安装。
- V1.1 发布标签使用大写 `V1.1`；历史 v1.0 标签保持原样。

## 14. 航迹 pak（2026-09-26）

- HUD“烘焙当前航迹”把选中的 CSV 发给仅监听本机的服务；服务调用 `bake-map.mts --recording <csv>`，按航迹线段附近 1200 单位筛选地图和相机碰撞 cell，重新规划纹理数组，完成后自动切换到独立 pak 和该 CSV。整图 `map-pak/` 不变；航迹包保存在 gitignored 的 `tools/opensa/map-pak-routes/<id>/`。
- 航迹包在索引中记录 `renderRadius.hd/lod=1200`；整图包仍使用 1200/3000。短录像 `flight_20260926_044304_980_m520_050.csv` 实测地图 93 个不同 cell，包约 106 MB（整图约 790 MB）。大小随航迹跨度和共用纹理变化，长途录像可能接近整图大小。
- 已用 `scripts/test-route-bake.mjs` 点击 HUD 按钮、等待自动切包、检查 Hydra 回放和截图；后续 app 改动仍须运行类型检查、发布及截图自测。Rustler 真实飞行仍待实际 476 录像。

## 15. 六项飞行分析功能（2026-09-26）

- 录制器写 v8 CSV，继续读取 v4–v7。新增 Hydra 喷口原始控制值、可读的 prop 节点、冒烟状态和明确的爆炸事件；Rustler 不采集 prop 节点动画。后续 v8 文件还追加可选 `capture_elapsed_s`，与同名 WAV 使用同一个 QPC 起点；没有该列的早期 v8 文件仍按本地时间读取。
- `recorder/build.ps1` 同时构建 `FlightRecorder.asi` 与 `GameAudioCapture.exe`；安装脚本会备份旧 ASI 并安装两者。WAV 是 GTA 进程 loopback 原声，文件名与 CSV 相同。游戏需重启才会加载新 ASI。
- 回放有自由视角、所有已加载片段终点的红点与俯视密度图，以及可逐项隐藏的姿态、速度、高度、升降率、航向、油门、健康度、过载、角速度仪表。终点不自动判定为死亡。
- pak 增加本机 `effects.fxp`/`effectsPC.txd` 特效资源；更换此版后须重新烘焙整图或航迹 pak。特效由录像时间驱动，倒退和重复定位不会叠加旧粒子。原版 Hydra 模型没有可旋转喷口网格，因此喷口角度按录制值推断，并用原版 `jetthrust` 粒子方向表现；此几何角度不是原版实测动画。
- 视频由本机 Chrome/Edge 和 FFmpeg 导出 H.264/AAC MP4（1920×1080、30fps、原速）。保留当前视角与分析 HUD，不录页面操作控件；支持进度、取消、下载及拖入同名 WAV。
- 验收用真实 Hydra `flight_20260926_153900_322_m520_001`（22.435 秒，含喷口变化、181 个冒烟采样、一次爆炸）和 Rustler `flight_20260926_155714_107_m476_001`（1153 采样，55.535 秒）。Hydra 整段 MP4 经 ffprobe 核对视频与音频均约 22.47 秒；Rustler 起飞、中段、末段截图无错误。新版 QPC 列经编译与模拟时钟跳变解析测试，尚无安装此微调版 ASI 后的真人录像。
