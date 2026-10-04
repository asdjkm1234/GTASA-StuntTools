# AGENTS — GTASA StuntTools 开发与交接

更新：2026-10-04。本文是合并后的工程交接入口；用户使用说明见 [README.md](README.md)，录制器字段补充见 [recorder/README.md](recorder/README.md)。内容按当前实现整理，已被替代的试验和重复验证日志不作为现行要求。用户当前指示优先；发现文档与实现冲突时核对源码并同步修正文档。

## 1. 项目与边界

GTA:SA / SA-MP 中的独立 ASI 自动记录 Hydra（520）和 Rustler（476），输出 v13 CSV（101 列），不录制游戏原声；浏览器以 OpenSA WebGPU 重放、合成声音、编辑镜头并导出 MP4。旧版 CSV 保持兼容；声音统一自动合成，只有静音开关，没有来源选择或调音台。

- 烘焙读取用户自己的游戏安装；回放只读全地图 pak、CSV。没有原始游戏实时焊接回退，也没有逐航迹烘焙。
- 开发环境在 Windows，本地启动器保留；云端以 Linux/amd64 Docker 运行 Node 静态与地图服务。正常视频导出全部在用户浏览器完成，云服务器不需要 GPU。
- 不分发游戏资产，不提交地图 pak、游戏录音或原游戏安装。OpenSA 为 AGPL-3.0，保留许可证，提供网络服务时按许可提供对应源码。私有部署目录 `release/` 不进入 Git。
- 保留已有未提交工作和原录像。`.codegraph` 是外部目录链接，不遍历或清理其目标。只修改任务涉及的内容。

## 2. 必须遵守的防回归规则

1. 修改回放代码后：TypeScript 0 错误 → `build-flight-replay.ps1` 发布 → 运行相关截图回归并实际查看图片。按风险选择测试，不用测试输出替代视觉检查。
2. 世界纹理只走 `engine.textures.beginLoad()` 与分帧 `drainUploads(budget)`。禁止一次同步上传全部数组，禁止在 cell 常驻时替换纹理数组；否则 render bundle 引用失效，Intel Arc 会黑屏/TDR。
3. 保持高清/远景半径 **1200/3000**、地块并发 `MAX_PARALLEL_LOADS=2`、地图网络并发 2。不要通过加半径、加并发、降低画质或强杀掩盖故障。
4. 每笔纹理写入（包括数组最后一笔）都检查 CPU/字节预算。Pak 批次字节上限 **1 MiB**；单笔超大写单独处理以保证前进。copy-only 批次显式 `queue.submit([])` 后等待 `onSubmittedWorkDone()`；不能依赖 `engine.frame()` 隐式提交。最终 fence 完成前不绘制、不推进录像时钟。
5. `.cmd` / `.ps1` 必须 ASCII-only；Windows cmd/PowerShell 5.1 会错误解码无 BOM 的 UTF-8 脚本。
6. 只关闭自己启动的测试浏览器。使用测试专属新 profile，正常关闭；禁止强杀复用的 Chrome、删除用户浏览器数据或增加 GPU 绕过参数。新 profile 成功不证明用户缓存损坏。
7. 所有录制值、推断值、显示动画和示意几何明确区分；缺测保留未知。不得把推断 RPM、按键、伤害、烟源或声音增益写成实测。
8. 暂停帧缓存仍要处理输入、相机、viewport、环境、飞机/轨道、cell/collider revision、标记/图示和导出目标失效；播放与导出逐帧更新，不可把暂停优化套到所有渲染。
9. WGSL 隐式纹理采样不能放入由材质 varying 控制的非一致分支。rigid 月亮反射使用一致导数和 `textureSampleGrad` 保持 mip；不要通过关闭 shader 验证绕过 derivative-uniformity。

## 3. 环境、目录与模块入口

开发命令从本项目根目录执行；游戏默认在 `GTA San Andreas/`，当前测试环境 SA-MP 0.3.7-R5 + CLEO/ModLoader。录制器按 GTA:SA PC 1.0 US 布局开发，非标准 EXE/模型需单独验证。Intel Arc A380 曾发生驱动重置，浏览器/驱动版本以现场诊断为准。

下文 `flight/` 指 `tools/opensa/apps/web/src/flight/`，`scripts/` 指 `tools/opensa/scripts/`。

| 位置 | 用途 |
| --- | --- |
| `recorder/src/FlightRecorderASI.cpp` | x86 ASI；25 Hz 采样、分段、CSV、碰撞与爆炸事件，无音频进程 |
| `recorder/build.ps1`、`install.ps1`、`tests/run-tests.ps1` | 构建、备份安装、实际 C++ writer/布局测试 |
| `tools/zig/zig-windows-x86_64-0.14.0/zig.exe` | 本机 Zig 编译器，Git 忽略 |
| `tools/opensa/flight-replay.html`、`apps/web/src/standalone/flight-replay.ts` | 页面与应用入口，路径前缀均为 `tools/opensa/` |
| `flight/pak-world.ts`、`pak-resources.ts`、`map-pak-cache.ts` | 地块、飞机/环境资产、统一浏览器缓存读取 |
| `flight/csv.ts`、`math.ts`、`aircraft.ts`、`camera.ts`、`camera-track.ts` | 解析/采样、坐标/姿态、飞机、相机时间线 |
| `flight/free-camera.ts`、`replay-navigation.ts` | 独立观察相机输入、共享终点模型/选择 |
| `flight/cockpit-instrument-data.ts`、`cockpit-instrument-mesh.ts`、`cockpit-instruments.ts` | 仪表数据、几何与私有图集 |
| `flight/shot-panel.ts`、`shot-camera.ts`、`shot-segment-editor.ts`、`shot-sequence.ts`、`shot-camera-diagram.ts` | 镜头、分段、混剪与图示 |
| `flight/browser-video-export.ts`、`audio-engine.ts`、`audio-engine-web.ts`、`audio-offline.ts` | 浏览器导出、共享合成音频 |
| `scripts/bake-map.mts`；`flight/map-source.ts`、`asset-store.ts` | 离线烘焙；后两者不用于运行时游戏扫描 |
| `web-replay/local-server.mjs`、`map-pak-http.mjs` | 静态页、录制文件、地图清单与 HTTP 压缩 |
| `web-replay/Dockerfile`、`web-replay/deploy/` | 精简镜像、Compose/README/env 源模板 |
| `web-replay/dist/opensa/`、`tools/opensa/map-pak/`、`release/` | 已发布页面、全地图、手动上传目录，均 Git 忽略 |

## 4. 构建、运行与发布

命令各自注明起始目录，不要重复进入同一相对目录。开发依赖在 `tools/opensa/` 安装；普通用户使用网页下载的录制器，不需要 Node/npm/Zig。

从项目根目录启动并保持服务窗口运行：

```powershell
.\start-replay.cmd
```

唯一用户入口为根目录 `start-replay.cmd`，调用 `web-replay/start-server.cmd`，访问 `http://127.0.0.1:4173/` 并尝试载入最新 CSV。启动器复用独立的 `chrome-profiles/replay`，保留地图缓存。Docker 直接运行 Node，不使用 Windows 启动器。

从 `tools/opensa/` 检查并发布回放：

```powershell
npx tsc --noEmit -p tsconfig.json
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1
```

构建从 `dist-flight/` 发布到 `web-replay/dist/opensa/`，旧发布目录移入 `web-replay/backups/`；之后运行与改动有关的 `scripts/*` 截图测试。若 npx 包装器故障，使用已安装的本地入口，如 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`、`node node_modules/tsx/dist/cli.mjs`，先排查而非重装全部依赖。

修改 recorder C++ 后，从 `recorder/` 构建、测试、安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装备份并替换 `gta_sa.exe` 旁的 ASI，备份后移除旧 `GameAudioCapture.exe`；不删除原 CSV。完全退出并重启游戏才会加载新版。不要把替换磁盘文件称为当前游戏进程已经加载新版。录制器更新后重建网页，保证下载包同步。

## 5. 地图烘焙、流送与缓存

### 烘焙与资源版本

普通全图烘焙先启动本地服务，供 `/game-src` 读取自备安装，再从 `tools/opensa/` 执行：

```powershell
npx tsx scripts\bake-map.mts map-pak
```

默认数据源 `http://127.0.0.1:4173/game-src`，可用 `GAME_SOURCE_BASE` 覆盖；游戏路径由服务的 `GAME_ROOT` 控制，默认项目 `GTA San Andreas/`。烘焙器仍支持 cell 矩形位置参数，仅作开发用途；`--recording` 及逐录像 pak/HUD/API/CLI 已删除，不能恢复旧交互。

- Pak 当前 `replayAssets.version=3`，音频清单 version=8；不能将旧文档的 v2 要求或 v3–v7 音频清单当当前版本。
- 输出包括 `index.json`、`cells/`、`collision/`、`textures/`、`data/`、`aircraft/`、`fx/`、`audio/`。环境数据包括 `timecyc.dat`、`water.dat`、`vehicles.ide`、`carcols.dat`、`handling.cfg`。
- 飞机只打包 520/476，并加入共享 `vehicle.txd`；飞机 TXD 优先，共享 TXD 补缺。模组或不兼容资源版本更新后重新烘焙。
- 已有 version=3 pak 可用 `npx tsx scripts\bake-map.mts map-pak --audio-only` 更新 `audio/` 和索引音频 lane；这不升级地图/飞机/FX，version=2 等旧 pak 必须完整重烘。
- 地图按约 300 单位 cell 焊接。当前本机整图 562 cells、1852 文件、832188787 字节（793.64 MiB）；历史约 40 秒烘焙只是本机参考，不是耗时保证。
- `/map-pak/index.json` 缺失直接报错，不能回退到读取 GTA 原始安装；运行时只通过 `PakWorld`/`PakResources` 读取 pak。所有录像共用全图，正常半径始终 1200/3000。

### 浏览器缓存与 HTTP

`map-pak-cache.ts` 是纹理/cell/collision/replay assets 的统一读路径。CacheStorage 使用内容 SHA256；保存前验证解压后的长度与 hash。未变文件跨更新复用，替换文件清理；清理过程隔离旧下载写入。不得缓存用户 CSV。

总地图网络并发 2；后台整图逐文件保存只占一槽，前景请求优先、合并并提升已排队的同文件请求。后台暂停/继续、中断续存、清理不能改变相机/录像/GPU 常驻数据或上传合同。

服务返回稳定 `cache-manifest.json`，仅只读计算 hash；未变文件复用 hash，两个文件并行哈希。资源支持 Brotli 5 / gzip 6，正确设置 `Content-Encoding`/`Vary`；版本请求核对文件身份/大小/mtime，运行中被替换返回 409，刷新获取新清单。流式中断不得重复发送响应头。客户端缺失资源用 no-store 获取，避免再保存一份普通 HTTP 地图缓存。

本机整图参考传输约 Brotli 275.48 MiB / gzip 314.73 MiB；CacheStorage 保存解压数据，含开销约 795 MiB。`navigator.storage.persist()` 不保证获准；配额不足仍可按需回放。缓存属于相同 origin/浏览器配置，无痕、清理数据或域名/端口改变会影响复用；这是地图缓存，不是完整网站离线启动。诊断 `videoExport=1` 不启动后台整图保存，前景读取仍可缓存。

## 6. 录制器与 CSV 数据合同

### 采样、时基和分段

- 仅 Hydra 520/Rustler 476；进入自动录制，离开、换机、失效时关闭并写结束原因，无 F11 开关。输出在游戏目录 `flight_recordings/`。
- 采样 25 Hz/40 ms，当前 v13 正常 101 列；列名驱动，旧 v4–v12 兼容，缺列为 null/未知。v10 前损伤未知，v11 前 W/S 未测。相机调试关闭，`FLIGHT_RECORDER_CAMERA_DEBUG` 保留；旧 `camera_*` 只约 25 Hz，不是逐渲染帧实测。
- v13 不再启动/编译/安装/打包音频助手，不录制原声。删除 16 列：ax/ay/az、steer、center_gear_status、misc_a/b 局部位置六列、nozzle_rotation_previous、prop_node_status、engine_load_inferred/source、transmission_gear_source。保留中线/prop 四元数、当前喷口和有音频用途的推断挡位；状态有效性由四元数/nan 判断。加速度只在内部用于碰撞事件。精简依据见 recorder/README.md。
- `capture_elapsed_s` 保留单调 QPC 会话原点；早期缺列录像按本地时间读取。不可重写原 CSV。
- v12 只写 `key_w,key_s,keyboard_state_valid`，不再采集 Q/E/A/D/箭头。`GetAsyncKeyState` 高位仅在游戏有前台焦点时有效，失焦 valid=0、W/S=-1；不解析自定义键位/手柄，短于 40 ms 的边沿可能漏采。
- H 在每个游戏回调检测物理按下边沿，供 QuickHome 分段，不新增 CSV 按键列。两秒内优先确认位置/姿态/速度/实测修复；即使完全原地不变，满两秒后的首个采样也保证按请求分段。按住不反复触发、待处理重复按下不延长期限、失焦取消，恢复焦点时已按住 H 不算新边沿。H 不判断服务器是否接受重置，也未过滤游戏文本输入。
- 保留相邻采样位移 ≥120 m 兜底，正常绕圈本身不切档。新段 CSV 以分段样本 QPC 为原点；`key_h_requested` 仅表示请求兜底，不称实测瞬移，旧录像不重新切割。

### 节点、损伤和推断边界

- GTA→引擎换轴集中在 `flight/math.ts:gtaToEngine`；由正交 right/up/forward 构建姿态四元数并 SLERP。飞机与相机轴取插值后 `pose.orientation`，不直接用 25 Hz 原始行轴向造成桶滚跳变。
- `node_status` bits 0–6 对应 rudder、elevator_l/r、aileron_l/r、gear_l/r。读取 RwFrame 局部 modelling 矩阵，先校验地址、去 bind/正交化；缺测写 nan，不用按键伪造实测舵面。`surface_source` 为 real/partial/inferred，依版本合同处理。
- v7 的 `misc_a/misc_b` 中线起落架优先用实测四元数；旧记录按实机量得 −80°/+130° 与收轮进度补充显示。v8 增加喷口、可读 prop、烟雾/明确爆炸事件和可选 QPC 时间列。
- v10 的五槽损伤来自单独验证的 `plane+0x5B4`，每次采样核对 getter `0x6C2300` 和 `0x6CB990` 两段签名；不匹配/不可读写未知，不调用损伤函数。这不解除其他未验证偏移的限制。
- 损伤字段为 `surface_damage_valid/source`、`plane_damage_raw`、五槽值；valid bits 0–4，来源 game_memory/unknown。CPlane frame 16–20 对应 raw 的 `(2*(frame-12))` 位；0完好/1受损/2脱落/3其他原始编码，未知 -1。与血量、节点可读性和空气动力学效率独立。解析验证机型/版本/来源/raw/valid/各槽一致性；损伤离散保持，不插值或跨未知补值。
- v9–v12 挡位 0–6、负载 `clamp(max(abs(throttle),abs(brake)),0,1)` 逐行标 inferred；v13 仅保留有用途的 transmission_gear_inferred，并在列名/文件头声明推断来源。飞机合成音频使用 throttle/brake，不消费被删负载列；旧列解析保持。不输出或猜测真实发动机 rev/RPM。本机 EXE SHA1 `185b73fbceaa05d66452691fc0d15c8d61b92a7e` 不是 SDK 标准指纹，不能据机型名任用结构偏移。
- 碰撞事件是推断：单采样血量下降 ≥20 **或**峰值保持加速度 ≥30 m/s² 即满足，冷却1秒；格式 `# event,<seconds>,collision,inferred,<impact_m_s2>,<x>,<y>,<z>`。不称实测接触材质；v9 前文件不识别该推断事件。爆炸必须有明确 `# event,...,explosion,...`，不由低血量/碰撞/结束原因猜测。

## 7. 飞机模型、相机与舱盖

### 模型与动画

- 使用本机 DFF/TXD 与 `carcols.dat`；创建及显隐恢复仅显示精细 body，隐藏 chassis_vlo/lod/dam 重叠网格。当前不切换破损外观，不能拿损伤灯等同于破损网格。
- 轮径读取 `vehicles.ide`，不要写死 `[1,1]`；本机 Hydra 前/后直径 0.7/0.3 m。引擎 part 扁平化需要保留最近祖先 part 并补偿子树绕父 pivot 旋转/平移，否则起落架收起而轮子不动；带网格 dummy 不等同轮子。
- Hydra 实体喷口是 `wheel_lm_dummy` / `wheel_rm_dummy`（ePlaneNodes 6/3），不是 moving_prop；`nozzle_rotation` 驱动 native-X 绝对0–90°。隐藏 builder 在这两帧生成的伪共享轮胎，显隐恢复后仍隐藏，保留真正起落架。
- Rustler propeller 绕 native-Y；静叶 static_prop 与 moving_prop 模糊盘切换。实测四元数优先；旧录像的相位按 capture time 确定性推断，健康值≤0停转，不声称录到了 engine-on/RPM。暂停/倒拖/导出相同。
- Hydra 侧壁与舱外尾部共用反射材质；`aircraft-interior.ts` 只将完整匹配的12面/16个独立内壁顶点设 matte，保留几何/材质/共享顶点保护，不能关闭整个共用材质。Rustler coefficient255机腹反射抑制继续保留。

### 启动和观察相机

- 普通启动为 SA-MP 连接画面自由鸟瞰：GTA eye `(1093,-2036,90)`、look-at `(384,-1557,20)`；引擎 eye `[1093,90,2036]`、target `[384,20,1557]`。自动载入最新 CSV 保留该视角；空列表仍流送/绘制地图并保留未变 idle 帧。
- 手动拖入或选择成功保留的 CSV：选最新保留项、退出预览/自由/机舱观察、取消 fly-to，切 chase-mid。无有效 CSV 的导入不动相机；重置/退出自由回到飞机跟随。诊断 videoExport 启动保持原诊断镜头；相机/HUD测试显式重置。
- ReplayCamera 切换必须同步 `camera.mode`；追尾高度沿 `+WORLD_UP`。机舱相机锚到实际部件，先 `engine.updateVehicles()` 后求相机，避免读上一帧矩阵。
- 第三人称按约100 Hz固定时步预计算有状态轨迹，避免浏览器刷新率改变结果；FOV 按4:3基准/游戏显示宽高比/网页宽高比换算，不能为截图差异改模型比例。近/远档缺原版镜头实测时不宣称全部校准；碰撞由 pak collision 处理。
- Hydra cockpit/cockpit-look 默认 seat-eye 后移0.26 m、下移0.07 m，中立下俯8°；两者共用 canopy/eye frame。原版 first-person、追尾、Rustler不套此偏移。观察眼位受实际舱盖平面约束，回头/前探/导出保留当前 pose，不能重复叠加默认俯角。
- 自由/机舱观察输入：WASD/方向键、Space/Shift移动，E升档/Q降档，极慢/慢/中/快四档到端点停止，按住不重复跳档；Ctrl不再切档。保留文本输入保护与失焦清键。

### 玻璃、划痕和局部倒影

- `front_facing` 区分实际玻璃正反面，不根据相机模式造单向玻璃：外侧原烟熏 RGB 与 `1-(1-a)^1.5`，内侧中性环境底色、alpha=`a*0.04`。这是回放适配，不是物理单向透射。
- `canopy-surface.ts` 从 Hydra67个玻璃顶点拟合横截面弧长/纵向米制坐标，借闲置reflection字节存1/4096 m定点坐标；不改几何/法线/原UV，超编码范围mod禁用细节。内侧随机曲线固定附着，太阳/月亮/眼向驱动近似散射，Rustler不套Hydra划痕；不恢复旧照片/规则圈纹/全舱捕获试验。
- `canopy-reflection.ts` 仅构建舱内静态不透明 chassis 面片的局部BVH，用既有TXD；排除玻璃、外机身、活动件、lod/dam。软件射线4 m内最近交点，最大512三角形/1023节点/1024遍历，超预算整层禁用。模型专属只读storage binding11，独立释放，不能当顶点缓冲或替换常驻纹理。
- 倒影权重 `min(0.04+0.96*(1-|N·V|)^5,0.12)*0.75`，暗源抑制、夜间0.20，外侧不加倒影。转头有近场视差，共同平移保持附着；没有飞行员/动态仪表/移动部件反射、全场景光追、精确遮挡/折射。正常强度A/B与增强诊断分开，不拿诊断可见度当用户认可。

## 8. 仪表与操纵反馈

- Hydra 原版仪表几何受完整模型/座椅/chassis/共享顶点检查保护；三主表、健康/五槽灯、油门/喷口/起落架，绿色瞄准玻璃显示航向。改装不匹配跳过，不强行修改模型。
- Rustler 五表：上速度/高度，下绿色固定飞机+旋转罗盘/姿态/综合状态；40个原版三角形、约29°面板检查完整才启用，向飞行员偏移2 mm、边框1 mm。综合表恰好两灯：GEAR只DOWN绿；任一已测损伤>0则DMG琥珀，无损灭，缺测无已知损伤时灰并显示DMG?。
- 专用1024×1024 RGBA图集原位更新，约25 Hz录像时间节奏，伤害/档位/控制变化即时处理；暂停不重复上传。`updateVehicleTextureLayer` 不重建纹理/绑定组/世界数组，生命周期随飞机同步。
- `GAME km/h` 是位置/录制时间导出的三维游戏速度，不是IAS/TAS；速度0–300，两级各0.25 s因果阻尼；海拔世界Z，0–1000、800参考刻度只是原版常规升限阈值，非坐标硬上限。超量程针停端点、数字保留并标OVR/LOW，不绕圈、不锁死270。
- 健康/油门显示动画0.4/0.28 s，按capture time缓存因果缓动；原数据和损伤警告即时。未知油门立即清除，速度高亮弧跟同一阻尼针值。`THROTTLE *` 为默认W/S代理：W100%、S0%、均未按50%，双键/失焦未知；旧全零油门使用另标legacy控制代理，不补造W/S。
- 摇杆仅改匹配的隔离stock顶点：Hydra48、Rustler52，alpha64/255、matte；实测机体局部升降/副翼驱动，0.15°死区、18°显示上限。缺轴/脱落隐藏相应运动、单侧可读显示partial，不回退键盘猜测。
- 共用 `pedalPresses`：native-Z方向舵正twist让尾缘向右+X，右踏板前进+Y；只指示侧最多7 cm，另一侧中立。3D固定上轴/刚臂圆弧运动，未知/脱落隐藏，capture time保证暂停/逆序/导出一致；不是实测AV-8B/P-51机构。
- Hydra踏板为上梯形/下半圆、两暗凹位，面约108×137 mm、中心距240 mm，支点x=±0.12/y=3.98/z=0.29，中立面y=3.6763/z=-0.0419、40°，后boss臂长约450 mm。单根35 mm直臂终止背面boss，不折返、不穿正面，不恢复底轨。
- Rustler为P-51启发圆角板/下挡边，120×180 mm、中心距340 mm；支点x=±0.17/y=0.68/z=-0.04，面约y=0.47/z=-0.30、12°，arm=[-0.21,-0.26]。五表/座位保护门控，刹车提示只是外观，无未测刹车动画。
- chase-near/mid/far才显示底部屏幕仪表与2D操纵反馈，cockpit/first-person/cockpit-look/free隐藏。共用状态/绘制；HUD按transport真实顶部布局并限制侧栏高度，导出按输出分辨率独立布局，底边16 px，只对HUD矩形alpha合成。
- 2D踏板保持刚性投影、原简洁线条/透明填充/细杆/双点。上轴固定、杆/面居中，踩下整组远离观察者，透视宽高同比变化；不能压扁面、横切、固定脚跟或加地面支撑。
- Hydra上靠背只在cockpit-look半透明alpha64；完整32顶点独立复制并保护下座椅，其他视角用opaque，整机隐藏两副本都隐藏，导出共用视角切换。

## 9. 环境、粒子和时间

- 环境来自pak `timecyc.dat`/`water.dat` 与CSV游戏时钟/天气，旧记录缺列用有来源说明的默认值，不用电脑本地时间冒充游戏时钟。取消跟随录制冻结当前有效值；正常配置走HUD，URL参数仅保留测试覆盖。
- 可选时间流：每60 s录像推进1游戏小时，以anchor hour + capture seconds求值；开启锚当前有效时间、关闭冻结、跟随录制停止流。`ExportView.environment`携带手动环境及anchor，不能累加墙钟/每帧delta。
- 天空方向使用去平移的view/projection逆矩阵，reversed-Z far depth=0，主相机及反射probe共用；不能重建近面世界点再减千米相机坐标，float32抵消会导致日/月/星跳动。
- Hydra jet billboard让原贴图V=0尖端沿投影发射速度，含出生姿态/喷口角；仅hydra-jet用layer负地址 `-(layer+1)`，非负世界/烟/爆炸和20-float pak stride不变。轴向/零速度要有限fallback，不增加粒子数掩盖方向问题。
- 损伤烟绑定五测得槽：状态1取实际DFF几何中心+录制节点旋转，2在attachment stump，完好/未知不发；健康<900且无已知伤点用泛化引擎烟兜底，独立于CPlane烟标志。四puff/源/tick，总八puff公平轮转，1024粒子池；这是显示选择而非测得烟源。
- 烟取最新实际行，不提前用插值血量；每粒子保留出生pose，不把当前节点变换套旧烟。常规FX按录像时间确定性重建窗口，倒拖不叠旧粒子。
- 首个明确爆炸即结束导入播放并冻结飞机：事件精确位置+最新实际body/node姿态，停止新烟/喷焰；`flight-explosion.ts`保留原CSV并单独准备结束track。普通回放四秒独立墙钟爆炸，即使末端暂停也播放，不给scrubber追加时长；倒拖/切track清除，重新选终点重启。全录像导出才有确定性爆炸尾，显式A/B片段不追加；爆炸过期后保留暂停帧缓存。

## 10. 导入、航迹、信标与连播

- 移除/过滤只操作本次会话，保留原CSV、音频关联、插入顺序并可undo。自动过滤仅入批，至少3条有效track且采样数严格小于本批中位数10%才删；单/双条保留。显式按钮处理当前列表。
- 删除非active项保留选择、时间、播放和完整free pose；删active暂停并选邻项。重建marker indices；清空释放飞机/路线/FX/HUD和两音频lane、使异步飞机加载失效，undo不用重读文件。
- 每个endpoint都保留红色球体、精确中心与重合选择；仅普通free可见和pick，其他视角及其导出隐藏GPU两组。球半径0.75、轨道1.125，密集团共用紧凑density halo不隐藏点；两个buffer同步增长。呼吸/绕行动画用独立实时时钟，暂停继续；隐藏视角不破坏缓存。debug triangle可选格式xyz+normal xyz。
- 已在free选信标保持整个相机pose并取消未完fly-to，但仍选record/停endpoint；只有从其他模式进入free可飞到终点。专用endpoint列表/DOM已删除，索引经ReplayNavigation直接解析，不复活旧2D分析面板。
- 可选航迹/图例/GPU线仅free及相应导出显示，只选中track，全程每80 m箭头。血量<250红优先，任一已测受损黄，五槽全有效完好绿，其他灰；损伤离散，健康25%颜色边界按采样同阈值插值精确分割。只track改变上传，释放旧lines。
- 选可见迹线按最后实际camera投影、GPU frustum裁剪及透视正确capture time定位并暂停，保留free pose；拖动即使回到起点也不算click。隐藏线不pick；真beacon hit优先，但宽hit半径不能吞附近线点击。
- 连播可关闭，仅自然播放到末端触发：真实2 s停留，准备下个机型/地图后1.2 s平滑位置/quaternion转场再播，末条停。手动pause/seek/track/delete/camera input取消；free按endpoint位移保留观察偏移，转场中取消保留当前相机进入free。只准备/转场临时保留出发/路径/目的地cell，结束释放回正常半径/两fetch限制。
- 时间显示Consolas/Courier等宽数字、固定flex宽度覆盖所有导入时长；先舍入总毫秒再分解，避免00:60.000，后续控件不能随数字移动。

## 11. 镜头编辑、图示与预览

- `ShotView`四类：固定、定点跟拍、伴飞、座舱。计划按录像内容身份保存，JSON校验和旧单镜头兼容。A/B用原始capture seconds，界面只读，通过当前时间按钮/free迹线选择；不恢复精调坐标/FOV/时间手动输入。
- 固定/跟拍/伴飞均支持连续capture-time分段，最多64，统一 `shot-segment-editor.ts`；座舱不分段。伴飞可保存aircraft/world方向、角度/距离/高度/FOV/进入transition；world分段保存position/yaw/pitch/FOV/transition。smoothstep、最短角插值和前缀推导垂直heading兜底确保pause/seek/preview/export一致，不依赖渲染先后或墙钟。
- 只更新当前段，不覆盖其他已存段；分段边界连续且在录像范围内，代表时间在本段过渡后且严格小于end。移位/FOV过渡、定点跟拍看当前飞机、伴飞不穿飞机中心。
- 选择/拆分/删除段或混剪clip：先结束预览恢复编辑observer，再seek代表时间/更新diagram高亮，保留完整位置/朝向/FOV/焦距；取消自动travel/fly-to并暂停同步图标。不能自动调用inspectShotDiagram。只有显式「查看3D图示」才移到总览，替代旧自动重构观察相机方案。
- `ShotSequence`/`ShotProgram`是独立混剪模式，不是第五种ShotKind。连续绝对时间clip各持ShotView，可含cockpit，精确cut时选后一clip；预览/每帧导出先resolve再构建相机。整段A/B只编码一次、连续音轨，保留独立四文件模式/旧JSON。
- 图示使用复用GPU debug-line buffer：橙camera、青16:9 frustum、水平/垂直FOV弧，光心/朝向/FOV来自实际保存相机及共用cockpit锚；40 m绘制深度和机身尺寸只是示意。分段展示全体编号camera/frusta、彩色路线/边界/代表capture时间、当前段高亮，world-heading不重采样成aircraft-heading。
- 只面板打开且普通free显示diagram/独立label canvas；preview、其他view、route travel、所有导出均隐藏全部组与标签，不能只隐藏DOM。图示显隐/几何加入暂停key，只变化才上传，清空释放。
- 预览退出在活动卡片、固定顶部工具条及Escape；自然到B仍可退出。恢复完整相机、录像时钟、播放/环境，不只更新参数下拉而不刷新时间线/diagram。

## 12. 音频当前实现与证据边界

实时WebAudio/离线共用 `audio-engine.ts` 的capture-time timeline/cue；PannerNode、浏览器与离线重采样不同，不宣称波形逐位一致或100%原版。

- 当前pak音频清单v8，34样本，bank/provenance/采样率/headroom逐项校验。Hydra bank138/slot19：HARRIER_FRONT10、HARRIER_REAR11、THRUST26、JET_DIST14；本机 `ProcessGenericJet` 0x4FF900/520分支0x4FF9BD静态调用支持这四源，未证明运行时增益/播放状态。旧WHINE29/LIFT_LOOP15默认层和4.4 kHz来源归因已撤销，不恢复。
- Rustler玩家四层：FASTPROP bank53 FRONT0/REAR1，VEHICLE_GEN138 PROP_NEAR17/PROP_DIST16；FASTPROP_D54不是玩家收油路径。每层一份原速loop连续调rate，避免同循环重采样档叠加拍频；HARRIER前后约5 ms、Rustler前后约2 ms等功率接缝，极短loop不要强行20 ms淡化截断周期。
- 控制/速度/姿态代理、健康衰减、声源比例/距离/多普勒/低速掉声均须保持inferred。旧throttle全零时音频用有标注的 `max(throttle,1-brake)`，不改CSV原始负载字段。Rustler频率按记录姿态/输入平滑，不能声称有m_fPropSpeed或真实pad/tick。近场以20 m归一，多普勒声速340 m/s、径向限幅±35 m/s。
- Hydra高速25–60 m/s渐入推断油门响度差，W满基准不变，0.12/0.25 s升降平滑。用户认可的FRONT/REAR音色保留，THRUST实验中频支路默认关闭；不得为某一总混音边沿硬造原版公式。
- 碰撞bank39 sound20–28九个载具表面样本，确定性选取避免连续重复、±2%变调；事件没有实测材质，不声称双表面/刮擦/冲量规则完全还原。
- 页面和导出使用固定默认合成参数；调音台、参数持久化和导出调音快照已删除。旧 localStorage 调音记录不再读取，不清空用户浏览器数据。
- 音频试听结论与自动测试分开；静态反汇编、合成fixture和真实游戏采集分别标来源。游戏原声导入/播放与对照分析脚本已删除。地图音效素材解码和离线合成 PCM 的内部封装仍供实时播放/MP4使用，不是录像附件。

## 13. 浏览器视频导出与地块就绪

正常导出由用户浏览器WebGPU/WebCodecs + Mediabunny（现有锁定依赖）完成H.264/AAC MP4，1920×1080，可30/60/120 fps；不上传CSV/PCM/RAW/编码视频，不启动服务器Chrome，不写服务器MP4。`/video-export*`默认410，仅 `ENABLE_SERVER_VIDEO_EXPORT=1` 开旧诊断实现；不把历史ffmpeg服务端copy-mux当现行云方案。

- 1–4 distinct shots快照串行，背压、及时关闭VideoFrame/AudioSample。单输出256 MiB、本页累计512 MiB、离线前史PCM192 MiB；超限明确缩短片段。WebCodecs不支持则提示，不回退服务器。完成Blob/取消时已完成结果保留；清理URL/刷新释放浏览器缓存，不删已下载文件。
- 保留完整CSV前史求controls/FX/camera/audio；先混音到B再在A裁PCM，保留loop/filter/reverb历史。显式A/B不加爆炸尾，全录像才追加。混剪一次编码连续音轨，独立多机位仍各文件。结束/取消恢复相机/clock/播放/环境。
- 各机位独立合成空间音轨，不共用飞机中心收音：固定/定点相机速度为零，伴飞/座舱按capture-time机位轨迹求速度；飞机多普勒速度由位置/capture-time求m/s，不直接使用游戏单位vx/vy/vz。混剪cut及零过渡分段不算相机运动，禁止跨cut插值位置/速度；这些声学响应仍为inferred。Mediabunny 1.61.1的AudioSample.toAudioData读取整个底层buffer，PCM块必须独立复制，不能传包含WAV头及其他块的subarray；否则每4096帧重复WAV开头并产生周期爆音。
- `PakWorld.waitForExport` 等完整wanted cell ring，包括尚未因两fetch限制调度的cell；仅pending为空不足以证明完整。泵bounded流送/collision/geometry copy，显式submit/fence后重绘再readback，等待不推进capture time。必要tile失败/超时明确失败，已完成但不在当前ring丢弃；不扩大半径/预算/并发。
- resident/collider变化后重绘；RAW/编码共用像素读取、GPU完成、BGRA→RGBA、黑帧校验及HUD矩形alpha合成。所有编辑叠加/diagram/labels排除，普通free导出也同样处理。
- 不称实时导出：历史60s/60fps约65–68s、120fps约122–141s仅旧管线本机测量，不能当当前浏览器保证。120fps仅提高显示cadence，不能恢复25Hz录制器未采到的运动。旧诊断蓝焰4:2:0损色并非粒子变少；先同capture time/环境比较未编码RGBA与解码结果，不通过加粒子掩盖编码问题。

## 14. 全屏、错误恢复与客户端安装指南

- Fullscreen请求 `document.documentElement`，保留独立仪表canvas；`fullscreenchange`控制clean UI/HUD布局，退出保留面板原open/hidden状态。不能只fullscreen场景canvas，未变暂停画面resize不能被清空。P通过同一guarded action播放/暂停，V切镜头，输入框/组合键/重复键保护保留。
- 原始数据按钮、实时数据面板及逐帧 readout 已删除；底部不显示合成音频状态文字，保留音频开关。`window.__flight` 继续提供自动测试诊断。渲染失败必须显示独立 `role=alert` 卡片并提供重试/显卡诊断。只有尚未初始化pak/GPU的null adapter可原页重试，保留已导入CSV、选中/时间；其他fatal按刷新恢复。world未ready禁用渲染/相机/play动作，文件仍可导入。
- 公网 HTTP 启动先检查 `isSecureContext`，显示 `insecure-context` 错误及 Chrome 临时测试步骤；站点地址取 `location.origin`，其他渲染错误不显示这段指南。诊断 bootId 在 `crypto.randomUUID` 不可用时使用非安全用途的回退值。测试例外仅由用户手动配置，不自动修改浏览器；正式访问仍需可信 HTTPS。错误卡片小屏可滚动，普通 Chrome 回归验证说明、地址和按钮布局。
- 音频未初始化不能误标视频导出，只有显式 `videoExport=1` 才这样显示。Arc device-lost自动恢复每分钟最多一次；正常重启旧Chrome可释放失效adapter状态，但不解决再次触发的上传根因。
- `standalone/recorder-guide.ts`在GPU初始化前绑定原生dialog；左栏指南含下载安装/Win32 ASI loader官方入口、单个 ASI 与 gta_sa.exe 同目录、自动录制/CSV 导入、自动合成声音、排查和卸载。不捆绑 loader 或游戏文件。
- `build-flight-replay.ps1`调用 `scripts/package-recorder.mjs`，将现有 `recorder/build/FlightRecorder.asi` 和 `recorder/INSTALL.zh-CN.txt` 打包到 `dist/opensa/downloads/GTASA-FlightRecorder-v13.zip`，配 SHA256 清单、固定 ZIP 时间戳。无 GameAudioCapture.exe/.NET 要求；缺构建不阻止网页发布，显示安装包不可用而非死下载链接；用户无需编译/烘焙。
- 指南Tab/Esc保持浏览器默认行为，modal键不触发P/V/WASD回放，keyup仍清 held keys；暂禁自由相机输入，关闭恢复并回入口focus。小屏可滚动，标题/关闭固定，指南不入导出。普通渲染失败仍能阅读/下载。

## 15. 服务与 Docker 手动部署

服务环境变量：`HOST`默认127.0.0.1、`PORT`4173、`GAME_ROOT`游戏路径、`MAP_PAK_ROOT`默认全图、`RECORDINGS_ROOT`可指外部录像、`NO_OPEN=1`避免启动浏览器。

- `/`跳转保留query，`/opensa/*`静态文件，`/map-pak/*`地图/内容清单，`/local-recording/latest.csv`提供本地录制；`/game-src/*`只供baker且首次请求才建立安装索引，缺游戏不阻止pak回放。
- 最新CSV用120 ms间隔两次stat，若仍增长回退最新已完成文件，避免Content-Length中途变化。4173占用先辨认是否其他checkout服务，不能把旧页面误判构建失败。
- `/webgpu-report`记录启动阶段，`webgpu-events.jsonl`含bootId、phase/进度及device-lost实际info.message；诊断按同bootId对应事件，不凭一次profile对照归因。
- 多阶段Docker从官方Node24 Alpine只提取Node/musl/libstdc++/libgcc/用户/CA/许可证，最终scratch，USER node UID1000；无npm/Yarn/shell/node_modules/Zig/源码/游戏/地图。已发布静态文件含小型Windows录制器下载包，但容器不执行它。
- Docker直接启动Node、NO_OPEN=1/HOST=0.0.0.0、地图独立只读挂载，诊断导出关闭；`.dockerignore`白名单排除开发树。公网需现有HTTPS反向代理以满足WebGPU/存储安全上下文，不需要CDN，代理保留压缩响应头、不二次压缩。
- `web-replay/deploy/`是Compose/README/env源模板，`release/`是手动上传完整目录：image.tar.gz、地图副本、compose.yaml、.env、许可证、SHA256SUMS、image-info.json。Compose相对挂载`./map-pak`，read_only、create_host_path=false、pull_policy=never，无build，platform=linux/amd64，restart=unless-stopped。
- 容器根只读，cap_drop ALL、no-new-privileges、16 MiB tmpfs；Node健康检查实际访问页面和map index，日志10 MiB×3。默认host127.0.0.1:4173，.env改端口/监听；上传地图需UID1000可读，必要时 `chmod -R a+rX map-pak`。

在上传目录运行：

```sh
sha256sum -c SHA256SUMS
docker load -i gtasa-flight-replay-image.tar.gz
docker compose up -d --wait
docker compose ps
```

上传前确保网页/录制器下载与镜像同步：从项目根 `docker build -f web-replay/Dockerfile -t gtasa-flight-replay .`，导出gzip并实际重新docker load核对镜像身份；重算压缩包hash、image-info及SHA256SUMS（不校验用户可改.env）。地图副本和源逐文件核验，不因改文档重烘地图。部署详情见 [web-replay/deploy/README.md](web-replay/deploy/README.md)。

2026-10-04 v13 同步参考：镜像约184.66 MiB，gzip49.26 MiB（51653396字节）；镜像Id `sha256:0ec3f417c50f4d37159a0a66f713bace2d1aae71d5bc1009e5b706454aeec5e7`，gzip SHA256 `46695aaf8c6cc8fc3443218dbfa51b509845f622e74a51beca58e066053574c7`。网页安装包 v13 仅 ASI/说明两文件，188846 字节；导出包已重新加载核对身份。地图未改；后续以实际元数据为准。

本机Docker Desktop4.93.0/Engine29.8.1/WSL2.7.13已安装、重启后虚拟化正常。用户模式曾因缺安装路径注册键失败，官方卸载空安装/改所有用户安装后修复；可执行入口 `C:\Program Files\Docker\Docker\Docker Desktop.exe`，CLI在resources/bin。不要伪造注册键；新旧进程PATH可能不同。此前Hub下载通过构建进程临时HTTP(S)_PROXY=用户已有127.0.0.1:10808解决，不修改全局网络。此处是故障记录，不要求每次重装或使用该代理。

## 16. 排障依据与测试入口

### 根因优先

| 症状 | 已证实根因/处理边界 |
| --- | --- |
| 纹理上传期黑屏/TDR | 同步大数组、常驻数组替换、最后一笔绕预算或copy-only未独立submit；逐批budget/fence与最终ready检查 |
| 暂停优化后device-lost，之后adapter=null | 绘制减少暴露隐式提交依赖；仅加字节预算或回退shader都不是充分修复，最终显式queue.submit解决。保留shader优化/暂停缓存 |
| `chrome://gpu` D3D12 Available但adapter=null | 可能为device-loss后浏览器状态；正常重启仅恢复状态。没有底层证据不能宣称LUID失配、缓存/驱动某项是唯一原因 |
| 飞行桶滚机舱抖、相机切换无变化 | 使用未插值行轴/未同步camera.mode/在更新飞机前读锚点；修计算时序与姿态来源 |
| 日月星随平移跳动 | reversed-Z近面世界点减大坐标导致float32抵消；去平移逆矩阵+far0 |
| 原版对照飞机显宽、起落架轮径错 | FOV宽屏基准/IDE轮径/父子动画补偿，不改模型比例掩盖相机误差 |
| 同机型重复网格或缺通用贴图 | chassis_vlo与HD重叠、漏共享vehicle.txd，显隐恢复也须修 |
| Hydra内壁蓝白块 | 内壁/外尾共享反射材质，局部16顶点matte；不是玻璃倒影或CSV问题 |
| 进游戏无CSV | CLEO异步替换0x53E981 hook，看门狗每秒检查并重新链入CALL/JMP；不能用固定Sleep。无heartbeat先查hook，有heartbeat再查目标/采样 |
| 边录边回放latest失败 | 最新CSV仍追加导致Content-Length失配，读取已稳定文件 |
| 参数正常但时间轴回到0 | scrub.max需随duration同步 |
| 4173显示旧版/404 | 另一个checkout服务或未发布dist；先辨认进程/文件 |
| 旧实时焊接每0.5s顿感 | 当时全量纹理重编码+定时触发；运行时已删除，不恢复旧CellRenderer/preloadTargets方案 |
| 测试旧截图路径/fixture不存在 | 历史QA/backup、上游blog/docs/fixtures、Android prebuilt已清理，必要素材需从用户备份恢复，不是源码测试天然可全跑 |

`@opensa/renderware`桶导出在Node ESM/tsx曾漏map再导出，脚本用明确子路径。性能指标分CPU提交→GPU完成总延迟与纯GPU耗时；异常timestamp不作为收益证据，不承诺GPU利用率低于100%。

### 按改动选择测试

以下文件均在 `scripts/`；带真实输入的脚本先查看参数，使用自备全图/CSV并确认fixture可用。测试浏览器必须正常关闭。适配器/渲染改动至少普通headed Chrome、无GPU flags与实际导出路径；synthetic注入只验证消费端，不称真实飞行。

| 范围 | 回归入口 |
| --- | --- |
| 启动/导入跟随/空列表地图 | `test-startup-camera.mjs`、`test-renderer-startup.mjs`、`test-map-startup.mjs` |
| pak独立性/多录像/拖动/压测 | `test-standalone-pak.mjs`、`test-multitrack.mjs`、`test-scrub.mjs`、`soak-replay.mjs`、`smoke-map.mts`（tsx） |
| 地图缓存/压缩 | `test-map-cache.mjs`；服务 `web-replay/map-pak-http.test.mjs` |
| 机位/分段/混剪/图示 | `test-shot-export.mjs`、`test-shot-sequence.mjs`、`test-shot-camera-diagram.mjs` |
| 浏览器导出/地块完整性/连播/时钟 | `test-browser-export.mjs`、`test-export-terrain.mjs`、`test-replay-todos.mjs` |
| 相机/自由输入/全屏/环境 | `test-camera-modes.mjs`、`test-camera-collision.mjs`、`test-cockpit-look.mjs`、`test-free-camera-controls.mjs`、`test-replay-fullscreen.mjs`、`test-replay-time-flow.mjs` |
| 仪表/摇杆/踏板/模型 | `test-cockpit-instruments.mjs`、`test-flight-instrument-hud.mjs`、`test-rustler-instruments.mjs`、`test-cockpit-stick-motion.mjs`、`test-cockpit-pedals.mjs`、`test-rustler-pedals.mjs`、`test-aircraft-interior.mts` |
| 起落架/喷口/桨叶 | `test-hydra-center-gear.mjs`、`test-hydra-nozzles.mjs`、`test-rustler-propeller.mjs` |
| 舱盖/天空/FX | `test-canopy-geometry.mts`、`test-canopy-views.mjs`、`test-canopy-lighting.mjs`、`test-canopy-reflection.mjs`、`test-sky-motion.mjs`、`test-jet-direction.mjs`、`test-damage-smoke.mjs`、`test-explosion-ending.mjs` |
| 信标/迹线/移除撤销 | `test-endpoint-picking.mjs`、`test-endpoint-spheres.mjs`、`test-endpoint-flyto.mjs`、`test-flight-route.mjs`、`test-route-picking.mjs`、`test-recording-removal.mjs` |
| 音频/安装指南 | `audio-engine.conformance.test.ts`、`audio-offline.test.ts`、`audio-listener.test.ts`、`test-browser-audio.mjs`、`test-recorder-guide.mjs`、`test-shot-export.mjs` |
| 帧缓存/性能 | `test-replay-performance.mjs`、`profile-replay.mjs`、`benchmark-replay.mjs` |

使用相关vitest/Node测试检查纯数据/编码/HTTP合同，录制器用真实writer/signature测试。既有全仓lint问题和Nx提示与新增错误分开报告；不要因为过去记录“相关lint通过”就声称全仓清零。截图/JSON/MP4通常gitignored captures或系统临时目录，测试后无需提交资产。仅文档修改检查路径/链接/事实即可，不触发应用/镜像重建。

## 17. 现状、后续与文档维护

已实现：v13精简录制与损伤（仅 CSV、101 列）、两机仪表/操纵反馈、全图缓存/压缩、浏览器本地导出、外部镜头分段/混剪/图示、可取消连播、固定时间栏、SA-MP启动机位/导入跟随、精简Docker/完整Compose目录、网页录制器指南。历史“五项TODO逐项等待”的流程已被后续统一完成取代，不继续作为任务阻塞条件。

仍可评估但未承诺实施：画质总开关；引擎原位追加纹理层的Route B；自定义SA-MP/ModLoader覆盖资源和非原版模型/EXE兼容；缺真实数据工况的相机/音频对照。Rustler五表/摇杆/踏板已完成，不能再以旧“Rustler仪表未适配”作待办；特定改装座舱锚点仍需验证。

历史标签 `v1.0` / `V1.1` 保留；当前代码已超出标签功能。后续按本文所属主题更新当前约束、实际验证和局限，不再追加上百段重复流水账，不重新引入实时焊接、逐航迹pak、浮动分析HUD、终点列表、飞机调试轴、手动精调或浏览器缓存重置启动器。

合并覆盖：原工程记录0–13的路径/构建/根因；14–28的地图版本和当前音频；29–43的最终舱盖/倒影；44–64、68–72、79–83的最终仪表/操纵几何；65–67、73–78的渲染/天空/喷焰/全屏；84–99的信标/损伤/爆炸/迹线/分段/撤销；100–109的最终镜头/本地导出；110–119的清理/全图/启动/缓存/Docker/Compose/安装指南。旧bundle名称、试验参数往返及每次测试流水账已压缩为现行规则和证据边界。
