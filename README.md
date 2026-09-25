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
    src/FlightRecorderASI.cpp            v7 录制源（真实节点、起落架、游戏时钟/天气）
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

## 三、CSV 数据格式

按列名读取，**兼容 v4/v5/v6/v7**（缺列为 `null`）。以下是 v6 起保留的基础列：

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
`camera_*` 相机调试列；旧录像仍可正常读取。

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
