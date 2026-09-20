# GTA SA 特技飞行录制器

针对 GTA San Andreas 1.0 US 的常驻录制器，使用独立 ASI（不使用 CLEO/SCM），以兼容 SA-MP 0.3.7-R5：

- `FlightRecorder.asi`：挂接 GTA SA 主线程，每 40 ms（25 Hz）采集、写 CSV、切档并计算加速度。
- 无 F11 开关；进入目标飞机即自动开始，离开即结束，换飞机自动新建。
- 仅录制模型 **520（Hydra）** 与 **476（Rustler / Stuntplane）**。

输出位于游戏目录的 `flight_recordings/`，每个载具会话一个 CSV。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1     # 需要 tools/zig/zig-windows-x86_64-0.14.0/zig.exe
powershell -ExecutionPolicy Bypass -File .\install.ps1   # 覆盖游戏目录前自动备份到 backups/
```

## 字段（v6）

基础列与 v5 相同：`local_timestamp`（电脑本地毫秒时间）、`model`、`health`、`x/y/z`、`heading_deg`、
完整姿态基 `right_* / up_* / forward_*`、`vx/vy/vz` 与由相邻采样时长计算的 `ax/ay/az`、`steer/throttle/brake`、
四色 ID、`landing_gear_status`，以及原始按键 `key_q/key_a/key_e/key_d/key_up/key_down`。

v6 新增：

- `game_hour/game_minute/game_second`：GTA 游戏时钟（`CClock`），回放不必再用电脑本地时间。
- `weather_new/weather_old/weather_forced`：GTA 天气（`CWeather`）。
- `node_status` + `surface_source`：真实动画节点状态。节点顺序
  `rudder, elevator_l, elevator_r, aileron_l, aileron_r, gear_l, gear_r`，每个 4 个四元数分量。
  从 `CPlane::m_aCarNodes` 的 `RwFrame` 局部 `modelling` 矩阵正交化后提取，读取前用 `VirtualQuery` 校验指针。
  `surface_source` 为 `real`（5 个舵面全读到）/`partial`/`inferred`（读不到，回放端只能按键推测）。
  **按键推测值永远写在按键列，不写进真实节点列。**

## 自动切档

- 主动下车或载具消失：关闭当前 CSV；
- 换成其他载具：关闭旧 CSV；
- 同一载具单次采样位移 ≥ 120 m（QuickHome/回溯）：标注 `quickhome_teleport_detected` 并新建 CSV；
- 再次驾驶目标飞机：新建 CSV。

`FlightRecorder.asi` 末尾会写入结束原因。阈值见源码 `kQuickhomeDistanceMetres`。

## 挂钩与 CLEO 竞态

CLEO 会在**它自己初始化时**替换同一个 game-process 调用（`0x53E981`），且初始化时刻不固定；因此不能用固定延时去“等 CLEO”。本 ASI 用**看门狗线程**每秒检查该调用是否仍指向自己，被任何其它 ASI 覆盖就重新挂钩并把新目标链进 trampoline。
排查“进了游戏却没有 CSV”：先看 `FlightRecorder.asi.log` —— 没有 `heartbeat calls=…` 行说明回调没被调用（挂钩问题）；有 `heartbeat` 但无 CSV 说明是目标机型/采样判断（确认驾驶的是 520 或 476）。
