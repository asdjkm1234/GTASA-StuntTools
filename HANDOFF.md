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
    src/FlightRecorderASI.cpp         录制器 v9 源（无 CLEO opcode）
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

- **录制器 v9**（`recorder/src/FlightRecorderASI.cpp`）：独立 ASI，25Hz，仅 520/476；进入即录、下车/爆炸/失效/换机/QuickHome(≥120m/采样) 切档。在 v8（喷口/螺旋桨/冒烟/爆炸事件/`capture_elapsed_s`）之上，v9 追加推断列 `transmission_gear_inferred`/`engine_load_inferred`（逐行 `*_source=inferred`）与推断碰撞事件行，并保留 v6/v7 字段：
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

列名驱动、**向后兼容 v4–v8**（缺列为 `null`）。v6 基础表头（顺序）：
`local_timestamp,model,health,x,y,z,heading_deg,right_x/y/z,up_x/y/z,forward_x/y/z,vx,vy,vz,ax,ay,az,steer,throttle,brake,color_primary/secondary/tertiary/quaternary,landing_gear_status,key_q,key_a,key_e,key_d,key_up,key_down,game_hour,game_minute,game_second,weather_new,weather_old,weather_forced,node_status,surface_source,` 然后 7 组 `<node>_qx,qy,qz,qw`（rudder,elevator_l,elevator_r,aileron_l,aileron_r,gear_l,gear_r）。
`node_status` 位：0 rudder、1 elevator_l、2 elevator_r、3 aileron_l、4 aileron_r、5 gear_l、6 gear_r；该位为 0 时四元数写 `nan`。
文件以 `# session_start,…` 开头、`# session_end,<reason>,…` 结束。旧 v5 无游戏时钟/天气/节点列。
v7 在相机调试列之后追加 `center_gear_status`、`misc_a` 与 `misc_b` 各自的 `qx/qy/qz/qw/x/y/z`。2026-09-26 的完整收放录像表明两节点每帧都可读、位置不变，收起角分别为 −80°、+130°；回放优先使用实测四元数，旧 CSV 按该角度和收轮进度补全。
v8 追加 Hydra 喷口原始控制值、可读 prop 节点、冒烟状态、爆炸事件，以及可选 `capture_elapsed_s`（与同名 WAV 共用 QPC 起点；早期 v8 文件无此列仍按本地时间读）。

v9 追加以下列（v9 文件共 112 列），**全部是推断值（inferred），不是游戏内测量值**，逐行 `*_source` 必须为 `inferred`：

- `transmission_gear_inferred`（0–6）+ `transmission_gear_source`（固定 `inferred`）；
- `engine_load_inferred`（0–1，`clamp(max(abs(throttle),abs(brake)),0,1)`）+ `engine_load_source`（固定 `inferred`）。

v9 还会写入一行推断碰撞事件（8 字段）：

```
# event,<seconds>,collision,inferred,<impact_m_s2>,<x>,<y>,<z>
```

判据只用已采样信号：`health` 单采样下降 ≥ 20 **或**峰值保持加速度 ≥ 30 m/s²（满足任意一项即写），每次冲击最多一行、1 秒冷却；`inferred` 是来源标记，**永远是推断，绝不是实测材质**。v4–v8 文件没有这些列与事件；解析端遇到 v9 之前的碰撞行必须忽略。

**诚实声明（G3 NO-GO）**：本机 `gta_sa.exe`（sha1 `185b73…`）不是 SDK 验证的 1.0-US 指纹（期望 `8c23ce…`），v9 不依赖未经验证的结构偏移。发动机 **rev/RPM 被刻意不发射（NOT emitted）**：无该列、不猜测。所有 inferred 值必须逐行标注来源，**推断值绝不当成实测值**。

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
  和 `aircraft/{hydra,rustler}.{dff,txd}`、共享 `aircraft/vehicle.txd`，`index.json` 用 `replayAssets.version=3` 标识（v3 在 v2 之上追加 `data/handling.cfg` 与 `audio/` lane）。只打包 520/476；
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
- V1.1 发布时尚无 v9 字段（当时为 v7 系列格式）；但 V1.1 暂时不采集或写出相机调试数据。文件头为 `camera_debug=0`，没有 `camera_*` 列，起落架和其他飞行列继续保留。要恢复相机调试，把 `recorder/src/FlightRecorderASI.cpp` 中的 `FLIGHT_RECORDER_CAMERA_DEBUG` 改为 1 后重新构建、安装。当前 v9 格式见 §6 与 §16。
- V1.1 发布标签使用大写 `V1.1`；历史 v1.0 标签保持原样。

## 14. 航迹 pak（2026-09-26）

- HUD“烘焙当前航迹”把选中的 CSV 发给仅监听本机的服务；服务调用 `bake-map.mts --recording <csv>`，按航迹线段附近 1200 单位筛选地图和相机碰撞 cell，重新规划纹理数组，完成后自动切换到独立 pak 和该 CSV。整图 `map-pak/` 不变；航迹包保存在 gitignored 的 `tools/opensa/map-pak-routes/<id>/`。
- 航迹包在索引中记录 `renderRadius.hd/lod=1200`；整图包仍使用 1200/3000。短录像 `flight_20260926_044304_980_m520_050.csv` 实测地图 93 个不同 cell，包约 106 MB（整图约 790 MB）。大小随航迹跨度和共用纹理变化，长途录像可能接近整图大小。
- 已用 `scripts/test-route-bake.mjs` 点击 HUD 按钮、等待自动切包、检查 Hydra 回放和截图；后续 app 改动仍须运行类型检查、发布及截图自测。Rustler 真实飞行仍待实际 476 录像。

## 15. 六项飞行分析功能（2026-09-26）

- 录制器写 v8 CSV，继续读取 v4–v7。新增 Hydra 喷口原始控制值、可读的 prop 节点、冒烟状态和明确的爆炸事件；Rustler 不采集 prop 节点动画。后续 v8 文件还追加可选 `capture_elapsed_s`，与同名 WAV 使用同一个 QPC 起点；没有该列的早期 v8 文件仍按本地时间读取。（本节为 2026-09-26 的 v8 迭代记录；当前格式为 v9，见 §6 与 §16。）
- `recorder/build.ps1` 同时构建 `FlightRecorder.asi` 与 `GameAudioCapture.exe`；安装脚本会备份旧 ASI 并安装两者。WAV 是 GTA 进程 loopback 原声，文件名与 CSV 相同。游戏需重启才会加载新 ASI。
- 回放有自由视角与 **3D world endpoint markers**：每个已加载航迹的 **every track endpoint** 都在 3D 世界里放置标记，密度光环（**density halo**）只表达聚集程度、**never hides a point**；旧的平面 2D 分析面板已退役（**flat 2D panel retired**）。分析 HUD 的姿态、速度、高度、升降率、航向、油门、健康度、过载、角速度仪表仍可逐项隐藏。终点不自动判定为死亡。
- pak 增加本机 `effects.fxp`/`effectsPC.txd` 特效资源；更换此版后须重新烘焙整图或航迹 pak。特效由录像时间驱动，倒退和重复定位不会叠加旧粒子。原版 Hydra 模型没有可旋转喷口网格，因此喷口角度按录制值推断，并用原版 `jetthrust` 粒子方向表现；此几何角度不是原版实测动画。
- 视频导出为 **1920x1080** H.264/AAC MP4：视频在页面内用 **WebCodecs** 硬件编码，ffmpeg 以 **`-c:v copy`** 直接封装（copy-mux），**no per-frame PNG**，导出期间无可见浏览器窗口；支持 30/60/120 fps，保留当前视角与分析 HUD。**不要声称实时导出**：本机 Intel Arc A380 实测 60 秒片段 60 fps 约 65–68 秒（≈1.1x 片长）、120 fps 约 122–141 秒（≈2-2.3x 片长）——120 fps 导出正确但慢于实时，固定每帧成本约 17 ms 超过 8.33 ms 预算；编码器本身远快于实时（流水线 lane 60 秒/60 fps 仅 12.8 秒）。HUD 是 DOM 仪表的 **canvas mirror**（信息等价但 **not pixel-identical**）。120 fps 只改善 **cadence**，无法恢复超过 25 Hz 录制器 **12.5 Hz** 极限的运动。详见 §16。
- 验收用真实 Hydra `flight_20260926_153900_322_m520_001`（22.435 秒，含喷口变化、181 个冒烟采样、一次爆炸）和 Rustler `flight_20260926_155714_107_m476_001`（1153 采样，55.535 秒）。Hydra 整段 MP4 经 ffprobe 核对视频与音频均约 22.47 秒；Rustler 起飞、中段、末段截图无错误。新版 QPC 列经编译与模拟时钟跳变解析测试，尚无安装此微调版 ASI 后的真人录像。

## 16. v9 录制、音效、分析与导出的诚实声明（2026-09-27）

### v9 录制
- 录制器输出 v9（文件头 `# gtasa_flight_recorder,version=9,...`），在 v8 之上追加四个列与一种事件行（详见 §6）：
  `transmission_gear_inferred`、`transmission_gear_source`、`engine_load_inferred`、`engine_load_source`，
  以及 `# event,<seconds>,collision,inferred,<impact_m_s2>,<x>,<y>,<z>`。
- 真实 v9 录像（Hydra 520 / Rustler 476）实测 112 列、0 截断行；四个 v9 列的逐行 `*_source` 全部为 `inferred`，
  没有一行标 `measured`；任何文件都不存在 rev/RPM 列。
- G3 为 **NO-GO**：本机 `gta_sa.exe`（sha1 `185b73…`）不是 SDK 1.0-US 指纹（期望 `8c23ce…`）。因此挡位与负载
  都是启发式推断、**逐行标注 inferred**；发动机 rev/RPM 刻意不发射（NOT emitted），不猜。

### 音效回放
- 以下 20 样本与 FASTPROP_D 的描述是 2026-09-27 v3 清单的历史记录，**当前实现已由 §18–19 的 34 样本/v6 四层 Rustler 路径替代**；不得将其当作当前玩家混音。
- 烘焙把 **20 个**本机 GENRL 样本写入 pak，引擎 bank **按机型**选取：Hydra 520 →
  `SND_BANK_GENRL_VEHICLE_GEN`（id 138 / slot 19，**分层喷气**：`THRUST`26 主涡轮 + `WHINE`29 高频啸叫 +
  `JET_DIST`14 距离层 + `LIFT_LOOP`15 升力层）；Rustler 476 →
  `SND_BANK_GENRL_FASTPROP`（id 53 加速 / `_D` id 54 减速）。每层 3 档（`[0.7,1,1.4]`）+ `collision-set.wav`、
  `explosion-set.wav`；引擎样本名为 `engine-520-<layer>-<step>.wav`（如 `engine-520-turbine-1.wav`、`engine-520-whine-1.wav`）
  与 `engine-476-accelerate-<step>.wav` / `engine-476-decelerate-<step>.wav`，外加 `manifest.json`（逐样本记录 bank/slot/sound/soundName/采样率与 provenance，v3）；该版 pak
  `replayAssets.version=3`。bank 按名从 gta-reversed `eSoundBank.h` 选、sound 按 `SoundIDs.h` 选，bake 时与安装一一校验，不匹配即抛错（Hydra 缺样本
  时上报 `engine: null`，绝不静默回退到螺旋桨 bank）。
- `apps/web/src/flight/audio-engine.ts` 按机型选 bank 并对相邻转速档**分层**混合（涡轮/啸叫/距离/升力）：引擎音高随推断挡位/转速
  变化、油门/刹车只调制在调的层、碰撞按推断冲击强度选样本、爆炸按固定频率循环，叠加距离衰减与多普勒；独立数值一致性 oracle 覆盖全部常量。
- **推断边界**：喷气机的**分层音色组合**（THRUST/WHINE/JET_DIST/LIFT_LOOP）为 INFERRED（`ProcessGenericJet` 未逆向）；3 个转速档是同
  一 loop 的离线重采样，非游戏额外样本。
- **诚实声明**：音效是**参数化忠实（parameterization-faithful）**的重建，**不是原版混音的逐位一致（NOT bit-exact）**；
  推断输入一律标注 inferred，绝不呈现为实测。

### 分析与 3D 终点标记
- 每个已加载航迹的终点都在 3D 世界里放一个标记（**3D world endpoint markers**），**every track endpoint 都有标记**；
  密度光环（**density halo**）只表达聚集程度、**never hides a point**。旧的平面 2D 分析面板已退役（**flat 2D panel retired**）。

### 视频导出
- **1920x1080** H.264/AAC MP4；视频在页面内用 **WebCodecs** 硬件编码（prefer-hardware），ffmpeg 以 **`-c:v copy`**
  直接封装（copy-mux），**no per-frame PNG**，导出时无可见浏览器窗口；支持 30/60/120 fps。
- **诚实声明：不要声称实时导出（do NOT claim realtime export）。** 本机 Intel Arc A380 实测：60 秒片段在 60 fps
  约 65–68 秒（≈1.1x 片长），在 120 fps 约 122–141 秒（≈2-2.3x 片长）。120 fps 导出正确但**慢于实时**：固定
  每帧成本约 17 ms，超过 120 fps 的 8.33 ms 预算；编码器本身远快于实时（流水线 lane 60 秒/60 fps 仅 12.8 秒）。
- HUD：导出的 HUD 是页面 DOM 仪表的 **canvas mirror**，信息等价但**不是逐像素一致（not pixel-identical）**。
- 120 fps 只改善节奏（**cadence**），**无法恢复超过 25 Hz 录制器 12.5 Hz 极限的运动**。

## 17. 音频听感修正（碰撞与飞机动态）

- `gta-reversed` 的 `AECollisionAudioEntity.CollisionLookup.h` 对 `SURFACE_CAR` 使用 GENRL 碰撞 bank 39 的 sound 20–28（`COLCAR01/03/04/05/06/08/09/10/12`）。旧音频清单只烘 sound 0，却按 bank 总数 72 选碰撞 index；运行时和离线音频实际上始终解码同一声音。现烘焙九个独立 WAV，清单版本为 4，旧音频清单须重烘（包括已有航迹 pak）；整图 `replayAssets.version` 仍为 3。
- v9 推断碰撞没有接触材质；只从载具表面样本中确定性选取、不连续重复。强度控制音量，碰撞变调缩至 `PlayOneShotCollisionSound` 的 ±2%；绝不把推断冲击或声音编号当成实测材质。原版的双表面、刮擦及冲量起播规则需要新实测数据，暂不能声称完全还原。
- 飞机发动机的推断速度代理现按 CSV 采样时间轴做升速/降速平滑，避免挡位变化突然跳音；健康度按 `gta-reversed` 的 `ProcessPropOrJetStall` 分段衰减音量和频率。近场/推力/远场分层距离响应以 `PlayAircraftSound` 的参数和衰减表抽样锚点建立，相对 20 米跟随镜头归一化；多普勒采用 `AEAudioEnvironment` 的 340 m/s 声速和 ±35 m/s 径向限幅。WHINE/LIFT 的声源角色仍是推断。默认室外开放空间混响，原版音频区域和 `ProcessGenericJet` 内部混音尚未还原。
- 修改后执行 `tsc --noEmit`、音频 vitest、`build-flight-replay.ps1`、整图重新烘焙与浏览器截图自测；比较原声 WAV 时需注意它含游戏全部声源，而非独立碰撞/引擎 stem。
- 用户实听反馈满加力 Hydra 偏尖：仅在推断速度代理超过 0.7 的末段加平滑软拐点，满功率目标音高从 1.6× 降至 1.48×，同时将 WHINE 满功率权重降低 20%；中低功率和 Rustler 保持原样。音频核心同时供实时回放与视频导出使用，不需要再次烘焙 pak；最终听感仍以原声 WAV 对照为准。
- 后续用户反馈满加力仍尖，要求试听 1.0×：现在健康 Hydra 的所有发动机循环在整段油门范围保持源音高 1.0×，避免中段高音再回落至满功率 1.0×；之前的 1.48× 满功率音高方案已被替换。仍有空间多普勒与健康度修正，推断速度代理继续驱动音层/音量，Rustler 的可变音高不变。只需重新发布网页，无需重新烘焙 pak。
- 用户试听 1.0× 后反馈过于低沉：调整 Hydra 健康时的目标音高为随推断速度代理平滑变化的 1.0–1.25×（满加力 1.25×），继续保留 WHINE 高功率衰减；Rustler 的 1.0–1.6× 不变。这个主观听感参数有待用户再次试听确认。

## 18. 第一人称原版 WAV 对照与 Rustler 原声路径（2026-09-28）

- 用户新录的 v9 第一人称成对素材：`flight_20260928_002942_500_m520_002`（39.07s）及 `flight_20260928_003025_495_m476_003`（57.41s），均在 `GTA San Andreas/flight_recordings/`，每对 CSV/WAV 用 QPC 同时基。`npx tsx scripts/analyze-flight-audio.mts "../../GTA San Andreas/flight_recordings/<文件>.csv"` 仅输出分段 dB 数值，不保存游戏音频；对照限制：游戏 WAV 是完整混音，合成音频按飞机声源位置近似机舱监听，不是逐样本相减。
- 两份 CSV `throttle` 全程 0，`brake` 按用户实际操作 W=0、放开=0.5、S=1；v9 的 `engine_load_inferred=max(throttle,brake)` 对这两架飞机不适合做音频加力信号。音频内部改用 `max(throttle,1-brake)` 推断控制，**不改动 CSV 原始字段及 inferred 来源标注**。旧逻辑 W 时音量变小，现方向已纠正。
- GitHub 检索：[gta-reversed 的 `ProcessDummyOrPlayerProp`](https://github.com/gta-reversed/gta-reversed/blob/master/source/game_sa/Audio/Entities/AEVehicleAudioEntity.cpp#L3126-L3182) 已公开 Rustler 玩家混音的四个声音：玩家 FASTPROP bank 53 sound 0 前、sound 1 后，以及 VEHICLE_GEN bank 138 sound 17 近、sound 16 远；同文件还有 `GetPropSpeedFactor`/距离门控/健康度修正。过去用 FASTPROP_D bank 54 的 sound 0 当玩家收油是错误路径。pak 音频清单升至 **v5**（整图 `replayAssets.version` 保持 3），需重烘焙整图和已保存的航迹 pak。Hydra [`ProcessGenericJet`](https://github.com/gta-reversed/gta-reversed/blob/master/source/game_sa/Audio/Entities/AEVehicleAudioEntity.cpp#L3528-L3531) 在目前检索到的 gta-reversed/衍生仓库中仍仅为原游戏函数调用，PS2 Quarry 注释仅作线索，不能声称已经找到 100% 可复用的 PC 实现。
- Rustler 2026-09-28 录像：约 1.066s 静止 W 加力，原声宽频 0.2–0.45s 变化 +2.51 dB，v5 对照合成约 +2 dB；约 17.827s 飞行 46m/s 收油，原声 +0.21 dB，合成约 +0.21 dB（存在环境/相位干扰，不能把这数值叫发动机的独立响度）。原版约 34.49–34.61s 与 34.66–34.79s 在速度降到 ~21m/s 时出现两段 0.12–0.13s 的掉声，先前误认成 34.947s 零推力后的 +5.67dB 增益：真正原因是对照“之前”窗口包含掉声。音频核心据低速下降且此前飞过 30m/s 的条件推断一次短暂双脉冲，限 Rustler、不标为实测；CSV 无原版 `m_fPropSpeed`/发动机停止标志，不能保证其它失速录像逐帧一致。高速收油的响度靠推断转子惯性保持，既有 WAV 对照约 35s 零推力后仍在 -17dB 附近。
- 本轮复核：Rustler 静止 W 窗口合成 +1.84 dB（完整游戏 WAV +2.51 dB）；46m/s 收油合成 +0.21 dB（原 WAV +0.21 dB）。掉声窗口原 WAV 在 34.49–34.61s 与 34.66–34.79s 低于 -23 dB；合成的 34.55–34.65s 0.1s 窗口分别约 -28.4/-24.4 dB，原 WAV 约 -28.2/-23.3 dB。分析脚本仍显示 34.947s 的异常收油边沿，但已将其从普通收油汇总排除。Hydra 静止 W 的合成宽频增幅由 +3.22 压至 +2.20 dB（完整游戏 WAV +1.60 dB）；高速 W 原完整混音反而下降，合成仍上升，不能以两条总混音波形推断一个普适的原版喷气混音公式。Hydra 推力响度压缩和 Rustler 掉声触发/深度均为 inferred；听感仍需用户试听验收。
- `scripts/test-standalone-pak.mjs <Hydra CSV> <Rustler CSV>` 现在可载入两份真实录像（省略第二个参数时仍用模拟 Rustler），并逐一检查画面、WebAudio 播放与 34 个样本。实测 Hydra 用 `VEHICLE_GEN`、Rustler 用 `FASTPROP`，两机实时各有 4 个活动声源，整图 562 cells；截图位于 gitignored 的 `tools/opensa/captures/`。离线导出与实时 WebAudio 均调用 `buildAudioTimeline(...).frameAt(...)`，但两者的实际输出波形并未做逐样本同一性断言。

## 19. Rustler 满推力循环声修正（2026-09-28）

- 用户试听指出 Rustler 满马力有明显样本循环感。对本机 GENRL 原始 FASTPROP 0/1 的 20 ms 窗口测得：原始前/后层开头相对中位 RMS 约 -1.0/-1.7 dB；v5 烘焙的 20 ms 线性首尾淡化使每次循环开头变成 -4.9/-4.5 dB，循环约 1.96 秒。这个固定音量凹陷是可复现的人工痕迹，并非原版实测特性。
- v6 对前/后层改用 2 ms 等功率接缝，近/远层用 20 ms 等功率接缝；重烘后前/后开头约 -1.12/-1.84 dB，近/远约 +0.75/+0.02 dB。实时 WebAudio 与离线导出通过共享音频核心为 Rustler 前/后层各选一份原速样本并连续改变播放速率，避免同一循环两个重采样档叠加产生相位拍频；34 样本清单仍保留三档以兼容其它层和既有数据结构。以上修正针对已测得的人为重复感，不能宣称恢复了原版未录制的 `m_fPropSpeed` 或逐位一致的混音。
- 音频清单升至 v6（整图 `replayAssets.version` 仍为 3），整图 pak 已重烘，既有航迹 pak 须重烘；旧 v5 包会要求重烘。新合成对照：Rustler 1.066s W 后段宽频 +1.82 dB（原 WAV +2.51 dB），17.827s 高速收油 -0.27 dB（原 WAV +0.21 dB）；低速掉声时序基本保留。用户听感验收仍待这一版试听。
- 验证：`tsc --noEmit` 0 错误，相关 vitest 82 个通过；重新发布 `build-flight-replay.ps1` 后用两份真实 CSV 在第 8 秒第一人称视角截图并播放，Hydra/Rustler 均从整图 562 cells 正常渲染，WebAudio 为 ready、34 样本、各 4 层活动声部且没有 `/game-src` 请求。测试只确认循环接缝能量和播放链路；是否听起来更自然仍由用户试听判定。

## 20. 两机持续加力的规律循环感（2026-09-28）

- 用户试听 v6 仍觉得两份最新录像都有规律的“一下一下”，但整体合成已接近原版。v6 只让 Rustler 前/后主层各播放一份原样本；Hydra 仍在相邻重采样档间叠加同一短 loop。现对 520/476 **所有层**只播放原速样本的一份，持续调整播放速率，实时 WebAudio 与离线导出继续共用 `audio-engine.ts` cue；v6 pak 已包含原速档，不需重烘。Hydra 满功率推断音高加不超过约 1% 的确定性、平滑非周期变化，打散固定 2.09s 的涡轮重复；不把它说成游戏实测 RPM 或原版算法。
- 公开 [`ProcessDummyOrPlayerProp` / `CalculatePlanePropFreq`](https://github.com/gta-reversed/gta-reversed/blob/master/source/game_sa/Audio/Entities/AEVehicleAudioEntity.cpp#L3060-L3084) 说明 Rustler 玩家前/后层频率主要受右倾、俯仰、加减油和逐帧平滑影响，而不是推断挡位。旧合成在该录像 6–10s W 状态锁在 **1.6×**；本机第一人称原版 WAV 的主要频谱峰相对 GENRL 前/后源样本约在 **1.06×**。现按已录 `right/forward` 姿态 + W/松开/S 代理计算并按公开 `1/187.5` 每帧步长近似平滑；该录像 5–10s 合成前/后层约 **1.064–1.16×**。由于 CSV 没有实际 pad 值、游戏音频 tick 和 `m_fPropSpeed`，按键映射与 60Hz 步长换算仍为 inferred。
- 当前离线对照：Rustler 1.066s 静止 W 后段宽频 **+2.07 dB**（完整原版 WAV **+2.51 dB**）；17.827s 高速收油 **+0.13 dB**（原版 **+0.21 dB**）。Rustler 5–10s 50ms 宽频窗的 5–95% 范围仍约 **2.93 dB**（原版完整混音 **1.78 dB**）；前/后单层各约 1.83/1.94 dB，叠加会增加起伏。曾试固定错开前/后播放相位，实际范围恶化至 5.33 dB，已撤销；不能假设固定相位偏移可通用消除拍频。Hydra 5–10s 合成宽频 5–95% 范围约 **2.02 dB**（原版完整混音 **1.94 dB**）；这些总混音统计不能当作隔离发动机 stem，也不能代替听感验收。
- 验证：`tsc --noEmit` 0 错误，相关 82 个 vitest 通过，修改的 TS 文件 ESLint 通过，分析脚本 Prettier 通过，`scan-no-assets.mjs` 0 泄漏。`build-flight-replay.ps1` 已重新发布；两份真实 CSV 在第 8 秒第一人称模式的浏览器自测通过，截图已人工查看，均为 562 cells、34 样本、4 个活动声部且没有请求游戏安装目录。此轮改变只涉及浏览器/导出播放逻辑，继续保留所有既有未提交修改，不提交游戏录音或 pak。
- 用户试听本版后反馈：**Rustler 持续加力比上一版更接近原版，不仔细听已难察觉循环感**。这是 Rustler 主观听感进展，不等于逐位还原或所有工况验收；用户尚未对这一版 Hydra 的循环感给出单独结论。
- 随后用户反馈 **Hydra 听感比上一版下降**。本轮 Hydra 曾把相邻重采样档混合改成单份原速样本，并加约 1% 缓慢音高变化；无法确定哪项单独导致下降，故两项 Hydra 改动均已撤回，恢复 §19 时的相邻档混合和原有 1.0–1.25× 音高曲线。Rustler 的姿态驱动频率与单样本层保留，不回退其已获好评的部分。§20 上方的 Hydra 单样本/漂移描述仅记录被撤销的试验，不是当前实现。

## 21. Hydra W 加力时的低频浑浊与短促爆声（2026-09-28）

- 用户对两次 Hydra 改动/回撤试听仍觉相近，进一步指出对原版 W 加力时合成声偏藏、夹杂爆声和「呜呜」声。`scripts/analyze-flight-audio.mts <v9 Hydra CSV> map-pak --texture` 在本机内存里把 5–10s 的两条 48k WAV 分频比较；不输出、复制游戏录音。原完整混音低于 400Hz / 400–1500Hz / 4–8kHz 分别约 -25.61/-31.82/-35.92 dB，旧合成约 -17.89/-27.70/-37.91 dB，表明低频尤其过重。单独渲染声层显示 THRUST 涡轮占低频主体；只选原速样本时仍约 -17.85/-27.50/-37.29 dB，因此两份重采样档交叉混合不是此处频谱失衡的主要原因。该段只有 30.74s 的一次推断碰撞事件，5–10s 没有碰撞单发可解释爆声；两段 PCM 也未发生数字削波。原 WAV 包含整个游戏混音，上述数字只用于有限的相对对照，不能当作原版发动机独立轨。
- **已撤回的实验**：在共享音频核心中仅调整 Hydra 的推断声层权重：THRUST ×0.5、WHINE ×1.25、JET_DIST/LIFT_LOOP ×0.7。5–10s 的合成分频数字一度接近原完整混音，但用户明确反馈起飞爆音/呜呜声没消失、巡航声音更差且有混响感。频段匹配不是听感验收，特别是原 WAV 并非发动机独立轨；现已恢复实验前的声层比例。`ProcessGenericJet` 混音未公开，所有这些比例均为 **inferred**。
- 验证：`tsc --noEmit` 0 错误，相关 43 个 vitest 通过，改动 TS 文件 ESLint 与分析脚本 Prettier 通过，网页已重建发布。两份真实 v9 CSV 在第 8 秒第一人称浏览器截图已人工查看，Hydra/Rustler 均渲染整图 562 cells，合成 WebAudio ready、34 样本、4 声源，无游戏安装目录请求；`scan-no-assets.mjs` 0 泄漏。Rustler 1.066s 静止 W 原版 +2.51 / 合成 +2.07 dB，17.827s 高速收油原版 +0.21 / 合成 +0.13 dB（0.2–0.45s 宽频窗）；本轮未改其合成路径。未提交任何录音或游戏资源。

## 22. Hydra 极短 WHINE 循环与额外混响（2026-09-28）

- 用户对 §21 的声层比例实验听感反馈为更差，故仅撤回那几个 Hydra 权重。进一步检查本机 GENRL 原始 WHINE：44100 Hz、840 帧（约 19.05 ms）、loopOffset=0；原样本首尾采样差 1745/32768，低于样本内部最大逐采样差 14144/32768。旧烘焙统一要求 20 ms 交叉淡化，因函数最多取原长的四分之一，竟将此循环裁为 630 帧（约 14.29 ms），人为改变了周期。v7 对 Hydra WHINE 不再裁切，保留 840 帧原始长度；THRUST/JET_DIST/LIFT_LOOP 和 Rustler 的接缝策略保持原样。整图 pak 已重烘 562 cells、34 音频样本；旧航迹 pak 还须重烘。原始样本周期保留并不等于已证明「呜呜」声完全解决。
- 当前共享音频时间线对 Hydra 的开放空间额外混响 mix 设为 0；原 WebAudio 把所有发动机层送往 10% 的 ConvolverNode，离线导出也将总混音送进延迟混响。Rustler 保持原有混响，Hydra 的声层、音高和油门响应未再改。此项是针对用户巡航混响感的推断性修正，待试听验收。
- 第三方公开实现核查：[Soundize](https://github.com/JuniorDjjr/soundize) 的公开仓库只有 README，作者页面称近期支持飞机但未发布可复用混音源码；[GTAFmod](https://github.com/chrystianfarias/gta-fmod) 有源码但面向汽车及自定义 FMOD 声音，不等同于原版 Hydra/Rustler 路径；[bengines](https://github.com/brzys/bengines) 是 MIT 授权的 MTA 自定义发动机系统，可借鉴循环、动态增益，但不是原版飞机音频；已找到的专门 [Hydra/Rustler 替换 MOD](https://www.gtagarage.com/mods/show.php?id=17354) 主要替换音频 bank，未给出原版实时混音公式。没有将第三方音频资源或代码复制进仓库，也不能宣称已找到 100% 原版实现。
- v7 原样 WHINE 的起飞 1–4s 离线 5ms 相邻 RMS 最大差约 12.86 dB，旧 v6 约 11.95 dB；这种极短窗口受多层波形相位强烈影响，不能据此宣称爆音改善。验证已完成：`tsc --noEmit` 0 错误、相关 53 个 vitest 通过、改动 TS 文件 ESLint 通过、Prettier 通过，重新发布网页；真实两机 v9 CSV 在第 2 秒第一人称浏览器截图已人工查看，整图 562 cells、34 样本、4 活动声源、WebAudio ready，无 `/game-src` 请求。`scan-no-assets.mjs` 0 泄漏，未提交游戏资源或录音。**用户已试听并明确否定 v7 的 Hydra 听感**；后续窄带频谱定位见 §23。

## 23. 第一人称 Hydra 原版/合成 48 kHz 窄带对照（2026-09-28）

- 用户确认新 Hydra v9 录像全程第一人称、不切镜头，并认为 v7 合成的起飞爆音/「呜呜」与巡航声仍完全不对。`scripts/analyze-flight-audio.mts` 可用 `--write-synth=<captures 内路径>` 与 `--write-layers=<captures 内目录>` 只写**合成** 48 kHz WAV；原版同名 WAV 只读、不复制、不进入 Git。用本机 NumPy 8192 点 Hann FFT、0.05s hop 对 `flight_20260928_002942_500_m520_002.wav` 与共享音频核心的离线合成逐段比较；图/数值存在 gitignored 的 `tools/opensa/captures/`。原版是 GTA 进程**完整混音**，合成近似听者位于飞机本体；不能把差值当发动机独立轨的精确增益。
- v7 的起飞 1–4s 合成在 100–250 Hz 比原版约高 **14.4 dB**，且有强烈约 **216 Hz** 窄峰，单层定位为 `LIFT_LOOP`；原版同段主要低频窄峰在约 **123 Hz**，没有同样强的 216 Hz 音线。合成的 WHINE 在起飞约 **4.11 kHz**，5–10s 又升到约 **4.79 kHz**；原版 W 起飞/持续加力的主峰分别约 **4.39/4.40 kHz**。原版松开 W 时啸叫会下降，旧合成因挡位/速度代理仍保持高音。v7 同一声层相邻重采样档叠加也可能制造拍频；这点仅是机制推断，不能单凭谱图证明是唯一听感原因。
- 本轮仅对 Hydra 在共享 `audio-engine.ts` 中调整：THRUST 的推断增益按 W/松开/S 拉开，满 W 基准为旧值的 0.225，并用实测位置速度加不超过约 4.6 dB 的推断响度补偿；THRUST 增益用约 0.6 秒惯性，WHINE 音高用较快的 0.12/0.25 秒升/降惯性。WHINE 推断权重乘 0.75、音高按加力代理在 0.925–1.145× 变化；THRUST/远场/VTOL 的正常健康状态音高保持原速。近场第一人称不播放 JET_DIST 与 LIFT_LOOP，远离飞机时平滑恢复；Hydra 每层只播放一份原速循环，避免同一短循环多档同播。Rustler 四层、频率、掉声逻辑不变；pak v7 原始样本也不变，不必重烘整图，但旧航迹 pak 仍须按 §22 重烘。所有比例/距离门限为 **inferred**，未取得 `ProcessGenericJet` 完整实现，也没有记录到实际 RPM。
- 最新 1–4s 起飞对照：原版/合成主峰均约 **4389 Hz**，100–250 Hz 约 **-32.3/-34.2 dBFS**，4–8 kHz 约 **-28.7/-29.7 dBFS**；5ms 相邻 RMS 最大差约 **5.21/4.66 dB**，两者无数字削波。持续 W 的 5–8s 合成低频仍约低原版 2.6 dB；原版完整混音还含风声/环境声，不能继续盲目按总能量补足。W 首次边沿后 0.2–0.45s 的宽频变化原版约 +1.60、合成约 +4.10 dB，仍不一致；不能据稳态频谱宣称控制响应完成。原版啸叫有非平稳音调与噪声，短循环合成仍较规则。现有数字表示频谱方向改善，**不是用户听感验收**。实时 WebAudio 与离线导出共用 cue，但 PannerNode/浏览器重采样与离线线性插值不同，最终仍须实际试听。
- 验证：`tsc --noEmit -p tsconfig.json` 0 错误，相关 53 个 vitest 通过，改动 TS 文件 ESLint 和脚本 Prettier 通过；`build-flight-replay.ps1` 已发布。两份真实 v9 CSV 在第 2 秒第一人称截图已查看，Hydra/Rustler 均有 562 cells、34 个样本、WebAudio ready、4 个声源、无游戏安装目录请求。Rustler 静止 W 与高速收油的旧对照数字分别保持合成 +2.07 dB（原版 +2.51）和 +0.13 dB（原版 +0.21）；本轮没改其路径。`scan-no-assets.mjs` 0 泄漏，所有未提交修改仍在工作树中，未提交游戏音频或录音。

## 24. Hydra 中频厚度与未启用候选声层（2026-09-28）

- 用户试听 §23 版本后认为 Hydra 过于单薄，像电机，询问是否遗漏原版音效。pak v7 实际已有该机四种本机候选原始样本（THRUST 26、WHINE 29、JET_DIST 14、LIFT_LOOP 15；各有三个预烘焙速率文件），但 §23 的**推断**第一人称混音把后两层在 4 m 内静音。不是烘焙漏文件；也不能据此证明原游戏第一人称应播放后两层，因为公开 `gta-reversed` 的 `CAEVehicleAudioEntity::ProcessGenericJet` 仍是原游戏调用，完整混音未公开。直接提高 LIFT_LOOP 曾带来约 216 Hz 的「呜呜」周期峰，因此没有原样放回。Rustler 玩家四层沿用 §18–22，不受此修改影响。
- 对同一 v9 Hydra 原版 WAV 与 §23 合成轨按 8192 点 Hann/0.05 秒 hop 对比，§23 的 250–500、500–1000、1000–2000、2000–4000 Hz 在起飞 1–4 秒都相对缺乏，其中 1–2 kHz 约低 8 dB；WHINE 的约 4.39 kHz 窄峰同时非常突出。这是完整游戏混音与近似源位的回放比较，不能当隔离发动机声轨。先用**已有** THRUST 26 在实时 WebAudio 和离线导出两侧加一条 Q≈0.707 的高通 400 Hz + 低通 4000 Hz 并联支路，推断增益 1.5，保持原干声。曾试算 800–4000 Hz、增益 4，实际会使 1–2 kHz 比原版过强，已降为当前参数。无新游戏样本、无 Rustler 改动。
- 当前离线 48 kHz 合成起飞 1–4 秒的相对频段（100–250 / 250–500 / 500–1000 / 1–2k / 2–4k / 4–8k Hz）为 −8.1 / −13.7 / −15.0 / −16.4 / −12.6 / −2.3 dB，原版为 −7.0 / −13.0 / −17.2 / −16.2 / −8.5 / −3.4 dB；两轨仍明显不完全一致，约 4.39 kHz 单频窄峰仍过强，且原版含全游戏声音。用户尚未试听这一版，不能称听感验收通过。合成 WAV、频谱 JSON/图与临时扫参脚本仅在 gitignored 的 `tools/opensa/captures/`。后续应以试听反馈继续微调，特别注意窄峰与 W 瞬态，不可声称 100% 原版。
- 验证：`tsc --noEmit` 0 错误，相关 54 个 vitest 通过（新增无游戏资源的中频/低频滤波行为测试），改动 TS 的 ESLint 0 错误、Prettier 通过，`build-flight-replay.ps1` 已发布。两份 v9 真实 CSV 在第 2 秒第一人称截图已查看，均为 562 cells、34 个样本、4 个活动声源、WebAudio ready，无游戏目录请求。Rustler 原有静止 W／高速收油的合成宽频响应仍约 +2.07／+0.13 dB，对照原版 +2.51／+0.21 dB。`scan-no-assets.mjs` 0 泄漏；未提交文件、录音或游戏资源。

## 25. 本地音频调音台（2026-09-28）

- 用户希望自己用大量滑块实时调音，并明确汇报各滑块数值。控制栏新增“调音台”，按当前 Hydra 520 或 Rustler 476 切换。Hydra 13 项：发动机总响度/总音高、THRUST 与 WHINE 的独立响度/音高、THRUST 中频支路增益和 200–1200 / 2000–8000 Hz 可调截止、JET_DIST 与 LIFT_LOOP 的第一人称近场混入及各自音高。Rustler 10 项：总响度/总音高、FRONT/REAR/PROP_NEAR/PROP_DIST 各自响度/音高。全部有实时数值（响度与音高精确到 0.01×，截止频率显示 Hz）；“复制参数”生成当前载具的中文数值清单和完整 JSON，剪贴板不可用时显示可手动复制的文本框。“恢复此载具基准”只重置当前载具。
- 默认值就是 §24 的推断混音，两机独立保存在浏览器 `localStorage`，只存数字，不存录音或游戏资源。移动滑块会在 WebAudio 既有声源上更新 cue，不重新启动循环；离线 `renderOfflineWav` 使用同一 `audio-engine.ts` 参数。合成 MP4 导出把当前载具调音参数作为已有 `exportView` 请求的一部分送到临时渲染页面，因此新 Chrome profile 也能拿到**导出开始时的快照**；录制 WAV 始终不变。输入与存储值均规范化到界限；静音/恢复基准可随时反复试听。JET_DIST/VTOL 新近场滑块默认 0，仅供用户 A/B 试听；它们是否属于原版第一人称混音仍为 **inferred**。
- 验证：`tsc --noEmit` 0 错误，相关 57 个 vitest 通过、改动 TS 的 ESLint 0 错误、Prettier 通过；`web-replay/video-export.test.mjs` 16/16 通过，含调音快照跨导出页面的传递断言。`build-flight-replay.ps1` 已发布，`scripts/test-audio-mixer.mjs` 用两份真实 v9 CSV 在独立临时 Chrome profile 中验证 Hydra 13/Rustler 10 个滑块、显示/复制数值、按载具持久化、实时发动机增益归零与导出请求参数；两机调音台截图已人工查看。`scripts/test-standalone-pak.mjs` 再验两机第一人称 562 cells、34 样本、4 声源、WebAudio ready、无 `/game-src` 请求。`scan-no-assets.mjs` 0 泄漏；未提交或分发游戏资源/录音。用户尚未反馈此调音台使用体验。

## 26. Hydra WHINE 窄带音色与起音复查（2026-09-28）

- 用户使用调音台后认为重点在 Hydra 的 WHINE 音色，暂无满意的滑块参数。本轮继续以全程第一人称 v9 Hydra CSV/WAV 为基准；本机 gitignored `captures/` 中的离线合成 WAV 和单层 WAV 只用于分析，原版 WAV 只读。pak v7 `WHINE`29 原速文件为 44.1 kHz、840 帧（约 19.05 ms）；单层循环有稳定的高频窄线，确有被听成“电机”的条件。原版 `ProcessGenericJet` 并未公开完整混音，不能断言原游戏怎样调度此文件。
- 16384 点 Hann FFT、0.05s hop：旧合成起飞 1–4s 的约 4.39 kHz 窄线为 46.5 dB（本脚本相对刻度），原版完整混音同频附近为 41.4 dB；5–8s 旧合成/原版约 49.8/45.7 dB。旧合成 3.5–8 kHz 中「主音线／其余频带」约 +6 dB，原版完整混音约 −6 至 −8 dB。两者主频接近，差别主要是合成声的窄线过突出、周围宽带声不足；后者可能含风声/环境声，不能直接认定为 WHINE 的缺失谐波。
- 8192 点局部 FFT 显示 W 在约 0.91s 开始后，旧合成 1.3s 就达到 40.2 dB、原版为 26.6 dB；原版尖啸在数秒内渐强。共享 `audio-engine.ts` 新增**推断** WHINE 响度控制：W 渐入时间常数 0.8s、松开渐出 1s、归一化控制平方并保留 5% 静音底；WHINE 音高原有较快惯性不动。速度权重由旧 0.35–1.0 降成 0.44–0.59，以避免巡航逐渐盖过其余声层。实时 WebAudio 和离线渲染仍读取同一 cue；Rustler 四层不动。
- 最新离线合成在 1.3/2.1/3.3/5.1/10.7s 的 4.2–4.6 kHz 主线相对刻度为 26.4/35.7/39.1/39.7/39.2 dB，原版为 26.6/34.7/39.2/40.2/39.9 dB。5–8s 全段合成/原版主线同为约 45.7 dB，9–11s 约 45.4/45.5 dB；但合成主线仍比其周围频带高约 5 dB，原版完整混音约低 7 dB。频谱接近**不代表**听感验收；原版完整混音、近似监听位置、浏览器重采样与离线线性插值均限制精确归因。尤其 30.9s 原版主线忽然下降而 W CSV 仍保持，当前推断代理无法解释，不为这一次变化硬造规则。
- 验证：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 0 错误，相关 58 个 vitest 通过（含 W 后 WHINE 响度渐入、音高先行的合成航迹回归），改动 TS 的 ESLint 0 错误、Prettier 通过；`build-flight-replay.ps1` 已发布。`scripts/test-standalone-pak.mjs` 对两份真实 v9 CSV 在第 2 秒第一人称截图通过且已人工查看：两机整图 562 cells、34 样本、4 声源、WebAudio ready、无游戏目录请求；`scan-no-assets.mjs` 0 泄漏。频谱验证不能代替用户试听，仍待听感反馈；未提交任何游戏资源或录音。

## 27. Hydra 原游戏声源调用核对与 v8 修复（2026-09-28）

- 用户用 §25–26 的滑块仍无法调出原版 Hydra 音色。此前把原版约 4.4 kHz 尖峰归给 WHINE29 是错误归因：HARRIER_FRONT/REAR 原样本约 3.99 kHz 的峰在约 1.1× 播放时也会落在约 4.39 kHz，并提供 WHINE 缺少的宽带纹理。v7 虽已烘四个推断候选样本，却**漏选**这两个玩家喷气主声源。
- 只读反汇编本机 `gta_sa.exe`（SHA1 `185b73fbceaa05d66452691fc0d15c8d61b92a7e`）：`ProcessGenericJet` 位于 `0x4FF900`；模型 520 命中分支 `0x4FF9BD`，在 bank 138 / slot 19 下分别调用 sound 10 HARRIER_FRONT、11 HARRIER_REAR、26 THRUST、14 JET_DIST。该函数的直接播放调用中没有 WHINE29 或 LIFT_LOOP15。名字与公开 `gta-reversed` `SoundIDs.h` 对照；公开 `ProcessGenericJet` 仍只调用原游戏地址，**本机静态代码证据不等于记录到实际运行时增益、播放状态或完整原版实现**。原版 `CAESound::CalculateVolume` 会减去 SoundMeta headroom；当前 Hydra 声层使用清单中的 headroom，而 Rustler 的已有推断混音不变。
- baker 的 Hydra 四层改为 FRONT/REAR/THRUST/JET_DIST，清单升至 **v8**；整图 `replayAssets.version` 仍为 3，样本仍共 **34** 个。HARRIER_FRONT/REAR 原速 loop 用约 5 ms 等功率接缝，Rustler 继续约 2 ms；实时 WebAudio 与离线导出都从共享 `audio-engine.ts` 时间线选择每层一份原速循环。旧 WHINE/LIFT 默认层及对应调音滑块移除，THRUST 的实验性中频支路默认关闭。Hydra 调音台仍有 13 个带数值的滑块，现控制真正播放的 FRONT/REAR、THRUST、JET_DIST 与可选 THRUST 中频诊断支路；v1 Hydra 旧参数留在浏览器原 key 供参考，新 v2 基准重新开始，Rustler 的 v1 设置迁移保留。
- Hydra 前后层的相对比例、W 响度平滑、基于已录位置速度的低速升响、音高速度微调，以及 THRUST 既有推力响度仍为 **inferred**。只以第一人称 v9 完整游戏 WAV 与近似源位离线合成对照：起飞 1–4s 六段频谱（低频至 8 kHz）合成与原版各差约 **0.06–0.67 dB**，巡航 5–10s 各差约 **0.37–1.03 dB**；静止首次 W 约 **+2.07/+1.60 dB**（合成/原版）。5–10s 最大相邻 5ms 响度差均约 **3.82 dB**，合成无 PCM clipping。窄带约 4.39 kHz 峰在起飞同位；9–11s 与 20–26s 的主峰位置及峰/底噪对比仍未一致，高速 W 的完整游戏混音有时降低而合成接近不变，不能把宽频拟合说成听感或逐帧原版混音已通过验收。
- 整图重烘尝试两次均在读取本地地图资源约 1.7 GB 处遇到 socket 提前关闭，未覆盖原有整图；为此 baker 增加 `--audio-only [gameInstallRoot]`，复用同一 GENRL 解码函数，只写现有 pak 的 `audio/` 与 `index.json.replayAssets.audio`。本机整图已按该入口更新为 v8，562 cells 和贴图保留。现存三个航迹 pak 均为 `replayAssets.version=2` 且无音频清单，不能使用该入口，必须完整重烘；本轮没有修改它们。`npx` 在此环境缺少其 npm CLI，实际使用 `node node_modules/tsx/dist/cli.mjs scripts/bake-map.mts map-pak --audio-only`。
- 验证：`tsc --noEmit` 0 错误、相关 vitest **59/59**、视频导出 **16/16**、修改过的 TS ESLint 与 Prettier 通过、`scan-no-assets.mjs` **0** 泄漏；`build-flight-replay.ps1` 已发布。两份真实 v9 CSV 的第 2 秒第一人称浏览器自测通过，截图已查看：Hydra/Rustler 各 **4** 声源、**34** 样本、562 cells、WebAudio ready、无 `/game-src` 请求；调音台两机截图已查看，数值、持久化、实时调节与导出快照自测通过。未提交或分发游戏资源/录音，最终听感仍待用户试听。

## 28. Hydra 油门响度动态（2026-09-29）

- 用户试听认可 §27 的 Hydra 音色后，指出 W/松开/S 的响度对比偏平。根因在 `audio-engine.ts`：当测得位置速度达到 40 m/s，Hydra 主声源的 `gainLoad` 固定为 0.75，不再区分推断推力 1/0.5/0；仅较轻的 THRUST 层继续响应。没有更换用户认可的 HARRIER_FRONT/REAR 样本、音高或声层比例。
- QPC 对齐的全程第一人称 v9 完整游戏 WAV 在约 63–75 m/s 的四次松开 W 边沿（11.584、13.951、15.610、31.729s），边沿后 0.2–0.45s 宽频相对边沿前下降约 1.46、2.15、2.20、1.99 dB；改前合成约 1.51、1.03、0.54、1.17 dB。该 WAV 含环境等完整游戏声，不能把这些值当隔离的原版发动机增益。高速再按 W 的两个边沿原版完整混音下降约 1.72、1.40 dB，而合成略升；可能有其他混音变化，不能从此硬造原版发动机响应。
- 当前 **inferred** 控制保留原有静止和低速公式；约 25–60 m/s 渐入新增的巡航响度差。满 W 基准不变；松开和 S 按录制 `1-brake` 推力代理降低响度，高速使用 0.12s 上升/0.25s 下降的既有平滑推力，实时 WebAudio 与离线导出共用此时间线。新增 Hydra“油门响度变化”滑块，显示 0.00–2.00×、默认 1.00×，可供用户把反馈连同具体数值回报；旧 v2 存储自动补默认字段。Rustler 混音分支没有改变。此曲线与运行时真实喷气增益都未实测，继续标 `inferred`。
- 同一比较脚本下，上述四次松开 W 的新合成宽频变化约 −2.18、−1.74、−1.23、−1.77 dB；静止首次 W 仍约 +2.07 dB（原版 +1.60 dB），合成 PCM 无削波。两次高速重新按 W 的原版完整混音仍与合成趋势不同，不能声称所有边沿已对齐或取得原版单独发动机声轨。
- 验证：`tsc --noEmit` 0 错误，音频/资源相关 vitest 60/60，改动 TS 的 ESLint 与 Prettier 通过，视频导出 HTTP 测试 16/16，`scan-no-assets.mjs` 0 泄漏；`build-flight-replay.ps1` 已重新发布。真实 v9 两机的 pak 浏览器自测仍为 562 cells、34 音频样本、4 个播放声源、WebAudio ready；调音台浏览器自测验证 Hydra 14/Rustler 10 个带数值滑块、保存与实时更新，最终发布版截图已人工查看。没有提交或分发本机游戏资源与录音，也没有覆盖原有未提交改动。主观听感仍需用户试听。

## 29. Hydra 机舱玻璃与观察镜头边界（2026-09-30）

- 用户截图中舱盖出现半圆形薄片边界。发布版前向机舱观察实测 `near=0.5`，本机 Hydra 默认眼位到舱顶三角平面最近约 0.194 m，近裁剪确实穿过舱盖。`CockpitLookCamera` 现在明确使用 0.03 m，不继承自由镜头的 near；现有普通机舱相机的 0.03 m 设置也已随本次构建发布。自动回头前探与手动抬高组合仍可能穿顶，因此新增 `aircraft-canopy.ts`，从本机舱盖/前风挡的 97 个三角平面推导保守活动范围，预留近裁剪面四角和 1 cm 余量。先约束自动前探，再叠加手动移动，避免触顶后按 W 移回却被不可见的前探量抵消。缺少有效内包范围的 mod 保持原始眼位，不强制移动到另一侧。
- Hydra 舱盖和前风挡的 67 个顶点 opt-in 到 `MaterialClass.canopy=6`，机鼻玻璃灯罩的 7 个顶点、金属框架和 Rustler 不使用新材质。保留原始几何和法线，使用轻微色调吸收、双面随视角变化的 Fresnel 环境反射及柔和日/月高光，绕开原始 50% 材质透明度与车漆式漫反射。反射颜色复用现有天空/云与可用的场景探针，是实时近似效果，未实现光线追踪、舱内仪表的精确倒影或真实折射。不需要重新烘焙 pak，没有新增游戏资源。
- 验证：`tsc --noEmit -p tsconfig.json` 0 错误；机舱/相机/着色器相关 15 项 vitest 通过，模型构建的无资源依赖测试 43 项通过。`scripts/test-canopy-geometry.mts` 用本机两架飞机验证材质范围、584 个转头/移动极限组合，近裁剪面包围球距玻璃至少 1 cm；Rustler 元数据不变。`scripts/test-cockpit-look.mjs` 的前/侧/后看和双向 W/S 通过，实测自动前探约 0.374 m；`scripts/test-canopy-views.mjs` 在最新 Hydra 录像 152.56 秒检查前向、抬头、回头移动极限、夕阳和普通机舱，5 张截图已查看，无 WebGPU 验证错误。截图保存在 gitignored `captures/canopy-final-*.png`；已运行 `build-flight-replay.ps1` 发布。扩展模型测试中另有 3 项本地 fixture 不匹配（cabbie VehFuncs、摩天轮 UV 动画名字/周期），使用 HEAD 原版材质定义复跑仍同样失败，与本次修改无关。保留原有未提交工作，未提交游戏资产。

## 30. Hydra 固定烟灰玻璃（2026-09-30，替代 §29 的动态反射）

- 用户明确放弃随视角/光照变化的反光与高光，改要原版风格的偏黑玻璃，舱内像透过固定滤镜观察。`MAT_CANOPY` 现在直接输出近黑色的预乘透明颜色，不再使用 Fresnel、环境倒影、日/月高光或漫反射；舱内固定 alpha 0.22，外侧固定 0.50，属于观感调节，不声称复现原版全部材质公式。仅保留通用远距离雾合成。此前的 0.03 m 近裁剪与舱盖活动范围保持不变，地图无需重烘焙。
- 验证：tsc 0 错误，着色器测试 6/6、修改的引擎 TS ESLint 通过，重新构建发布。`test-canopy-views.mjs canopy-smoke` 的 5 个舱内角度/光照截图通过且已查看前向和夕阳，无 GPU 验证错误；舱外截图 `captures/hydra-smoke-exterior.png` 已查看。舱外脚本修正为读取实际导出 GPU surface 的完成帧，避免误读停留在启动画面的 DOM canvas；它仍带导出 HUD，主要检查飞机玻璃。未增加或修改游戏资产。

## 31. 按实机截图恢复两机玻璃差异（2026-09-30，替代 §30 的纯色 Hydra）

- 用户提供 Hydra 舱内/舱外实机截图，并补充 Rustler 应只有墨镜式压暗。核对本机 pak：两机玻璃均引用 `vehiclegeneric256`、材质 alpha 128；Hydra 另有 `vehicleenvmap128` 环境贴图及 reflection intensity 0.15，Rustler 没有 env-map、reflection intensity 为 0。Hydra 纹理不是凭空生成的划痕；本机共享 TXD 的原始图片是一张有天空、太阳和水面的环境图。此前模型构建器主动丢弃 env 贴图层，§30 又改成纯色，故缺少原图所示的拉伸纹理。
- 公开依据：[gta-reversed 的 PC 车辆管线](https://github.com/gta-reversed/gta-reversed/blob/master/source/game_sa/Pipelines/CustomCarEnvMap/CustomCarEnvMapPipeline.cpp) 的 EnvCam 使用相机空间法线、三坐标投影、随世界位置的 50 m 周期偏移和环境图加法，再按材质 alpha 混合；[SkyGfx](https://github.com/aap/skygfx) 也提供多平台车辆管线的公开实现。本次参考公开逆向实现与本机资产，没有采用泄露的私有源码。2021 年重制版相关报道中，[PC Gamer 对数据挖掘者的采访](https://www.pcgamer.com/dataminers-are-finding-developer-comments-and-unlicensed-songs-in-gta-trilogy-as-rockstar-games-launcher-remains-offline/)具体确认的是未编译任务/脚本源文件，不能据此称获得了完整图形引擎源码。
- `VehicleBuildOptions.preserveEnvMaps` 默认关闭，仅 Hydra 回放启用；`VehicleTextures.resolveEnvMap` 遇到缺失原图返回无贴图，不用白图制造反光。`MAT_CANOPY` 读取保留层，按 stock Hydra 的单位纹理缩放近似 PC 投影；内外侧均使用原始基础贴图和深色透明混合。为适配 OpenSA 的线性 HDR/ACES，alpha 使用 `1-(1-a)^1.5`（原始 128/255 对应约 0.648），环境强度使用 `(intensity*1.85)^2.2`，夜间降至白天的 0.08；这些是回放观感适配，不是原版逐像素公式或已录下的原版动态照明。没有恢复 §29 的实时探针、Fresnel 或日/月高光。当前投影针对本机 stock 材质，未实现任意 mod 的非单位 env UV 参数。
- Rustler 非反射玻璃在通用构建器中是 matte，现按其 128-alpha generic 材质和座舱空间范围识别并使用同一深色透明材质，环境贴图贡献保持 0。只作用于实际玻璃，不做整屏滤镜；螺旋桨、仪表、金属框架、LOD、Hydra 机鼻灯罩不被误标。Rustler 同时加入模型推导的镜头活动范围（70 个平面、65 个玻璃顶点）；Hydra 仍为 97 个平面、67 个玻璃顶点，保留 0.03 m near。
- 验证：tsc 0 错误，相关 vitest 28/28 和模型构建无资产依赖测试 43/43，修改的材质/构建器/着色器 TS ESLint 通过；本机两机各 584 个极限眼位测试通过（最小近裁剪包围球间隙 Hydra 0.0100 m、Rustler 0.0449 m）。已重新构建发布。`test-canopy-views.mjs` 新增指定 CSV/时间并用路由替换默认记录，避免多轨重叠；两机各 7 个视角（前、上、侧、后看移动极限、夕阳、夜间、普通机舱）通过且无 WebGPU 验证错误。截图在 gitignored `captures/canopy-final-{hydra,rustler}-*.png`，前/侧/后/夜间及两机舱外截图已查看；舱外导出脚本只用于检查飞机玻璃，其地图预热不足仍是既有局限。`scan-no-assets.mjs` 0 违规；未改写或提交游戏资源，已有 pak 无需重烘焙。

## 32. Hydra 去除照片斑点，保留克制的弧纹（2026-09-30，替代 §31 的环境照片）

- 用户指出太阳/云层状纹理挡视线，希望只保留较淡的圈状层次。确认斑点来自 `vehicleenvmap128` 的太阳和天空照片；现移除 Hydra 对这张图的加载与采样，同时删除已无使用者的 `preserveEnvMaps` / `resolveEnvMap` 支路。原始游戏 TXD 没有改写，pak 不需要重烘焙。
- `MAT_CANOPY` 保留原始基础贴图、材质 alpha 的 HDR 适配和烟灰色透明混合；Hydra 改为基于模型局部法线的低对比度弧形轮廓，不再投射景物照片。轮廓沿玻璃固定、以平滑余弦控制宽度，线性颜色贡献上限 0.01（随后乘玻璃 alpha），夜间降到 0.08 倍。角度坐标有界且亚像素频率淡出，避免旧投影在掠射角产生密集重复条纹。属于按用户偏好调节的装饰层，并非原版逐像素复刻或真实光学反射。
- Rustler 原始 reflection intensity 为 0，继续只有墨镜式压暗，不增加弧纹。两机玻璃范围、相机 near 0.03 m 和舱盖活动边界保持不变。
- 验证：最终 tsc 0 错误、着色器/纹理 19 个测试通过、修改的引擎 TS ESLint 通过、diff whitespace 检查通过；两机各 584 个眼位的模型边界检查通过。两机各 7 个舱内视角通过且无 WebGPU 验证错误，Hydra 前/上/侧/后/夕阳/夜间及 Rustler 前向截图已查看。清理未使用的照片通道后重新发布并检查 Hydra 舱外导出帧。截图位于 gitignored `captures/canopy-subtle-{hydra,rustler}-*.png`；未提交或分发游戏资产。

## 33. 恢复 Hydra 流动线纹（2026-09-30，纠正 §32 的静态替代）

- 用户澄清：只要求去掉太阳/云层图案，没有要求取消原来会动的线条。§32 把纹路绑定到模型局部法线，错误地取消了原 EnvCam 的流动，本轮移除该静态余弦圈纹。
- 恢复相机空间法线投影和世界位置 / 50 的偏移，转头、飞机运动均会推动线纹；没有添加脱离飞行姿态的时钟滚动，暂停静止时保持稳定。重新启用 Hydra 独占的 `preserveEnvMaps` 和 `resolveEnvMap`，仍读取本机 `vehicleenvmap128`。着色器只取该原图左下方的水面：U 为 0.035/0.095/0.155/0.215 四列，V 为 0.55–0.87，避开天空、太阳及中心太阳倒影；按行平均为连续线纹，避免波峰亮点又投成斑点。镜像重复消除裁取边界，投影两轴驱动纹路相位。
- 保留原始烟灰底色及 HDR alpha；线纹中性化后贡献上限 0.015、再乘玻璃 alpha，夜间为 0.08 倍；按屏幕导数淡出无法分辨的密集细节，避免回头掠射时出现满屏摩尔纹。此为原图线纹及原投射运动的简化适配，不是完整原版照片或逐像素复刻。Rustler 没有环境图层，线纹贡献为 0，仍是纯墨镜式玻璃。原始 TXD / DFF 未改写，pak 无需重烘焙。
- 增加 `scripts/test-canopy-motion.mjs <Hydra CSV>`：在测试浏览器中仅改写材质的最终输出，隔离实际 GPU 线纹信号，不修改生产文件或原 CSV。飞机和相机共同平移 12.5 m 后，上方纯玻璃区域的平均像素差为 28.85/255；返回原位置为 0；转头后为 38.28/255，暂停稳定检查通过。这些数字来自增强对比度的诊断输出，不代表正式画面的线纹强度。
- 验证：tsc 0 错误，着色器/纹理 19 项与无资产依赖模型构建 43 项通过，修改的引擎/构建器 TS ESLint 通过；两机各 584 个极限眼位检查通过。已构建发布；Hydra 正式材质 7 个视角检查无 WebGPU 错误，前/侧/后截图和动效诊断帧已查看，截图位于 gitignored `captures/canopy-flow-hydra-*.png` / `canopy-motion-*.png`。诊断路由只存在于一次性测试浏览器，用户页面始终使用正常的深色透明玻璃。

## 34. 只替换环境图片，保留原版投射动效；降低线条密度（2026-09-30）

- 用户指出 §33 正常画面完全看不到纹理。原因是深色水面取样、按行平均后再以 0.015 上限叠加，实际对比度太低；此前增强对比度的运动诊断只能证明坐标会动，不能证明正常画面的可见度。提高强度的临时版本已被下面的贴图替换方案替代。
- 用户授权自行制作纹理，并明确要求「原贴图替代一下，但是又是原版的纹理效果」。新增 `apps/web/src/flight/canopy-texture.ts`，在 Hydra 模型首次 GPU 上传前，直接替换其既有环境图层的 RGBA 内容与调试名字（`replay_canopy_lines`）。使用自行编写的周期灰度细线生成图像，无太阳、云层或游戏照片像素；不写回 TXD，不增加世界纹理上传，不改模型几何或基本玻璃底色。Rustler 无 env 层，不执行替换。
- 材质现在直接以 §31 的相机空间法线投影和世界位置 / 50 偏移采样替换后的原图层；去掉 §33 的裁取、按行平均、两轴混合和 §32 的静态轮廓公式。保留原有 HDR alpha 与 `(intensity*1.85)^2.2` 增益适配、夜间 0.08 系数；只对屏幕上无法分辨的密集重复作淡出。属于保留原版投射方式的自制图片替换，不声称逐像素重现整套原版图形管线。
- 第一张新图每周期 10 条，用户查看正常截图反馈过密。最终改为每周期 **3 条**（位置 0.115/0.425/0.825，减少 70%），保留细线宽度和连续流动；灰度峰值 180/164/148，轻微周期弯曲。最终正常截图 `captures/canopy-sparse-front.png` 可直接辨认稀疏线纹，无须诊断增强。
- 验证：最终 tsc 0 错误、着色器 6/6、相关 TS ESLint 和 whitespace 检查通过；模型替换与两机各 584 个眼位检查通过。已重新构建发布，正式材质 7 视角截图检查通过且无 GPU 验证错误。运动诊断现在共同平移 GTA X/Y 各 12.5 m，以覆盖原版两个投射轴；新图的平移、返回、暂停和转头检查通过。地图无需重烘焙。

## 35. 座舱内部倒影试验版（2026-09-30，替代 §34 的滚动线纹，待用户验收）

- 用户认为圈线仍然不自然，授权尝试调研后的「烟黑底色 + 本机座舱倒影 + 少量周边擦痕」。参考公开的 [FlightGear 舱内倒影说明](https://wiki.flightgear.org/ALS_technical_notes#Internal_cockpit_reflection)、[X-Plane 透明与反射分离](https://developer.x-plane.com/article/x-plane-11-material-model/) 和 [MSFS 玻璃细节材质](https://docs.flightsimulator.com/msfs2024/html/3_Models_And_Textures/Modeling/Aircraft/Airframe/Windshield_And_Windows.htm)。本版是自行实现的近似方案，不是移植这些游戏的渲染代码。
- `canopy-texture.ts` 在 Hydra 首次 GPU 上传之前，用本机已加载的 DFF/TXD，捕获驾驶员眼位附近 2.5 m 内的完整、不透明座舱几何。透明玻璃、损坏和 LOD 网格不进入倒影。各玻璃部件按自己的局部方向生成八面体全方向贴图（stock 256×256），保留颜色与覆盖 alpha，软化轮廓；后接一层确定性的稀疏断续擦痕。stock 两个玻璃部件增加四个小纹理层，不改写游戏或 pak，不替换任何已常驻 GPU 纹理数组，不增加实时场景捕获。
- 着色器使用局部法线和眼向量逐片元计算反射方向；已去掉旧的相机法线除 Z 与世界位置 / 50 滚动。倒影随转头变化，飞机和相机共同平移时保持附着于座舱。擦痕按部件局部米制坐标固定、侧面渐显。Rustler 无捕获层，保持原来的均匀烟黑玻璃；Hydra 舱外也保留基础染色，不叠加舱内倒影。太阳/云照片、太阳高光和规则圈线均未恢复。
- 保留原烟黑 alpha 适配 `1-(1-a)^1.5`。倒影混合量为覆盖 alpha × `(0.12+0.18*grazing)` × 昼夜系数，夜间降至 0.08；颜色按环境光与太阳颜色作低频明暗近似，没有精确的座舱自阴影、移动仪表更新、近距离视差校正或实时外景倒影。这是已实现并可验收的第一版，不能把自动化通过称为真实感验收通过。
- WebGPU 注意：`front_facing` 也计入 16 个片元输入限制，不能再加第 16 个用户 varying。现将 `layer/nightLayer` 合并为 `vec2u layers`，腾出一个位置传局部法线；通用玻璃的隐式导数采样须留在 canopy 提前返回之前，以满足 uniform control flow。
- 验证：tsc 0 错误；新增捕获方向、旋转部件、隐藏几何排除测试 3/3，着色器 6/6；相关 TS ESLint 通过（现有 Nx graph 缺失警告）；两机各 584 个眼位检查通过。Hydra 最终 7 视角与 Rustler 7 视角截图通过，无 GPU 错误。运动诊断改为验证共同平移不滚动、暂停稳定、返回可重复、转头变化（平均差：平移 0.0081/255，返回 0，转头 5.262/255；这是隔离倒影的诊断输出，不是正式可见度指标）。已构建发布，正式截图 `captures/canopy-cockpit-final-*.png`、`canopy-cockpit-rustler-*.png`，舱外 `canopy-cockpit-exterior.png`；原游戏资产与地图无需重新烘焙。

## 36. 修正舱内倒影与侧面擦痕的实际可见度（2026-09-30，待用户验收）

- 用户否定 §35 的实际可见度。用其 `flight_20260928_002942_500_m520_002.csv` 的 **27.165 s** 倒飞姿态复现；旧捕获贴图非空，但中位颜色仅约 41/255，经过 sRGB 解码和低照明系数后主要变成整片压暗，倒影轮廓难以识别。旧擦痕随机落在图集上，有效侧窗覆盖很少，在该正常截图中开关擦痕的全图最大差只有 **3/255**。先前只检查上方区域还会误报完全零差值；现在检查包含下方侧窗的完整可视区域。
- 倒影中间调单独用 `pow(rgb, 0.45)` 提亮，按亮度平滑抑制近黑捕获，保持 `(0.12 + 0.18*grazing)` 覆盖混合并调整低频照明；不改变基础烟黑透射。捕获软化由 5×5 降为 3×3，避免轮廓被抹掉。捕获射线现在遇到舱盖先终止，不把其后方的舱外机身面算作内景；新增无游戏资产的遮挡行为测试。仍是静态本机座舱的近似倒影，不是实时镜面或原版逐像素还原。
- 擦痕改为按每个部件实际侧窗三角形选取锚点，生成 12 条短弧片段并沿局部 YZ 米制坐标固定；峰值 alpha 190，正常 shader 贡献上限 0.06、侧面渐显。stock 各部件的非零纹理像素约 0.31%/0.38%。转头时倒影变化，擦痕附着于玻璃；Rustler 依旧无捕获层、无擦痕，只有染色。夜间系数保持 0.08，未恢复太阳/云照片或规则圈线。
- 新增 `scripts/test-canopy-visibility.mjs [tag] [Hydra CSV] [seconds]`：在独立测试浏览器中分别关闭倒影/擦痕，与**正常输出**作对照，不增强画面。最终同一姿态比较区内倒影 p95 差值 **41/255**，擦痕最大 **41/255**，擦痕差值大于 4 的像素 **9,122**，约占比较区 0.58%；脚本检查两者可见且擦痕不过度覆盖。正式画面 `captures/canopy-visibility-refined-on.png`，各贡献关闭后的图片及 JSON 同前缀；试调过亮的 `canopy-visibility-after-*` 不是最终版。这些数字验证可见性，不代表真实感已经获得用户认可。
- 验证：最终 tsc 0 错误、捕获/着色器测试 10/10、相关 TS ESLint 和 Prettier 通过；两机各 584 个眼位检查通过。已构建发布 `flightReplay-C2vIcfWx.js`。Hydra / Rustler 各 7 个正常视角通过并查看 Hydra 前/侧/上/夜间和 Rustler 前向截图；运动诊断平移差 0.058/255、返回 0、转头 28.806/255，暂停稳定，无 WebGPU 验证错误。地图和原始游戏文件不需要重烘焙或改写，所有截图仅在 gitignored 的 `captures/`。

## 37. 降低默认机舱观察眼位（2026-09-30）

- 用户以飞行员坐姿照片对照，认为 `机舱观察` 默认视角过高。移除座椅眼位额外的 0.12 m 抬升；保留向后 0.20 m 偏移，因此 Hydra/Rustler 机舱与机舱观察共用的默认眼位现在是 `ped_frontseat` 上方 0.62 m。原版第一人称眼位本来也是该高度，保持不变。参考照片无法给出精确的 GTA 模型坐标，此值是实景截图对照后的视觉调整。
- 保留 Hydra 静态座舱倒影的既有捕获位置，避免高度调整同时改变玻璃材质观感。两机的机舱活动边界测试锚点、浏览器眼位断言随之更新；未改原始模型、pak 或录音。
- 验证：`tsc --noEmit` 0 错误，相关 vitest 13/13，两机各 584 个机舱极限眼位检查通过；重新构建发布。Hydra/Rustler 真实录像的默认机舱浏览器截图及 Hydra 机舱观察的前/侧/后、W/S 和回头前探通过，截图在 gitignored `captures/cockpit-*-seat-height*.png`、`cockpit-look-pilot-seat-height-*.png`，均已人工查看。

## 38. 撤去不自然的座舱捕获，改为极少量细表面痕迹（2026-09-30，待用户验收）

- 用户明确否定 §36：仍然很假。正常抬头图可见大块灰色多边形，原因是低模座舱的单点捕获经中间调提亮后，把粗糙面片轮廓突出成漂浮形状；旧低分辨率擦痕也呈宽白碎片。本轮移除捕获及额外四个贴图层，删除没有运行使用者的 `canopy-texture.ts` / 捕获测试。烟黑透射公式继续为 `1-(1-a)^1.5`，不改变 §37 已调低的相机眼位、舱盖几何或相机边界。
- Hydra 的 canopy 材质 coefficient 现在只启用局部坐标的解析表面痕迹，不引用任何环境图片。按 0.125 m 单元稳定选择约 8% 的单元，每个只有一条两三厘米尺度的短弧片段；解析距离和屏幕导数抗锯齿使宽度接近细线，避免小贴图过滤出的白色宽带。只在侧窗内面渐显，线性亮度贡献为 `0.016+0.014*grazing` 乘覆盖与昼夜系数，夜间系数 0.08。痕迹沿玻璃固定，转头改变投影与可见度，没有时钟滚动或独立漂浮物。Rustler coefficient 为 0，仍只染色。此版是更克制的简化表面方案，**没有真实座舱镜像**，也不声称用户已认可真实感。
- `test-canopy-visibility.mjs` 改为正常材质的表面细节开关对照，不再要求被撤去的倒影可见。用户录像 27.165 s 的新版 `captures/canopy-fine-surface-final-{on,off}.png` 比较区中最大差 15/255，大于 4 的像素 174（0.011%），没有旧的大面积灰白块。该指标仅验证可见与覆盖很少，不是主观真实感验收。相机采用当前 §37 眼位，与 §36 旧截图眼位不同，不应当把两图宣称为完全相同相机的 A/B。
- 运动诊断原来只检查上方矩形，细痕不在其中而返回零；改为测试输出用蓝色标记玻璃、红色隔离痕迹，比较全图有效表面信号，排除转头时移动的仪表和舱框。诊断平均差：共同平移 0.00487/255、返回 0、转头 0.04203/255（263 个像素差大于 4）；暂停稳定。这些是增强诊断输出，正式用户画面仅用正常强度。
- 验证：最终 tsc 0 错误，着色器/舱盖测试 10/10，相关 TS ESLint / Prettier 通过；两机各 584 个眼位检查通过。最终网页已发布 `flightReplay-1XhjjX1h.js`，Hydra / Rustler 各 7 个正常视角通过，已查看 Hydra 前/侧/上/夜间与 Rustler 前向，无 WebGPU 错误。无需重烘地图，没有改写或分发游戏资源。真实感仍待用户实际反馈，不应继续把“自动化通过”描述成视觉验收通过。

## 39. 曲面细划痕与迎光显现（2026-09-30，待用户验收）

- 用户要求划痕贴合舱盖弧度、增加数量、由太阳或其他光线照出来，并授权试做。研究后区分舱内迎光散射与舱外反射：单纯染色/按昼夜变亮不足以表达此效果。本机 Hydra 原始 UV 没有退化，但部分三角形拉伸严重；旧 YZ 平面投影及侧面限定也使顶部细节不足。
- 新增 `apps/web/src/flight/canopy-surface.ts`：仅从已标记玻璃的本机顶点推导横截面椭圆参数，积分圆周弧长、搭配纵向米制坐标。拟合只用于细节坐标，不移动几何，不替换原始法线或基础 UV。Hydra 67 个玻璃顶点的四个闲置 reflection 字节编码两个有符号定点坐标（1/4096 m，offset 32768），顶点阶段解码后插值；没有增加纹理层、GPU 缓冲或纹理数组替换。超出可编码范围的 mod 禁用整个细节层；Rustler 保持零字节、只有烟黑底色。
- 划痕改为两种尺度的随机短曲线（32 / 8 单元每米，选中率 0.78 / 0.45），包括顶部、前风挡与侧窗。解析亚像素覆盖避免把微小细痕扩成宽白带；位置和随机种子固定在玻璃上。世界空间切线由细节 UV/实际表面导数求得，并结合原始插值法线、划痕方向、太阳/月亮方向和眼向量，近似方向性透射散射及同侧反光。太阳贡献随实际太阳颜色、直射强度及高度变化；保留微弱背景磨痕和既有烟黑透射。此为薄壳实时近似，未实现完整折射 BSDF、波光学衍射、精确舱框光照遮挡或局部灯源逐片元散射。
- 新增 `scripts/test-canopy-lighting.mjs`（`node --import tsx scripts/test-canopy-lighting.mjs <tag>`）：使用正式天空太阳轨迹计算眼位朝向，检查正常输出的细节 on/off，不增强或重着色。`canopy-lit-sun-final` 正对太阳的像素最大差 99/255、差值超过 4 的像素 3842（0.212%）；斜看 3009（0.166%）；同眼位将时间改为 7 点移动太阳后最大差 3，夜间最大差 4。指标验证光照响应，不能作为用户真实感验收。已查看正常迎光/斜看截图。旧 visibility 脚本现在检查倒飞背光时没有显著白痕：最终 `canopy-lit-backlight-final` 最大差 4，超过 4 的像素为 0。
- 验证：tsc 0 错误，相关 vitest 13/13，相关 TS ESLint / Prettier 通过；两机各 584 个眼位、原始几何/法线/基础 UV 不变及 detail 编码检查通过。Hydra / Rustler 各 7 个视角无 WebGPU 错误。最后清理未使用的 local normal/view 插值量，把坐标单独打包为一个 vec2 varying，发布 `flightReplay-Dua4X5Hy.js`；最终运动诊断平移差 0.00418/255、返回 0、转头差 0.02990/255（2317 个像素差超过 4），暂停稳定；最终正常背光对照通过，无 GPU 错误。截图和报告均在 gitignored `captures/`，地图无需重烘焙，未改写或提交游戏资源；保留此前其他未提交工作。
## 40. 中性清透机舱盖（2026-09-30，替代烟灰底色，待用户验收）

- 用户指出烟灰玻璃导致夜间过黑，要求恢复白色透明并搜索旧记录。已查到先前「原版玻璃是偏黑色的。看看能否加上这个元素」的请求及后续保留烟黑底色的实现记录；未找到明确要求白色透明的旧消息。本轮以用户最新要求为准。
- `MAT_CANOPY` 不再使用原始深色纹理 RGB 和 `1-(1-a)^1.5` 的烟黑混合；改为随环境天空照明变化的中性清透底色，alpha 为原始材质/纹理 alpha 的 0.04 倍。stock 128-alpha 从约 0.648 降至约 0.0201，避免明显压暗夜景或恒定白色自发光。Hydra/Rustler 共用；保留 §39 曲面坐标、划痕和太阳/月亮响应，不改模型、相机或游戏资产，无需重烘焙。
- 验证：tsc 0 错误，着色器测试 6/6（更新输出快照），相关 ESLint / Prettier 通过；构建发布 `flightReplay-q_RXOvTe.js`。两机各 7 个正常视角无 WebGPU 验证错误，已查看 Hydra 前向/夜间、Rustler 夜间和正常迎光截图。`canopy-clear-sun` 正常输出对照迎光最大差 38/255、超过 4 的像素 2297（0.127%），斜看最大差 41、像素 1965（0.108%）；同眼位移动太阳和背向最大差均为 2，夜间为 3，光照响应检查通过。截图位于 gitignored `captures/canopy-clear-*.png`；这些检查不替代用户的主观观感验收。

## 41. 舱外烟熏、舱内清透（2026-09-30，待用户验收）

- 用户反馈 §40 在舱外完全看不见玻璃，要求外面恢复原版烟熏观感、里面保持清透。`MAT_CANOPY` 现按实际网格正反面 `front_facing` 分开响应：外侧恢复原始纹理 RGB × 材质 RGB，以及之前 `1-(1-a)^1.5` 的烟熏 alpha；内侧仍为 §40 环境照明中性底色和 `a*0.04` 的清透 alpha，保留 §39 内侧受光划痕。判断不依赖用户相机模式，对自由相机及其他飞机同样成立。这是回放的双面视觉适配，不是物理单向透射，也不声称逐像素复刻原版渲染。
- 验证：tsc 0 错误，着色器测试 6/6（更新快照），相关 ESLint / Prettier 通过；发布 `flightReplay-ChOrsnDO.js`。两机各 7 个机舱视角通过，无 WebGPU 错误；两机前向及夜间截图与 §40 同眼位截图逐像素比较，最大 RGB 差均为 0。运行 `test-aircraft-glass.mjs` 检查两机自由相机舱外近景，已查看烟熏舱盖轮廓；脚本补充 GPU 错误检查与固定昼间参数。导出近景的地图预热不足仍为该脚本既有局限，不影响玻璃检查。截图为 gitignored `captures/canopy-sided-{hydra,rustler}-*.png`。无需重烘地图，不改写或分发游戏资源。

## 42. 淡的局部座舱倒影（2026-09-30，试验版，待用户验收）

- 用户在研究方案后选定「淡的局部座舱倒影」。新增 `apps/web/src/flight/canopy-reflection.ts`，从本机已加载模型提取舱盖/座椅范围内、朝向舱内的静态不透明 chassis 面片，排除玻璃、舱外机身、移动门/起落架、损坏和 LOD。Hydra 101 个三角形 / 19376 字节，Rustler 175 个 / 33584 字节。没有捕获环境照片、改写游戏文件或新增纹理层。
- 构建带跳出链接的局部 BVH；内侧玻璃片元根据实际世界位置、插值法线和眼位发出反射射线，转换到对应实例的 chassis 坐标，取 4 m 内最近交点及其重心 UV，采样既有本机 TXD。转头/移动眼位会产生近距离视差，飞机共同平移不会按世界坐标滚动。这是 WGSL 软件局部求交，不依赖硬件光追，也不是全场景/多次反弹光追。
- 使用命中面片的平均顶点颜色/法线和昼夜材质，按当前环境、太阳/月亮方向近似照明；没有 gamma 提亮或灰色捕获图。反射采用受限 Fresnel：`min(0.04+0.96*(1-|N·V|)^5,0.12)*0.60`，再按反射源亮度渐显、夜间降至 0.20。后两项是保护清透视野的艺术适配，不是严格物理玻璃参数。与透射作预乘 alpha 合成，保留受光划痕，外侧直接返回零倒影并继续 §41 烟熏玻璃。
- `VehicleModelInit` / `RigidModelInit` 增加可选 packed 数据，rigid binding 11 为模型专属只读 storage，矩阵 binding 0 增加 fragment 可见性；最后一个空 varying 携带矩阵行号，仍满足含 `front_facing` 的 16 输入限制。其他模型绑定空 header，直接跳过求交。独立缓冲随模型销毁，不加入顶点缓冲列表、不替换纹理数组；最大 512 三角形 / 1023 BVH 节点，超过上限整层禁用，遍历最多 1024 次，防止无界 GPU 循环。当前直接在可见内侧玻璃片元计算，没有增加六面实时捕获或半分辨率后处理；尚未做帧率基准。
- 原型曾把 storage 缓冲误放入顶点列表，导致黑帧，已修正。`test-canopy-views.mjs` 补充 Invalid CommandBuffer/usage 检查和非黑帧断言，避免旧脚本只匹配部分错误而误报通过。新增 BVH 编码、树包围/跳出链接及超过预算禁用测试 3 项；geometry 脚本确认本机两机 BVH 有效、原始几何不变，两机各 584 眼位通过。
- 最终正常输出开关对照 `test-canopy-reflection.mjs`：Hydra 前/侧最大差均为 6/255，超过 4 的像素分别 4379（0.241%）/5720（0.315%），抬头最大差 3，夜间 1；Rustler 前向最大差 10（1.189% 像素超过 4），侧面 8，夜间 3，夜间超过 4 的像素均为 0。正常对照中只有新倒影开关变化，清透底色/划痕/场景一致。已查看两机正式画面；实际轮廓仍受 GTA 低模座舱细节限制，未实现飞行员、动态仪表、移动部件倒影、精确日照遮挡、玻璃厚度/折射或粗糙反射积分。
- 最终增强诊断 `test-canopy-motion.mjs <Hydra CSV> reflection`：共同平移平均差 0.2724/255，返回原位置为 0，转头 40.5884，前后移动眼位 27.9350；该增强输出只验证附着、复现和视差，不能当作正式反射强度。正式强度见上面的正常对照。tsc 0 错误，相关引擎/编码测试 55 项通过，相关 TS ESLint / Prettier 通过。发布 `flightReplay-Oi-idj2w.js`，截图/报告在 gitignored `captures/canopy-reflection-final-*`，无需重烘地图；原始游戏资源及其他未提交工作保留。
- 最终回归：Rustler 7 个正式视角、两机各 4 个正常倒影开关对照通过；两机舱外烟熏玻璃近景通过并查看 Hydra，外侧表面没有新增反射，透过近面仍可看到远侧的内表面弱倒影。既有划痕迎光最大差 38、斜看 41，移动太阳/背向最大差不超过 2、夜间 3；划痕运动诊断共同平移差 0.00352、返回 0、转头 0.02897，无 GPU 错误。正常倒影对照报告单独保存为 `*-ab.json`，避免与同标签视角脚本的相机记录 JSON 覆盖。

## 43. 倒影小幅增强（2026-09-30，待用户验收）

- 用户能隐约看到 §42 的倒影，要求「明显一点点」。仅把倒影权重系数从 0.60 调为 0.75（增加 25%），保持曲面射线/近距离视差、暗色抑制、夜间 0.20 衰减、内侧清透、外侧烟熏与划痕算法。
- tsc 0 错误，着色器 6 项测试通过并更新快照，Prettier / diff 检查通过；构建发布 `flightReplay-rcSbbNrm.js`。两机各 4 个正常倒影开关对照通过，无 GPU 错误，已查看 Hydra 正式前向截图。Hydra 前/侧最大差由 6 增至 7/255（超过 4 的像素 1.295% / 1.103%），抬头最大差 4，夜间仍为 1；Rustler 前向 13、侧面 10、夜间仍为 3，夜间超过 4 的像素均为 0。报告为 gitignored `captures/canopy-reflection-plus-{hydra,rustler}-ab.json`，正常截图同前缀；无需重烘地图。

## 44. 座舱仪表规划、删除分析面板与半透明摇杆（2026-09-30）

- 用户选定空速、姿态、油门、海拔、方位、机身健康/舵面受损灯、喷口、起落架；方位放在现有绿色瞄准玻璃。已制作基于实际 Hydra 座舱截图的布局草图，动态仪表本身尚未接入模型或数据。原模型主面板最大宽约 0.755、垂直高约 0.402 游戏单位，上沿收窄；规划三个主表（左速度、中姿态、右海拔），健康窄条/损伤灯，下排油门/喷口/起落架紧凑状态格。尺寸仍需后续实际三维贴合验证。
- 完整删除浮动分析面板的 DOM、CSS、更新及视频导出叠加，移除 `analysis-hud.ts`、`analysis-hud-canvas.ts`、`analysis-overlay.ts` 和旧导出 HUD 测试。新 `replay-navigation.ts` 仅保留自由相机输入、终点列表及定位行为；原始数据、天气、音频等独立界面继续使用。无界面的指标计算库保留供后续仪表使用。
- `cockpit-stick.ts` 在运行时识别原始 Hydra 的完整摇杆柄和两段杆壳（48 个顶点），仅重排子网格索引并设顶点 alpha 为 64/255，使用既有透明渲染路径；重叠表面实际看起来更浓。位置、法线、UV 和每个三角形不变，原模型/贴图文件不改。匹配不完整或顶点被其他几何共用时不处理；Rustler 不处理。摇杆设为哑光并排除静态不透明座舱倒影，不改变玻璃算法或世界纹理数组。
- 数据限制：当前 CSV 没有真实舵面损伤状态，缺少节点/四元数不能推断受损，需扩展 recorder 才能实现可靠告警；旧记录应显示未知。现有速度是游戏三维运动速度，不能宣称真实 IAS/TAS；用户选定的海拔可使用游戏世界 Z。喷口/起落架需按现有记录版本区分可用/未知。
- 最终 tsc 0 错误，相关相机/终点测试 3 文件 10 项通过；真实模型摇杆检查通过（Hydra 48 顶点、Rustler 0、几何完整且未改变）。Prettier / diff 检查通过，相关 TS ESLint 0 错误（保留原有 33 项返回类型警告）。已发布 `flightReplay-BPoE-CI2.js`；`test-cockpit-dashboard.mjs cockpit-dashboard-published` 前向透明/不透明对照、正常眼位、侧向、夜间及 1920×1080 GPU 导出通过，无 WebGPU 错误且分析面板计数为 0，对照变化 36541 像素。截图在 gitignored `captures/cockpit-dashboard-published-*`。无需重新烘焙地图或安装 recorder；其他未提交改动保留。

## 45. Hydra/Rustler 独立舵面损伤录制 v10（2026-09-30）

- 用户要求核实各舵面受损并更新录制器。Plugin-SDK 的 `CAutomobile::m_damageManager` 偏移为 0x5A0，`CDamageManager::m_nPanelsStatus` 为 0x14；飞机 getter 按 frame 12 起每槽 2 位编码，不能用汽车 panel 的 4 位分组。方向舵/左右升降舵/左右副翼分别为 frame 16–20。公开 gta-reversed 的 getter 当前有形参使用错误，不能直接照抄；本机原始 EXE 反汇编确认正确位运算、飞机调用者传入 plane+0x5A0，以及损伤流程 1 阶段摆动、2 阶段调用部件脱落。诊断在 gitignored `captures/plane-damage-disassembly.txt`，未提交游戏资源。
- 新 `recorder/src/PlaneDamage.h` 保存布局和最小签名，录制器每次采样检查 getter 0x6C2300 的 24 字节及飞机 caller 0x6CB990 的 12 字节；不调用任何游戏损伤方法、不新增损伤 hook。签名不符或内存不可读时记录未知。这是本机该损伤字段的单独验证，不撤销发动机 RPM 等其他未验证字段的限制。
- v10 表尾追加 `surface_damage_valid,surface_damage_source,plane_damage_raw,rudder_damage,elevator_l_damage,elevator_r_damage,aileron_l_damage,aileron_r_damage`，关闭相机调试时 120 列。valid bit 0–4 按上述顺序；来源 game_memory/unknown；常规状态 0 完好、1 受损、2 脱落，3 保留其他原始编码，未知 -1。与健康值、节点读取/动画独立，不代表空气动力学操纵效率。旧 v4–v9 状态为 null/未知。
- CSV reader 校验版本、机型、来源、有效位、无符号原始字与每槽状态的一致性；损伤保持采样时刻的离散值，拖动时间轴不插值、不跨未知保持。回放「原始数据」显示五个槽和来源；没有改变模型破损外观，座舱告警灯仍未接入。§44 所述舵面数据缺失现已由 v10 新字段补足。
- `recorder/tests/run-tests.ps1` 构建并运行真实 recorder 捕获/表头/写出函数测试：本机 EXE 两段签名通过，两机各全部 1024 状态组合、不可读地址/不支持布局/非目标机型的未知回退、120 列实际写出通过。vitest CSV/新损伤/终点 3 文件 52 项通过，含 C++ 写出文件解析及损伤时间步进；tsc 0 错误、Prettier/diff 检查通过。ESLint 新增代码通过，CSV 原有复杂度 45>20 错误保留（已用 HEAD 原始文件验证同样为 45），entry 保留原有 33 个返回类型警告；未声称整个 lint 通过。
- 发布 `flightReplay-B3tf8PX2.js`，`scripts/test-surface-damage.mjs` 用明确命名的 synthetic v10 记录在两机真实本地姿态上验证五槽、状态跳变、未知及旧格式回退，无 GPU/页面错误，截图人工查看；这些注入状态仅验证消费端，不是实测撞击记录。
- recorder 与音频助手已重新构建，游戏运行时 ASI 占用导致首次标准安装失败，先备份并将旧映射文件安全改名后替换磁盘文件；用户随后关闭游戏，已重新执行标准 `install.ps1`，新 ASI/助手与 build SHA256 一致。下次启动加载 v10；真实游戏撞击后的状态变化仍待新录像验收。无需重新烘地图，既有未提交工作和所有旧录像保留。

## 46. Hydra 三维座舱仪表与真实 v10 新录像验收（2026-09-30）

- 用户录制的新 `flight_20260930_220316_220_m520_002.csv` 共 2953 个采样、125.506 秒，全部损伤读取 valid=31、source=game_memory；117.025892 秒右副翼从 0 变为 1，健康降到约 827.741。此前第一段 2206 个采样损伤也有效但均完好。Rustler 最新实际文件仍为 v9，尚无 v10/v11 实际撞击录像；不把离线模拟状态称为实测。
- 新 `cockpit-instrument-mesh.ts` 定位原版 Hydra 的七个仪表台三角形，而不是上方 16 顶点风挡框。仪表面按实际台面的复合斜面插值，向飞行员侧偏移毫米距离防穿插；三只立体边框圆表（速度、姿态、海拔）、健康条/CTRL 总灯/五槽灯、油门/喷口/起落架三个底格。方位的透明字和滚动刻度贴在原有绿色瞄准玻璃上。以座椅、仪表台锚点和 chassis 变换验证原模型，改装座舱不匹配则跳过；Rustler 仪表布局尚未适配。原摇杆保持半透明。
- `cockpit-instruments.ts` 使用独立 1024×1024 私有 RGBA 图集，按录制时间约 25 Hz 更新，损伤/档位/油门跳变立即更新；暂停不反复上传。新增 Engine `updateVehicleTextureLayer` 只原位改写既有私有 RGBA 层，不重建纹理、绑定组或操作已常驻的世界数组。材质 7 为克制自发光，日/夜分别有亮度；帧状态同样进入 GPU 视频导出。新增模型随飞机 root/显隐/销毁同步，未复活 HTML 分析 HUD。
- 速度为位置/录制时间的三维游戏运动速度（GAME km/h），不能冒充大气 IAS；海拔为世界 Z；姿态/方位取 SLERP 后正交基。喷口为原始 0–5000 控制百分比，箭头角度仅为示意；起落架负号代表运动方向，按绝对值判 DOWN/TRANSIT/UP。损伤 0 暗绿、1 黄、2 红、3 黄、未知灰；CTRL 按录像时间闪黄，拖动可恢复。没有实现破损网格替换或仪表实时玻璃倒影，原有静态座舱倒影不含这些动态数字。
- 验证包含世界坐标速度/姿态/倒飞/方位、负号起落架、仪表台边界、私有纹理原位更新与无效/共享/已销毁对象拒绝，以及真实录像损伤倒拖。正式浏览器正常眼位、低头、侧视、飞行、撞击、夜间 GPU 导出截图在 `captures/cockpit-instruments-*.png`。类型检查/构建/截图均须在 §47 的最终版本再跑一次；地图和游戏资产无需重烘焙或修改。

## 47. v11 十个默认按键与三档油门（2026-09-30）

- 用户要求记录 Q/W/E/A/S/D、↑/↓/←/→，油门仅 0/50/100%，为以后键位显示保留基础数据。保留已有六列位置不变，表尾追加 `key_w,key_s,key_left,key_right,keyboard_state_valid`；正常 125 列。真实捕获/写出仍 25 Hz；读取 `GetAsyncKeyState` 高位，仅游戏进程有前台焦点时有效。切出时 valid=0，新四键写 -1，旧六键写 0（须结合 valid 判断未知）；未解析自定义键位、手柄或短于 40 ms 的全部按键边沿。
- CSV 只在 v11、valid=1 且十个字段全为 0/1 时认可新键；旧/未知/损坏的新键为 null，按录制时间离散采样，不插值或跨未知持有。现有原始数据区能查看十键，失焦标未知；没有添加新的浮动键位面板。`THROTTLE *` 按 W 单独按=100%、S 单独按=0%、都不按/同时按=50%；v11 无效焦点显示 `--`。明确是默认控制输入代理，不是发动机推力/RPM。v4–v10 油门全零时保留另标来源的 brake 代理三档，不能补出旧录像未录的 W/S。
- C++ 测试穷举十键的 1024 组合、失焦不调用读键函数、真实表头/写出 125 列，与两机损伤 1024 状态测试一起通过；产出 `captures/recorder-v11-damage-keys.csv` 供 TS 消费。键位 TS 测试验证三档、双键、未知、旧格式、损坏状态、采样边沿/倒拖和真实 C++ writer 的列对应。浏览器测试里的 v11 键位使用明确标记的 synthetic 四行、实际本机飞机姿态，不能当作真人录制实测；本次真人新录像仍为 v10。
- ASI/音频助手已重新构建并按标准 install 脚本备份安装，安装 ASI 的 SHA256 与 build 相同。**重启游戏后下一次录制才有 v11 键位**。新增 TS lint 已修复；CSV 保留原有复杂度 45 错误，入口保留原有 33 个返回类型警告，不宣称全仓 lint 清零。录制器脚本保持 ASCII，既有音频/舱盖/相机工作保留。
- 最终验证：tsc 0 错误；座舱/键位/损伤/CSV/私有纹理/世界纹理/着色器七文件 72 项通过，C++ 真实写出/损伤/十键组合通过；正式浏览器确认真实右副翼告警、倒拖、暂停无上传、三档 synthetic 键位与失焦未知，以及 1920×1080 夜间 GPU 导出，无页面/WebGPU 验证错误。发布包为 `flightReplay-DsiLY-pO.js`；实际座舱截图 `captures/cockpit-instruments-dashboard-clean.png`，无须重烘地图。

## 48. Hydra 速度/海拔量程与速度阻尼（2026-10-01）

- 用户指出 Hydra 高速约 270 km/h，原速度表 0–900 量程浪费且读数频繁抖动。改为 **0–300 km/h**，每 10 小刻度/50 标数，保留 270 附近余量。仍使用位置/录制时间计算游戏三维运动速度，未切换到未经 SI 换算的原始 GTA velocity，也未把真实读数强行锁在 270。
- `cockpit-instrument-data.ts` 按每个采样实际时间间隔，预计算两级低通阻尼（各 0.25 s）的精确阶跃响应，均匀运动从真实首值开始。总低频响应约延后 0.5 s、突变约 1 s 达到 90%；指针和数字共用同一阻尼值。缓存以 track 为键，拖动/倒播/暂停/播放倍率/GPU 导出不依赖之前渲染的帧；CSV 原始数据不改写。
- 实际 `flight_20260930_220316_220_m520_002.csv` 的 42–50 s 高速段：旧差分最小/最大 **261.693/277.484 km/h**、均值 270.123、标准差 2.707；新阻尼 **269.365/270.969**、均值 270.112、标准差 0.297，标准差降低约 89%。仍可能偶尔显示 269/271，未伪造固定 270，也不抹掉持续加减速。
- 网上核对 [gta-reversed 的 HeightAboveCeiling 实现](https://github.com/gta-reversed/gta-reversed/blob/master/source/game_sa/Entity/Vehicle/Vehicle.cpp#L1749)：常规分支从 Z=800 开始计算超过升限的高度，RC Baron 有独立分支。**800 是原版正常升限阈值，不是坐标硬上限或本机 MOD 配置的实测值**；[MTA 官方文档](https://wiki.multitheftauto.com/wiki/SetAircraftMaxHeight)也提供修改飞机升限的 API。因此海拔表改为 **0–1000 m**，每 50 小刻度/200 标数，800 加静态黄色参考刻度。取消千米绕圈的双针，超量程指针停端点、数字保持实际 Z 并显示 `OVR`，负海拔显示 `LOW`；速度超 300 同样处理。
- 验证：tsc 0 错误；座舱/键位/损伤/CSV/私有纹理/着色器六文件 **66 项**通过，新增速度抖动、真实加速/减速、时间轴复现、不同/不规则采样间隔和海拔不截断测试。相关 TS ESLint / Prettier 通过（Nx 无缓存 graph 的既有提示保留）。浏览器用明确标记的 synthetic 270/800、300/1000、350/1250、0/-15 记录核对实际图集刻度、端点针角、数字和 `OVR/LOW`，截图人工查看；这些高度不是游戏实测飞到的高度。
- 已构建发布 `flightReplay-DEGTtijO.js`，真实录像损伤倒拖、暂停无额外上传、synthetic v11 三档键位和 1920×1080 夜间 GPU 导出通过，无页面/WebGPU 错误。截图与报告在 gitignored `captures/cockpit-instruments-*`；本次不需安装 recorder 或重烘地图，刷新回放页面即可。保留其他未提交工作。

## 49. 健康值与油门显示动画（2026-10-01）

- 用户认为健康/油门增减生硬。`CockpitInstrumentState` 增加独立的 `healthDisplay` / `throttleDisplay`：数字与填充条共用显示值，分别在 **0.4 / 0.28 秒**内以 cubic ease-out 到达目标，中途改变从已显示的位置接着过渡。原始 `health` / `throttle` 及 CSV 不改，W/S 的目标仍是 0/50/100%；动画中间百分比只是视觉过渡，不新增推力/RPM 数据。
- 以每个原始采样时刻为变化起点，预计算可重入的因果过渡并按 track 缓存；不提前插值未来撞击/按键、不依赖浏览器墙钟或之前访问的帧。连续相同目标不会重启动画，播放倍率跟随录像时间；暂停冻结，拖动/倒播/任意 GPU 导出帧均可复现。最后一帧若仍在过渡中也按该录像时刻冻结。未知油门立即清空，焦点恢复后从已知值重新显示，不跨未知猜测过渡。
- 渲染器仅替换健康/油门数字与条宽的输入，健康危险颜色仍按真实值判定，五槽受损灯/CTRL 立即更新。保留私有图集原位约 25 Hz 更新和暂停无反复上传，没有新增纹理、世界数组替换或浮动 HUD。
- 新增三个单元测试：掉血/修复因果过渡及精确完成、油门快速反向连续性、失焦立即未知/恢复不跨未知。六文件 **69 项**通过，tsc 0 错误，相关 TS ESLint / Prettier 通过（既有 Nx 无 graph 提示保留）。
- 正式浏览器在真实撞击 117.1 s 仍立即显示右副翼受损，原始健康 82.7741%，动画健康约 92.09%；夜间 GPU 导出同一时刻两个显示值完全相同。另以明确标记的 synthetic 6 秒键位/掉血/修复记录，验证画布实际百分数字、连续反向、精确端点、未知、倒拖相等与暂停无额外上传；动画帧 `captures/cockpit-instruments-synthetic-animation-*.png` 已人工查看。这些 synthetic 控制/修复事件不是真人新录制。
- 已发布 `flightReplay-BbOqLdCt.js`，完整座舱截图/量程回归/1920×1080 夜间 GPU 导出通过，无页面/WebGPU 错误。刷新回放即可，不需重新录制、安装 ASI 或重烘地图；保留其他未提交工作。

## 50. 空速表填充高亮弧（2026-10-01）

- 用户希望用余光读出大概速度。速度圆表在刻度下方增加半径 125 px、宽 18 px 的弧带：从 0 刻度填到当前指针，常规亮绿色，未达到部分暗绿；减速同步缩短，不保留历史最高值。白色刻度绘制在弧带上，数字/标签保持可读。
- 弧长与指针共用已有的平滑速度和 0–300 量程，约 270 时填充九成，0 时没有亮弧；超过 300 填满并变黄，仍显示真实数字/OVR。继续走已有私有图集更新与昼夜材质，无新增纹理或数据逻辑。
- tsc 0 错误、相关 TS ESLint / Prettier 通过；重建发布 `flightReplay-DeFS1Nh9.js`。既有 `test-cockpit-instruments.mjs` 完整浏览器回归通过，含真实录像/暂停/倒拖、synthetic 键位动画/量程和夜间 GPU 导出，无页面/WebGPU 错误。已查看真实约 270 km/h 飞行、0、超量程黄弧及夜间导出截图；此为显示绘制改动，没有新增或重跑单元测试。
- 截图仍为 gitignored `captures/cockpit-instruments-*`。刷新页面可用，无须重新录制或重烘地图，保留其他未提交工作。

## 51. Hydra 半透明摇杆跟随舵面（2026-10-01）

- `cockpit-stick.ts` 继续只识别原版 Hydra 的 48 个独立摇杆顶点，追加 `replay_cockpit_stick` 刚体部件，绕模型杆底最低一圈顶点的中心转动。使用既有部件 mesh offset 抵消新转轴平移，原始顶点/法线/UV/三角形及中立外形保持一致；原部件编号和子网格可见性槽不变。日夜 alpha 均为 64/255，哑光材质和透明绘制保持；不匹配的改装模型、共用顶点、非标准 chassis offset/scale 与 Rustler 跳过。
- `aircraft.applyNodes` 在既有舵面更新后调用 `cockpitStickMotion`，优先取插值后的真实节点四元数，消去模型 bind 并提取飞机 X 轴 twist。左右升降舵取平均驱动前后，两侧副翼取差驱动左右（同向副翼偏转相消）；仅一侧可用则采用该侧，整轴缺失才使用既有按键推测 pitch/roll。真实中立节点不被按键覆盖。方向经本机 v10 录像核对：Up 推杆、Down 拉杆、A 左、D 右；真实舵面有自身响应延迟，摇杆跟随该实际角度。
- 这是回放的视觉联动，CSV 没有实测摇杆位置；角度比例 0.6、前后左右合成摆幅上限 18° 为显示参数。绕原生 X/Y 轴组合，允许斜向输入；不增加墙钟平滑、不积累历史，暂停冻结、任意拖动/倒拖/倍速/GPU 导出同帧一致。`debug.stickMotion` 提供 pitch/roll/rotation（弧度）用于验收，不加产品面板。
- 验证：tsc 0 错误，5 项单元测试覆盖方向、共同副翼/真实中立、缺轴/单侧、bind 与四元数符号、斜向限幅/无历史。`scripts/test-cockpit-stick.mts` 真实 Hydra/Rustler 模型检查通过，原数组/三角形保留，中立矩阵一致、杆底不移动、其他部件不动及重复调用无重复部件。相关 TS ESLint 0 错误（既有 33 项返回类型警告与 Nx 无 graph 提示保留），Prettier 通过。
- `scripts/test-cockpit-stick-motion.mjs` 在正式构建里检查真实录像 8.003/11.862 s 左右操纵、暂停/倒拖，再以明确标记的 synthetic 舵面角在固定真实机身姿态上截图验证中立、推、拉、左、右、拉右及帧间插值。夜间 1920×1080 cockpit-look GPU 导出与预览 motion 数值相同，无页面/WebGPU 错误，截图已人工查看。结果在 gitignored `captures/cockpit-stick-motion-*`；这些 synthetic 角度不是真人新录制。
- 已发布 `flightReplay-B35cpMrP.js`。刷新回放即可，无须重录、安装 ASI 或重烘地图；保留所有其他未提交工作，不提交游戏资源或录像。

## 52. Hydra 虚拟方向舵踏板（2026-10-01）

- 用户明确要求补踏板。新增 `cockpit-pedals.ts`，程序生成两块金属边框、深色防滑面、六条横纹、脚跟挡边与滑动支架，底部固定滑轨。只在 `fitsHydraDashboard` 通过的原版 Hydra 座舱内创建；Rustler 和不匹配的改装座舱跳过。踏板中心在原生坐标 x=±0.18、y=3.4、z=-0.12，面板向前倾 20°，始终低于仪表台，不改原 DFF/TXD 或录制器。
- 踏板是独立私有刚体模型（滑轨/左板/右板三个部件，单层 1×1 白色纹理、顶点灰色、哑光、不透明、无反射），和飞机共享 root/显隐/销毁生命周期，不碰地图纹理数组、不增加逐帧纹理上传。普通向前看时在画面下方，座舱自由观察低头可见。
- 真实方向舵节点消去 bind 后取飞机原生 Z 轴 twist，以约 ±40° 归一化、夹到 ±1；Q 对应的正 GTA rudder 角让左板前移/右板后移，E 对应负角反之，最大每侧 7 cm。节点缺失/无效才使用现有 `(E-Q)*0.28` 推测量；真实中立优先于按键。程序生成的踏板与联动比例是视觉展示，CSV 并没有实测踏板位置，不能标为原版模型或原版踏板实测数据。
- `aircraft.applyNodes` 更新踏板，`debug.pedalMotion` 输出 control/leftTravel/rightTravel/source；跟随已插值真实节点，无墙钟惯性或历史状态，暂停、回拖、帧间插值及 GPU 导出一致。摇杆继续只负责俯仰/滚转。
- tsc 0 错误，踏板+摇杆两文件共 9 项单元测试通过（左右方向/真实中立、bind/四元数双符号/无历史、旧版回退/无效值/行程限制、面朝向/封闭实心网格/对称/不透明材质）。相关 TS ESLint 0 错误、Prettier 通过，保留既有 33 项返回类型警告及 Nx 无缓存 graph 提示。
- `scripts/test-cockpit-pedals.mjs` 正式构建验证真实 v10 录像的左右操纵/暂停回拖，再用明确标记的 synthetic 节点角与故意相反的 Q/E 键，验证真实节点优先、中立归位、缺节点左右回退和帧间插值。正常眼位、低头中立/左右极限与夜间 1920×1080 GPU 导出截图已人工查看，仪表无遮挡、踏板相对运动可见，无页面/WebGPU 错误。截图/报告在 gitignored `captures/cockpit-pedals-*`，synthetic 事件不是真人新录制。
- 已发布 `flightReplay-DJhuWg3d.js`。刷新页面可用，无须重录、安装 ASI 或重烘地图；保留其他未提交工作，不提交游戏资源或录像。
