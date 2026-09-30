# GTA SA 特技飞行录制器

针对 GTA San Andreas 1.0 US 的常驻录制器，使用独立 ASI（不使用 CLEO/SCM），以兼容 SA-MP 0.3.7-R5：

- `FlightRecorder.asi`：挂接 GTA SA 主线程，每 40 ms（25 Hz）采集、写 CSV、切档并计算加速度。
- 无 F11 开关；进入目标飞机即自动开始，离开即结束，换飞机自动新建。
- 仅录制模型 **520（Hydra）** 与 **476（Rustler / Stuntplane）**。

输出位于游戏目录的 `flight_recordings/`，每个载具会话一个 CSV。当前 CSV 格式为 **v11**：
v11 补齐 Q/W/E/A/S/D 与 ↑/↓/←/→ 十个默认物理按键；表尾追加 `key_w,key_s,key_left,key_right,keyboard_state_valid`，正常共 125 列。
状态来自 Win32 `GetAsyncKeyState` 高位，每 40 ms 采样，按住=1、未按=0。只在游戏进程拥有前台焦点时有效；切出游戏时 valid=0，新四键=-1（旧六键写 0，须结合 valid 判断未知）。这是默认物理键，不解析自定义绑定或手柄动作。短于一个采样间隔的按下/松开可能漏采。
回放油门按 W=100%、S=0%、都不按或同时按=50% 推断，失焦显示未知；星号表示控制输入代理，不是实测发动机推力。旧录像的 W/S/左右键缺失不会补造。字段可供以后键位可视化直接使用。
v10 新增 Hydra/Rustler 五个独立舵面损伤槽；旧 v4–v9 录像仍可读取，但损伤状态为未知。
v9 新增的挡位/负载/碰撞字段全部是推断值（inferred），逐行 `*_source` 列必须为 `inferred`，绝不写成实测。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1     # 需要 tools/zig/zig-windows-x86_64-0.14.0/zig.exe
powershell -ExecutionPolicy Bypass -File .\install.ps1   # 覆盖游戏目录前自动备份到 backups/
```

## 字段（v10）

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

v6/v7 调试版的 CSV 带有 `camera_*` 列，并在文件头标记 `camera_debug=1`。每次飞机采样时同时读取
游戏活动镜头的档位、缩放、位置、朝向、仰角和视野，以及最终相机矩阵。`camera_valid` 和
`camera_matrix_valid` 为 0 时，对应的镜头数据不可用于对照。采样仍为约 25 Hz；这些列仅用于比较
原版与网页回放的镜头。V1.1 暂时关闭该功能：新 CSV 标记 `camera_debug=0`，不写 `camera_*`
列；源码保留在 `FLIGHT_RECORDER_CAMERA_DEBUG` 编译开关后，后续可重新启用。缺少这些列的 CSV
仍可照常回放。

v7 在表尾新增起落架调试列：`center_gear_status` 的 bit 0/1 分别表示 `misc_a`/`misc_b`
节点是否可读；随后各记录局部四元数 `qx/qy/qz/qw` 和局部位置 `x/y/z`。无效时写 `nan`。
这些列记录 Hydra 机身中线起落架在原版中的实际动作。回放会优先使用它们；旧录像根据
`landing_gear_status` 和实测的 `misc_a=-80°`、`misc_b=+130°` 补全动作。

v8 新增 Hydra 喷口、螺旋桨节点、烟雾、爆炸事件、与 WAV 共用时基的 `capture_elapsed_s`。

v9 新增以下字段；它们全部是**推断值（inferred），不是游戏内测量值**：

- `transmission_gear_inferred`（0–6）和 `transmission_gear_source`（固定为 `inferred`）：根据速度幅值与油门输入作分段推断。它不是从变速箱字段读取的真实挡位。
- `engine_load_inferred`（0–1）和 `engine_load_source`（固定为 `inferred`）：`clamp(max(abs(throttle), abs(brake)), 0, 1)`。它是输入负载代理，不是测得的发动机负载。

文件头的 `inferred_signal_contract` 注释重复声明上述来源，逐行 `*_source` 列也必须为 `inferred`，避免消费者误称为实测。由于本地 `gta_sa.exe` 不是经 SDK 验证的 1.0-US 指纹，v9 不依赖未经验证的结构偏移。发动机 rev/RPM 仍被阻塞，**v9 不写 rev/RPM 列，也不猜测该值**。v4–v8 文件缺少这些列时，读取结果必须为 `null`。

### 推断碰撞事件（v9，inferred）

v9 在检测到碰撞冲击时额外写入一行**推断事件**。判据只用录制器已采样的两个信号：`health` 相对上一
采样下降 ≥ 20，**或**峰值保持的加速度幅值 ≥ 30 m/s²；满足**任意一项**即写，每次冲击最多写一行：

```
# event,<seconds>,collision,inferred,<impact_m_s2>,<x>,<y>,<z>
```

- `inferred` 是来源标记，**永远是推断，绝不是实测的表面材质/接触物名称**；回放端只能据此标注“推断碰撞”。
- `<impact_m_s2>` 是峰值保持的加速度幅值（m/s²），是推导出的代理值，不是实测冲击力。
- 一次冲击后 1 秒冷却，避免同一撞击在损伤尾段重复写行。
- 该检测**不读取任何新的结构偏移、不挂钩**；爆炸事件仍是 `# event,<seconds>,explosion,<x>,<y>,<z>`。
- 旧版本（v4–v8）文件没有该事件；解析端遇到 v9 之前的碰撞行必须忽略，绝不误读为有碰撞记录。

### 实测舵面损伤（v10，game_memory）

表尾新增 8 列，关闭相机调试时共 120 列：

`surface_damage_valid,surface_damage_source,plane_damage_raw,rudder_damage,elevator_l_damage,elevator_r_damage,aileron_l_damage,aileron_r_damage`

- `surface_damage_valid` 位 0–4 对应方向舵、左/右升降舵、左/右副翼；当前成功读取完整损伤字时为 31，否则为 0。
- `surface_damage_source` 为 `game_memory` 或 `unknown`。`plane_damage_raw` 保留无符号 32 位损伤字；未知时原始字及五个状态均为 `-1`。
- 五个状态读取 `CPlane` frame 16–20 的 2 位槽：`(raw >> (2*(frame-12))) & 3`。常规流程 0=完好、1=受损、2=脱落；3 保留为其他原始编码，不套用汽车/车门的状态名，也不解释为损伤百分比或操纵效率。
- 本机 EXE 虽不是标准 SDK 指纹，静态反汇编已验证 getter `0x6C2300` 的偏移/位运算及 `CPlane::ProcessFlyingCarStuff` 在 `0x6CB990` 传入 `plane+0x5A0`，因此可只读 `plane+0x5B4`。运行时每次采样重新匹配这两段代码签名；不匹配、地址不可读或机型不支持时记未知，不调用或修改游戏损伤函数。
- 与 `node_status` / 舵面动画 / 血量独立。动画节点不可读不能当作损伤；旧文件不回填或推断。回放按采样时刻保持离散状态，拖动时间轴不会线性插值损伤等级。
- 回放「原始数据」可查看五个槽和来源；Hydra 座舱告警灯已接入，尚未实现模型破损外观。真实 v10 Hydra 新录像已验证右副翼从 0 变为 1；v11 新键仍需重启游戏后录制实测。

验证实际 recorder 捕获与写出（读本机 EXE，不启动/修改游戏）：

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
```

## 自动切档

- 主动下车或载具消失：关闭当前 CSV；
- 换成其他载具：关闭旧 CSV；
- 同一载具单次采样位移 ≥ 120 m（QuickHome/回溯）：标注 `quickhome_teleport_detected` 并新建 CSV；
- 再次驾驶目标飞机：新建 CSV。

`FlightRecorder.asi` 末尾会写入结束原因。阈值见源码 `kQuickhomeDistanceMetres`。

## 挂钩与 CLEO 竞态

CLEO 会在**它自己初始化时**替换同一个 game-process 调用（`0x53E981`），且初始化时刻不固定；因此不能用固定延时去“等 CLEO”。本 ASI 用**看门狗线程**每秒检查该调用是否仍指向自己，被任何其它 ASI 覆盖就重新挂钩并把新目标链进 trampoline。
排查“进了游戏却没有 CSV”：先看 `FlightRecorder.asi.log` —— 没有 `heartbeat calls=…` 行说明回调没被调用（挂钩问题）；有 `heartbeat` 但无 CSV 说明是目标机型/采样判断（确认驾驶的是 520 或 476）。
