# GTA:SA 飞行录制器

独立的 32 位 ASI，适用于 GTA:SA PC 1.0 US，已在 SA-MP 0.3.7-R5 测试。进入 Hydra（520）或 Rustler（476）后自动录制，以 25 Hz 写入游戏目录的 `flight_recordings/`。离开、换机或载具失效时结束，无需录制快捷键。

网页左侧「安装录制器」提供编译好的 ZIP。将 `FlightRecorder.asi` 放在 `gta_sa.exe` 旁边，准备可用的 32 位 ASI 加载器，然后重新启动游戏即可。完整步骤见 [安装说明](INSTALL.zh-CN.txt)。

## v13 精简了什么

录制器只生成 CSV。网页根据飞行数据和地图音效素材自动合成声音，回放与 MP4 导出均使用这套声音。已有录像不会被修改。

未压缩原声采用 48 kHz、双声道、16 位 PCM，每分钟约 11 MiB。停止原声录制是本次主要的磁盘节省。CSV 从 117 列减少到 **101 列**，移除如下 16 列：

| 移除的列 | 原因 |
| --- | --- |
| `ax, ay, az` | 回放不读取这三列。加速度仍在录制器内部用于生成推断碰撞事件 |
| `steer` | 只有解析器保留该值，回放与操纵反馈不使用；反馈来自实测舵面节点 |
| `center_gear_status` | 回放直接检查四元数是否有效，未读取此状态列 |
| `misc_a_x/y/z, misc_b_x/y/z` | 回放只使用中线起落架旋转，未使用这些局部位置 |
| `nozzle_rotation_previous` | 解析后没有功能使用；当前喷口角仍保留 |
| `prop_node_status` | 回放按节点四元数是否有效判断，未读取此状态列 |
| `engine_load_inferred, engine_load_source` | 两种受支持飞机的合成声音使用 `throttle/brake` 求控制代理，不使用该负载列 |
| `transmission_gear_source` | 固定的 `inferred` 常量；列名与文件头继续明确挡位为推断值 |

`transmission_gear_inferred` **仍保留**，它参与当前合成声音。原始速度、`throttle/brake`、W/S 等数据也仍有用途，不能因为音频停止录制而删除：声音是在回放时合成的。

相机 `camera_*` 调试列早已通过编译开关关闭，正常录制不写出。Q/E/A/D 和方向键自 v12 起不再采集。此次没有重新启用它们。

## 保留的数据与用途

| 数据 | 用途 |
| --- | --- |
| 本地时间、`capture_elapsed_s` | 时间显示、单调播放时基、镜头和声音同步 |
| 机型、位置、完整姿态基、航向 | 载入飞机、三维运动、相机、仪表及原始数据查看 |
| `vx/vy/vz`、`throttle/brake`、推断挡位 | 合成声音、旧控制代理、内部碰撞与分段检测 |
| 健康、四色 ID、收轮进度 | 机身状态、涂装、仪表与旧节点缺测时的起落架动画 |
| 游戏时钟与天气 | 还原录制环境 |
| 七个动画节点四元数、`node_status/surface_source` | 舵面与起落架动画、节点可用性、操纵反馈 |
| `misc_a/misc_b` 四元数 | Hydra 中线起落架实测旋转 |
| 喷口角、四个 prop 节点四元数 | 喷口与相关部件动画 |
| 烟雾标志、明确爆炸事件 | 烟雾、爆炸与录像结束表现 |
| 五个损伤槽、有效性、来源与原始损伤字 | 仪表告警、舵面反馈、损伤烟雾、航迹颜色；校验来源及槽位一致性 |
| W/S 与键盘焦点 | 默认键位的油门输入显示，失焦时保持未知 |
| 推断碰撞事件、分段说明和结束原因 | 碰撞声音、QuickHome 分段与记录元数据 |

CSV 按列名读取，v4–v12 仍可回放。旧列的解析保留用于兼容；新文件不写出的字段不会移位或误读。

## 构建、测试与安装

在 `recorder/` 下执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

需要 `tools/zig/zig-windows-x86_64-0.14.0/zig.exe`。构建只生成 `FlightRecorder.asi`；不再需要 .NET 音频助手。安装前备份旧 ASI；旧 `GameAudioCapture.exe` 会备份后移除。完全退出并重启游戏才会加载新版。录制器更新后重建网页，下载包随之更新。

## 采集边界

W/S 是默认物理键，每 40 ms 采样一次，仅在游戏进程拥有前台焦点时有效。失焦时 `keyboard_state_valid=0`，W/S 为 `-1`；不解析改键或手柄。显示油门以 W=100%、S=0%、均未按=50% 为输入代理，双键或失焦未知，不是实测发动机推力。

节点从 `CPlane` 的局部 `RwFrame` 读取，先校验地址并正交化，再求四元数。缺测写 `nan`，不以按键补造舵面。五个损伤槽独立校验代码签名后读取；来源为 `game_memory` 或 `unknown`，未知不按血量推断。损伤原始字与五槽保留供回放一致性验证。RPM 和发动机开关未测得，不写成实测数据。

推断碰撞仍以单采样血量下降至少 20，或峰值保持加速度至少 30 m/s² 为判据，冷却一秒。加速度只在内部计算，事件仍写为 `# event,<seconds>,collision,inferred,<impact>,<x>,<y>,<z>`。爆炸只记录游戏明确的爆炸状态，不由低血量推断。

## QuickHome 分段

游戏有焦点时，物理 H 按下发起一次分段请求。两秒内优先识别位置、姿态、速度或修复变化；完全没有可辨识变化时，满两秒后的第一采样也会分段。120 m 相邻位移兜底保留，正常绕圈不切档。

H 按住不反复触发，待处理重复按下不延长期限，失焦取消。它不判断服务器是否接受 QuickHome，也未过滤聊天输入。H 不新增 CSV 按键列。新段以分段采样的 QPC 为原点；结束原因及 `key_h_confirmed/key_h_requested/distance_fallback` 说明保持兼容。

## 挂钩与排查

CLEO 初始化时可能替换同一个 game-process 调用（`0x53E981`）。看门狗每秒检查，必要时重新挂钩并链入新目标，不能用固定延时代替。

进入飞机却没有 CSV 时，先看 `FlightRecorder.asi.log`：没有 `heartbeat calls=…` 说明回调未运行；有 heartbeat 则检查是否驾驶 520/476、游戏目录是否可写，以及是否重启加载了新版。
