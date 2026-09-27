# GTASA StuntTools — 特技飞行录制与 3D 回放分析

> 工程/交接说明见 **[`HANDOFF.md`](HANDOFF.md)**（环境、构建运行自测、根因与坑）；AI 请先读它。

本项目在**当前目录**自包含运行：`GTA San Andreas/` 是你自己的游戏安装，`tools/` 放引擎与编译器，
`recorder/` 是游戏内录制器，`web-replay/` 是本地回放服务。一次烘焙后，回放只读取本地 pak 和 CSV；
游戏安装只在录制和重新烘焙时需要。全部本地完成，不上传或分发游戏资源。

> 前作 `GTASA-FlightTools`（旧实现）已于 2026-09-20 删除，本目录是重新搭建的干净实现。

## 目录

```
GTASA-StuntTools/
  GTA San Andreas/                       游戏安装（录制器与 flight_recordings/ 在这里）
  recorder/                              独立 ASI 录制器（C++，25 Hz，无 CLEO opcode）
    src/FlightRecorderASI.cpp            v9 录制源（真实节点、起落架、游戏时钟/天气、推断挡位/负载、推断碰撞事件）
    build.ps1 / install.ps1              zig 编译、安装到游戏目录（覆盖前自动备份）
  web-replay/                            本地回放服务
    local-server.mjs                     静态页 + /game-src（Range）+ /local-recording/latest.csv
    dist/opensa/                         OpenSA WebGPU 回放页（flight-replay.html）
    启动本地回放.cmd
  tools/
    opensa/                              OpenSA 源码 + 本项目回放 app（AGPL-3.0）
      build-flight-replay.ps1            重新构建并发布回放页
      apps/web/src/flight/               地图流送 / CSV / 姿态 / 相机
      apps/web/src/standalone/flight-replay.ts
    zig/                                 zig 0.14.0（编译录制器）
```

## 一、录制器

常驻监听、无 F11，只录制 **Hydra（520）** 与 **Rustler / Stuntplane（476）**，固定 **25 Hz**。

- 进入目标飞机自动新建文件；主动下车 / 死亡 / 爆炸 / 载具失效结束；
  换另一架目标飞机自动新建；QuickHome/回溯（同载具单采样位移 ≥ 120 m）结束旧文件并新建；
  离开目标飞机后继续等待，不退出录制模式。
- 输出：`GTA San Andreas/flight_recordings/flight_YYYYMMDD_HHMMSS_mmm_m<model>_<seq>.csv`

编译与安装：

```powershell
cd recorder
powershell -ExecutionPolicy Bypass -File .\build.ps1     # 产出 32 位 PE（脚本会校验 machine=0x014C）
powershell -ExecutionPolicy Bypass -File .\install.ps1   # 覆盖前自动备份到 recorder\backups\
```

## 二、回放器（OpenSA WebGPU）

首次构建（安装依赖）：

```powershell
cd tools\opensa
npm install --ignore-scripts --no-audit --no-fund
npx tsx scripts\bake-map.mts map-pak          # 一次烘焙地图、Hydra/Rustler 与环境数据
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1
```

启动：

```powershell
cd web-replay
.\启动本地回放.cmd
```

自动打开 `http://127.0.0.1:4173/`。常用：

- 最新本地记录：`http://127.0.0.1:4173/?local=latest`
- 地图和 Hydra/Rustler 资源从 `tools/opensa/map-pak` 读取；旧 pak 需重新烘焙。

端口被占用时不会抛 `EADDRINUSE`：提示“已在运行”并打开已有页面。

### 交互

- 拖入一个或多个 CSV，或点击选择文件；多文件以各自起点对齐，点击列表切换跟随对象。
- 播放 / 暂停 / 重新开始 / 逐帧 / 时间轴拖动 / 0.25×–4×。
- **V** 依次切换第三人称近、中、远、原版第一人称和机舱第一人称；重置视角回到默认跟随。
- 实时显示时间、坐标、航向、速度、血量、模型、颜色、姿态、起落架原始值、按键，以及动画节点来源。

### 地图与姿态

- 烘焙器读取 `gta.dat` 的全部 IDE/IPL 与 IMG 内二进制 `*_streamN.ipl`，按 300 m cell 焊接进 pak；浏览器流送已烘焙地块：
  飞机附近 **HD**、外圈 **LOD 底图**，两者互斥，避免重叠与露洞。
- DFF/TXD 材质、TXD 父级继承、透明/双面、植被裁剪由 OpenSA 管线处理。
- 水面来自 pak 中的 `data/water.dat`；天空/太阳/雾/水色由 pak 中的 `data/timecyc.dat` + CSV 的**游戏时钟与天气**驱动
  （旧文件无这些字段时回退到参数化晴天中午，绝不用电脑本地时间冒充游戏时间）。
- 姿态从 CSV 的 right/up/forward 正交基构造四元数并 **SLERP**；GTA→浏览器换轴只在
  `apps/web/src/flight/math.ts:gtaToEngine` 一处完成。

### 音效回放

- 烘焙时从本机安装的 `audio/SFX/GENRL` 解出 **20 个样本**写入 pak，且引擎 bank **按机型**选取：
  Hydra 520 → `SND_BANK_GENRL_VEHICLE_GEN`（喷气**分层涡轮**，id 138 / slot 19：`THRUST`26 主涡轮 + `WHINE`29 高频啸叫 +
  `JET_DIST`14 远场层 + `LIFT_LOOP`15 垂直起降升力，按速度门控）；
  Rustler 476 → `SND_BANK_GENRL_FASTPROP`（螺旋桨，id 53 加速 / `_D` id 54 减速）。每层 3 个转速档
  （`[0.7, 1, 1.4]`），外加 `collision-set.wav`、`explosion-set.wav`；喷气层样本名为
  `engine-520-<layer>-<step>.wav`（如 `engine-520-turbine-1.wav`、`engine-520-whine-1.wav`），螺旋桨仍为
  `engine-476-accelerate-<step>.wav` / `engine-476-decelerate-<step>.wav`。每个引擎 loop 在烘焙时做尾→首交叉淡化，
  整段无缝循环（`loopStartFrame=0`）。并写出 `manifest.json`（**逐样本**记录
  bank/slot/sound/soundName/采样率与 provenance）。bank 按**名字**从 gta-reversed `eSoundBank.h` 选取、音效按
  `SoundIDs.h` 名字选取，bake 时与安装逐一校验、不匹配即抛错（**绝不为 Hydra 静默回退到螺旋桨 bank**；
  该机型缺样本时如实上报 `engine: null`）。回放音效由
  `apps/web/src/flight/audio-engine.ts` 按机型组装**分层**引擎（喷气：涡轮/啸叫/远场/升力；螺旋桨：加速/减速对）：
  音高与亮度随推断负载/转速代理变化、油门/刹车只用于调制层、碰撞按推断冲击强度选样本、爆炸按固定频率循环，并叠加距离衰减与多普勒。
- **推断边界**：喷气机的**分层与混音比例**是 **INFERRED**（`ProcessGenericJet` 未逆向）；bank/slot/sound 的 id 与名字
  来自 gta-reversed 本体表，但“哪几层同时响、各占多少”未经实测。缺少 v9 推断列（v4–v8）时，负载/转速由**实测位置
  速度**推导（仍标注 inferred）；3 个转速档是同一 loop 的**离线重采样**，不是游戏额外样本（原版在运行时对同一 loop 变调）。
- **诚实声明**：音效是与原版**参数化忠实（parameterization-faithful）**的重建，**不是原版混音的逐位一致
  （NOT bit-exact）**；推断输入一律标注为 inferred，绝不呈现为实测。G3 为 **NO-GO**（本机 `gta_sa.exe` 不是 SDK
  验证的 1.0-US 指纹），发动机 rev/RPM 因此仍未采集，音频改用挡位+负载代理。
- 该版 pak 的 `replayAssets.version` 为 3（新增 `data/handling.cfg` 与 audio lane）；旧 pak 必须重新烘焙。

### 三维终点标记与分析

- 每个已加载航迹的终点都会在 3D 世界里放置标记（**3D world endpoint markers**）；**every track endpoint** 都有标记。
  密度光环（**density halo**）只表达聚集程度，**绝不遮住任何一个点（never hides a point）**。
- 旧的平面 2D 分析面板已退役（**flat 2D panel retired**）；分析 HUD 的仪表仍可逐项隐藏。

### 视频导出

- 导出为 **1920x1080** H.264/AAC MP4：视频在页面内用 **WebCodecs** 硬件编码，再由本机 ffmpeg 以 **`-c:v copy`**
  直接封装（copy-mux），**不落每帧 PNG（no per-frame PNG）**，导出期间没有可见浏览器窗口；支持 30/60/120 fps。
- **诚实声明：不要声称实时导出（do NOT claim realtime export）。** 本机 Intel Arc A380 实测：60 秒片段在 60 fps
  约 65–68 秒（≈1.1x 片长），在 120 fps 约 122–141 秒（≈2-2.3x 片长）。120 fps 导出结果正确，但**慢于实时**：固定
  每帧成本约 17 ms，超过 120 fps 的 8.33 ms 预算；编码器本身远快于实时（流水线 lane：60 秒片段在 60 fps 仅 12.8 秒）。
- 导出的 HUD 是页面 DOM 仪表的 canvas 镜像（**canvas mirror**），信息等价但**不是逐像素一致（not pixel-identical）**。
- 120 fps 只改善节奏（**cadence**），**无法恢复超过 25 Hz 录制器 12.5 Hz 极限的运动**。

## 三、CSV 数据格式

按列名读取，**兼容 v4/v5/v6/v7/v8/v9**（缺列为 `null`）。以下是 v6 起保留的基础列：

```
local_timestamp,model,health,x,y,z,heading_deg,
right_x,right_y,right_z,up_x,up_y,up_z,forward_x,forward_y,forward_z,
vx,vy,vz,ax,ay,az,steer,throttle,brake,
color_primary,color_secondary,color_tertiary,color_quaternary,landing_gear_status,
key_q,key_a,key_e,key_d,key_up,key_down,
game_hour,game_minute,game_second,weather_new,weather_old,weather_forced,
node_status,surface_source,
rudder_qx,rudder_qy,rudder_qz,rudder_qw,
elevator_l_qx,elevator_l_qy,elevator_l_qz,elevator_l_qw,
elevator_r_qx,elevator_r_qy,elevator_r_qz,elevator_r_qw,
aileron_l_qx,aileron_l_qy,aileron_l_qz,aileron_l_qw,
aileron_r_qx,aileron_r_qy,aileron_r_qz,aileron_r_qw,
gear_l_qx,gear_l_qy,gear_l_qz,gear_l_qw,
gear_r_qx,gear_r_qy,gear_r_qz,gear_r_qw
```

v7 还记录 Hydra 机身中线起落架 `misc_a`、`misc_b` 的实际角度和位置。V1.1 新录像不再写入
`camera_*` 相机调试列；旧录像仍可正常读取。v8 追加 Hydra 喷口/螺旋桨节点、冒烟状态、爆炸事件，
以及与同名 WAV 共用时基的 `capture_elapsed_s`。

### v9：推断挡位/负载与推断碰撞

v9 追加以下列，**全部是推断值（inferred），不是游戏内测量值**，逐行 `*_source` 必须为 `inferred`：

- `transmission_gear_inferred`（0–6）+ `transmission_gear_source`（固定 `inferred`）：按速度与油门分段推断的挡位，不是从变速箱字段读取的真实挡位。
- `engine_load_inferred`（0–1）+ `engine_load_source`（固定 `inferred`）：`clamp(max(abs(throttle), abs(brake)), 0, 1)`，是输入负载代理，不是测得的发动机负载。

v9 还会在检测到碰撞冲击时写入一行推断事件（8 字段）：

```
# event,<s>,collision,inferred,<impact_m_s2>,<x>,<y>,<z>
```

判据只用录制器已采样的两个信号：`health` 单采样下降 ≥ 20，**或**峰值保持加速度 ≥ 30 m/s²（满足任意一项即写），
每次冲击最多一行、1 秒冷却。`inferred` 是来源标记，**永远是推断，绝不是实测的表面材质/接触物名称**。旧文件
（v4–v8）没有这些列与事件，缺列为 `null`；解析端遇到 v9 之前的碰撞行必须忽略。

**诚实声明**：由于本机 `gta_sa.exe` 不是 SDK 验证的 1.0-US 指纹，G3 判定为 **NO-GO**，v9 不依赖任何未经验证的
结构偏移。发动机 **rev/RPM 被刻意不发射（NOT emitted）**：既不写列，也不猜测该值。挡位与负载都是被如实标注为
inferred 的启发式值，**推断值绝不当成实测值**。

- 坐标为 GTA 世界坐标（Z 向上）；`right/up/forward` 为整车单位正交基。
- `node_status` 位：0 rudder、1 elevator_l、2 elevator_r、3 aileron_l、4 aileron_r、5 gear_l、6 gear_r；
  对应位为 0 时四元数写 `nan`。
- `surface_source` = `real`（5 舵面全读到）/ `partial` / `inferred`（读不到，回放端只能按键推测）。
  按键推测值**只**写按键列，绝不写进真实节点列。
- 文件以 `# session_start,…` 开头、`# session_end,<reason>,…` 结束。

详细录制字段与规则见 `recorder/README.md`；回放用法见 `web-replay/README.md`。

## 四、测试结果（本机已执行）

- 录制器：`recorder/build.ps1` 编译成功并校验为 i386 PE；`install.ps1` 已安装到
  `GTA San Andreas\FlightRecorder.asi`（覆盖前自动备份）。
- OpenSA：`npm install`（1442 包）；`npx tsc --noEmit` 0 错误；
  `vite build --config vite.flight.config.ts` 成功并发布到 `web-replay/dist/opensa`。
- 地图管线真机测试（`tools/opensa/scripts/smoke-map.mts`，直连本机安装）：
  **562 cells / 50849 instances / 14098 models**；中心 cell 焊接 **17770 顶点 / 13189 三角 / 10 贴图数组 45 层**，约 91 ms。
- 本地服务：`/` → 302 回放页；`/game-src/__index`、Range 读取大 IMG、`/local-recording/latest.csv` 全部 200。

需要你在本机人工确认（自动化无法替代）：

1. 进游戏跑「上机 → 飞行 → QuickHome → 下车 → 重上 → /q」，看 `FlightRecorder.asi.log` 与 v6 CSV 的 `surface_source`。
2. 用支持 WebGPU 的 Chrome/Edge（需 GPU）打开回放页，逐秒核对各区域与平飞/爬升/俯冲/滚转/倒飞/起落架/快速转向。

## 五、浏览器 / WebGPU 排障（本机已实测）

- 症状：回放页显示「WebGPU 初始化失败：WebGPU adapter request failed」。
- 本机结论：**Chrome 153 + Intel Arc A380 本身没问题**。同一个 Chrome，用**全新配置目录**启动时 `requestAdapter`
  正常返回 Arc D3D12 适配器（`success: true`），而**日常配置**返回 `null`——该配置的 GPU 状态被写坏了。
  测试脚本：`tools/opensa/scripts/probe-webgpu-chrome.mjs`（逐组启动参数实测），诊断页
  `http://127.0.0.1:4173/opensa/webgpu-check.html`（结果会 POST 到 `/webgpu-report` 并写入
  `web-replay/webgpu-report.json`）。
- 因此 `启动本地回放.cmd` 现在用**专用配置** `%LOCALAPPDATA%\GTASA-StuntTools\chrome-profile` 打开回放，
  不影响你的日常 Chrome；`启动回放-Chrome.cmd` 也可手动以该配置打开。
- 若专用配置又被写坏：运行 `重置回放浏览器配置.cmd`（结束专用浏览器进程并删除该配置目录），下次启动会重建。
- 回放页启动后会自动上报阶段（`engine-ready → world-indexed → loop-started`），便于远程确认引擎真的起来了。

## 六、许可

- `tools/opensa` 为 **AGPL-3.0**（见 `tools/opensa/LICENSE`）。本工具本地运行；若对外分发或作为网络服务提供，需遵守 AGPL。
- 仓库不包含任何游戏资源；运行需要用户自备合法的 GTA SA 安装。
