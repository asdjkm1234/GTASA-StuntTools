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
    src/FlightRecorderASI.cpp            v11 录制源（十个默认按键、真实节点、舵面损伤、起落架、游戏时钟/天气）
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

- 烘焙时从本机安装的 `audio/SFX/GENRL` 解出 **34 个样本**写入 pak，且引擎 bank **按机型**选取：
  Hydra 520 → `SND_BANK_GENRL_VEHICLE_GEN`（id 138 / slot 19：`HARRIER_FRONT`10 + `HARRIER_REAR`11 +
  `THRUST`26 + `JET_DIST`14；已核对本机 `gta_sa.exe` 的 `ProcessGenericJet` 模型 520 分支）；
  Rustler 476 → 玩家 `FASTPROP` bank 53 的前/后两个声音（0/1），加共享 bank 138 的近场 `PROP_NEAR`17 和远场 `PROP_DIST`16。每层 3 个转速档
  （`[0.7, 1, 1.4]`），另有九个载具碰撞样本与 `explosion-set.wav`；样本名分别为
  `engine-520-<layer>-<step>.wav` 和 `engine-476-<front|rear|near|prop-distance>-<step>.wav`。每个引擎 loop 在烘焙时做尾→首交叉淡化，
  整段无缝循环（`loopStartFrame=0`）。并写出 `manifest.json`（**逐样本**记录
  bank/slot/sound/soundName/采样率与 provenance）。bank 按**名字**从 gta-reversed `eSoundBank.h` 选取、音效按
  `SoundIDs.h` 名字选取，bake 时与安装逐一校验、不匹配即抛错（**绝不为 Hydra 静默回退到螺旋桨 bank**；
  该机型缺样本时如实上报 `engine: null`）。回放音效由
  `apps/web/src/flight/audio-engine.ts` 按机型组装**分层**引擎（喷气：前/后/推力/远场；螺旋桨：前/后/近/远）：
  Hydra 前后层的音高和响度随推断 W/松开/S 与已录位置速度变化；Rustler 前/后层音高按录制姿态与推断 W/松开/S 控制计算。
  碰撞按推断冲击强度选样本、爆炸按固定频率循环，并叠加距离衰减与多普勒。
- **推断边界**：本机程序静态调用证实 Hydra 的四个 sound id，公开 `gta-reversed` 提供对应名字；实际声层增益、音高、听者位置及输入仍是 **INFERRED**，尚无逐帧运行时日志。缺少 v9 推断列（v4–v8）时，负载/转速由**实测位置
  速度**推导（仍标注 inferred）；3 个转速档是同一 loop 的**离线重采样**，不是游戏额外样本（原版在运行时对同一 loop 变调）。
- **诚实声明**：音效是与原版**参数化忠实（parameterization-faithful）**的重建，**不是原版混音的逐位一致
  （NOT bit-exact）**；推断输入一律标注为 inferred，绝不呈现为实测。G3 为 **NO-GO**（本机 `gta_sa.exe` 不是 SDK
  验证的 1.0-US 指纹），发动机 rev/RPM 与 Rustler 的实际 `m_fPropSpeed` 因此仍未采集。当前机型 v9 录像的 `throttle` 一直是零、`brake` 为 W=0/松开=0.5/S=1；音频根据 `1-brake` 推断推力，**不是实测发动机负载**。
- 该版 pak 的 `replayAssets.version` 为 3（新增 `data/handling.cfg` 与 audio lane）；旧 pak 必须重新烘焙。
- 音频清单 v4 时新增载具碰撞层；当前 v8 仍从本机烘焙 `COLCAR` 的 20–28 号九个样本。v9 录像缺少实测接触材质，因此只选择载具表面样本，接触材质仍为未知，冲击强度仍为推断。发动机音高加入录制采样时间轴上的升降速惯性及原版健康度分段修正，各音层使用不同距离响应；这些改进不代表已取得原版完整混音公式。Rustler 保持开放空间混响；Hydra 的额外混响发送已关闭。
- **当前音频清单 v8**：Rustler 玩家层按 `gta-reversed:ProcessDummyOrPlayerProp` 使用前/后/近/远四层；`_D` bank 属于另一条路径，不作为玩家收油样本。其前后层仍用约 2 ms 等功率接缝，低速断续掉声仍为**推断**。Hydra 改用本机程序调用的 HARRIER_FRONT/REAR、THRUST、JET_DIST；新前后样本使用约 5 ms 等功率接缝。两机实时与导出各只播放一份原速循环并连续变调。旧整图/航迹 pak 的音频清单都须重新烘焙；已有 v7 整图 pak 可在 `tools/opensa` 下运行 `node node_modules/tsx/dist/cli.mjs scripts/bake-map.mts map-pak --audio-only`，只更新本机音频与 index 的音频文件列表，保留地图单元及贴图。
- Rustler 持续加力时的变速改用公开玩家螺旋桨路径的姿态公式，所有 Rustler 引擎层各播放一份原速样本；录像没有原版音频输入和 tick，按键映射与平滑速率仍是 **inferred**。用户试听确认 Rustler 的循环感已不易察觉。
- 旧的 WHINE 参数曾把约 4.4 kHz 尖峰调到原版位置，但周围宽带结构无法匹配。v8 改用真实调用的 HARRIER_FRONT/REAR，默认关闭旧 THRUST 中频补偿；全程第一人称 v9 WAV 对照的起飞 1–4s 六个频段误差约 0.06–0.67 dB，巡航 5–10s 约 0.37–1.03 dB。原版 WAV 含全部游戏声音，这些指标只证实当前比较条件下的频谱接近；用户随后确认 Hydra 音色修复。见 `HANDOFF.md` §27。
- Hydra 高速 W/松开/S 响度响应在音色修复后继续微调：原版 v9 完整混音在约 63–75 m/s 的松开 W 边沿宽频下降约 1.5–2.2 dB，旧合成常偏小；当前在巡航时对松开/S 的主声源加入平滑的推断降益，满 W 基准、样本、音高及 Rustler 路径不变。高速按 W 的原版完整混音边沿有时反而下降，不能用单条录像确定单独发动机的真实增益公式；见 `HANDOFF.md` §28。
- 回放控制栏的“调音台”可按 Hydra/Rustler 分别实时调整响度、声层比例、整体和分层音高；Hydra 另有带精确数值的“油门响度变化”滑块（默认 1.00×），当前显示 HARRIER_FRONT/REAR、THRUST 和 JET_DIST 的实际声层，也可调 THRUST 中频诊断支路（基准关闭）。每个滑块显示精确值，“复制参数”输出当前载具全部滑块数值及 JSON；Rustler 原保存值会迁移，旧 Hydra WHINE/LIFT 设置保存在 v1 localStorage 键中供参考，新 Hydra 从 v2 基准开始。合成音频导出使用打开导出时的参数快照，录制 WAV 不受影响。

### 三维终点标记与分析

- 每个已加载航迹的终点都会在 3D 世界里放置标记（**3D world endpoint markers**）；**every track endpoint** 都有标记。
  密度光环（**density halo**）只表达聚集程度，**绝不遮住任何一个点（never hides a point）**。
- 平面分析面板及浮动飞行分析 HUD 已删除；自由视角、航迹列表和三维终点标记继续保留。
- Hydra 原版摇杆在回放中为半透明，保留其几何形状，让仪表台更容易看清；不修改游戏安装或地图包。
- Hydra 原版座舱已内嵌速度、姿态、海拔三只圆表；下方为机身健康、方向舵/左右升降舵/左右副翼灯，以及油门、喷口、起落架。方位显示在既有绿色瞄准玻璃上，视频导出同步带上这些仪表；Rustler 座舱位置仍待适配。
- 速度表为 0–300 km/h，指针/数字按录像时间两级阻尼，响应约延后半秒以抑制采样抖动；海拔表为 0–1000 m，800 m 黄线参考原版升限阈值。超量程保留实际数字并显示 `OVR`，负海拔显示 `LOW`，指针停在端点，不绕回零；MOD 可改变实际升限。
- 速度刻度内有从 0 延伸到当前指针的绿色高亮弧带，随同一平滑速度伸缩，便于余光判断快慢；超 300 km/h 弧带填满并变黄。
- 健康值/填充条以 0.4 秒、油门数字/填充条以 0.28 秒作减速过渡，中途变化从当前显示位置接着动。动画按录像时间运行；暂停冻结，倒拖和视频导出可复现。真实健康/三档油门数据保留，受损灯和危险颜色仍立即响应，失焦油门立即显示未知。
- `GAME km/h` 由位置与录制时间换算三维运动速度，不能当作真实航空 IAS；海拔为游戏世界 Z。v11 的 `THROTTLE *` 由默认 W/S 键推断：W=100%、S=0%、都不按或同时按=50%；失去游戏焦点为未知 `--`。旧录像油门全零时按已有 brake 控制代理量归到 0/50/100%，星号表示推断。喷口为原始 0–5000 控制的百分比，起落架按绝对值显示 DOWN/TRANSIT/UP。

### 视频导出

- 导出为 **1920x1080** H.264/AAC MP4：视频在页面内用 **WebCodecs** 硬件编码，再由本机 ffmpeg 以 **`-c:v copy`**
  直接封装（copy-mux），**不落每帧 PNG（no per-frame PNG）**，导出期间没有可见浏览器窗口；支持 30/60/120 fps。
- **诚实声明：不要声称实时导出（do NOT claim realtime export）。** 本机 Intel Arc A380 实测：60 秒片段在 60 fps
  约 65–68 秒（≈1.1x 片长），在 120 fps 约 122–141 秒（≈2-2.3x 片长）。120 fps 导出结果正确，但**慢于实时**：固定
  每帧成本约 17 ms，超过 120 fps 的 8.33 ms 预算；编码器本身远快于实时（流水线 lane：60 秒片段在 60 fps 仅 12.8 秒）。
- 视频导出直接使用三维场景画面，不再叠加已删除的飞行分析 HUD。
- 120 fps 只改善节奏（**cadence**），**无法恢复超过 25 Hz 录制器 12.5 Hz 极限的运动**。

## 三、CSV 数据格式

按列名读取，**兼容 v4/v5/v6/v7/v8/v9/v10**（缺列为 `null`）。以下是 v6 起保留的基础列：

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

v10 新增 Hydra/Rustler 的方向舵、左右升降舵、左右副翼五个独立损伤状态，以及有效位、来源和原始损伤字。
运行时验证本机相关代码签名后才从游戏内存读取；校验失败及旧录像为未知。回放「原始数据」可查看，
Hydra 座舱损伤灯已接入：完好为暗绿，受损/其他状态为黄，脱落为红，未知为灰；CTRL 为总告警。破损模型外观尚未接入。新 ASI 需重启游戏生效。

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
