# GTASA StuntTools

**把 GTA:SA 的特技飞行录下来，在浏览器中回放、布置镜头，制作视频。**

支持 GTA San Andreas / SA-MP 中的 Hydra 和 Rustler。除了重现飞机运动，还可以查看座舱仪表与舵面动作、沿航迹寻找精彩瞬间，并将多个镜头编排成一个 MP4。

- [普通用户：录制、回放与制作视频](#普通用户)
- [开发者：构建、地图与部署](#开发者)

## 普通用户

### 开始之前

使用已经部署好的回放网站时，你只需要支持 WebGPU 的 Chrome 或 Edge，并开启浏览器硬件加速。视频导出还需要浏览器支持 H.264 / AAC 编码。

**回放已有录像无需安装游戏；自己录制时才需要游戏和录制器。** 普通用户无需安装 Node.js、Zig 或编译工具，也无需自己烘焙地图。

录制器适用于 Windows 上的 GTA:SA PC 1.0 US，已在 SA-MP 0.3.7-R5 环境测试。其他游戏版本、替换飞机模型或模组组合需要另行确认兼容性。新版只记录飞行数据，声音由回放网页合成。

### 1. 安装录制器

在回放页左侧点击 **「安装录制器 · 从这里开始」**，查看安装指南并下载录制器 ZIP。

1. 完全退出游戏，解压安装包。
2. 将 `FlightRecorder.asi` 放到游戏根目录，与 `gta_sa.exe` 放在一起。旧版的 `GameAudioCapture.exe` 可以在退出游戏后删除。
3. 确认游戏已有可用的 **32 位 ASI 加载器**。即使 Windows 是 64 位，加载器也应选择 32 位；安装包不包含加载器。
4. 重新启动游戏。

如果只是观看别人提供的 CSV 录像，可以跳过这一步。完整说明也可查看 [录制器安装指南](recorder/INSTALL.zh-CN.txt)。

### 2. 录制一次飞行

进入 **Hydra（520）或 Rustler（476）** 后自动开始录制，不需要按 F11。飞行结束并离开飞机后，在游戏目录的 `flight_recordings` 文件夹中找到录像：

```text
flight_recordings/
  flight_<时间与编号>.csv    飞行数据
```

录制器只生成 CSV。网页会根据飞行数据自动合成声音，旧版 CSV 也可导入。

使用 QuickHome 时，游戏有前台焦点下按 `H` 会请求分段：录制器识别到重置便切换到新文件；没有识别到变化时，约两秒后也会分段。游戏内聊天输入的 `H` 同样可能触发，因此一趟飞行可能产生多个文件。

### 3. 导入并回放

打开回放网页，将 **CSV 拖入页面**，也可以使用文件选择按钮。支持一次导入多段录像；导入 CSV 后，相机会自动跟随飞机。

在左侧选择录像，用底部控制栏播放、暂停、逐帧或拖动时间轴，播放速度可选 0.25×–4×。天气和时间默认跟随录像，也可以手动调整。

页面刚打开时显示 SA-MP 连接画面的城市鸟瞰视角。想随意观察地图，切换到自由视角；想回到飞机旁，点击「退出自由视角」或「重置视角」。

| 操作 | 按键 / 方式 |
| --- | --- |
| 播放、暂停 | `P` 或播放按钮 |
| 切换视角 | `V` 或视角按钮 |
| 自由视角转向 | 按住鼠标左键拖动 |
| 自由视角移动 | `W/A/S/D` 或方向键 |
| 自由视角升降 | `Space` 上升，`Shift` 下降 |
| 自由视角调整速度 | `Q` 降档，`E` 升档 |
| 自由视角前后移动 | 鼠标滚轮 |
| 退出镜头预览 | `Esc` 或「结束预览」按钮 |
| 全屏观看 | 「全屏」按钮；`Esc` 退出 |

自由视角下可以显示整条航迹，点击线段定位时间并暂停，点击终点红球选择录像。航迹颜色表示飞机状态：红色为健康低于 25%，黄色为已测得舵面损伤，绿色为所有舵面已知且完好，灰色为损伤信息不完整。终点红球用于标记位置。

列表里的移除和短记录过滤只影响当前页面，**不会删除磁盘上的录像**；误操作可以「撤销移除」。开启「按列表顺序连续播放」后，录像会依次播放并自动转场。

### 4. 布置镜头、导出视频

打开 **「多机位片段导出」**，先确定片段的起点 A 和终点 B。可以在自由视角航迹上点击选择，也可以播放到目标时间后使用「当前时间」按钮。

提供四类镜头：

| 镜头 | 适合的画面 |
| --- | --- |
| 固定镜头 | 相机停在一个位置，看飞机经过 |
| 定点跟拍 | 相机位置固定，镜头始终朝向飞机 |
| 伴飞机位 | 随飞机移动，从侧面、前方或后方跟拍 |
| 座舱镜头 | 从驾驶舱观察飞行和仪表 |

按照卡片提示布置机位，用鼠标和键盘调整后点击「保存当前机位」。可以预览片段，也可以点击「查看 3D 图示」观察相机位置和取景范围；辅助图示不会出现在成品中。退出预览后会回到此前的观察位置和播放进度。

两种导出方式可按需要选择：

- **分别导出多个机位**：选择 1–4 类镜头，点击「批量导出独立 MP4」。每个机位生成一个文件，方便后续剪辑。固定、定点跟拍和伴飞镜头还可以分段调整。
- **编排成一个视频**：切换到「镜头编排 · 一个视频」，将 A/B 范围拆成若干片段，为每段选择并保存镜头，最后点击「导出编排 MP4」。例如先用固定镜头，再切到伴飞，成品会按编排切换画面并保持音频连续。

机位方案可以保存为 JSON，之后重新导入同一录像时恢复，省去再次布置。

输出为 **1920×1080、H.264 / AAC MP4**，支持 **30 / 60 / 120 fps**。MP4 自动包含合成音频。第三人称视频包含屏幕仪表与操纵反馈，座舱视频保留三维仪表。

渲染和导出都在你的浏览器中完成，速度取决于电脑性能。正常使用不会把导入的录像、声音或生成的视频上传到服务器。

**生成后请及时下载视频。** 刷新、关闭页面或点击「清理已生成视频」会释放临时下载链接。单个视频最多 256 MiB，页面累计最多 512 MiB；遇到容量限制时，缩短片段或清理已下载的视频后重试。

### 地图只需下载一次吗？

首次打开时，网页先加载当前画面需要的地图，再在后台保存完整地图。左侧可以查看进度、暂停或继续；中断后重新打开，会接着补齐剩余资源。

保持 **同一网站地址、同一浏览器及用户配置**，已保存的地图会复用；地图更新时只下载变化的文件。以现有整图为参考，压缩传输约 275–315 MiB，完整保存后占用浏览器存储约 795 MiB。

无痕模式、清理网站数据或浏览器回收存储空间，都可能导致重新下载。缓存只保存地图，不保存你的 CSV；录像请自行保留。网页仍需从网站打开，保存地图不等于整个网站可以离线使用。

### 常见问题

**没有生成 CSV？** 确认使用的是 Hydra 或 Rustler、ASI 加载器正常，并在安装录制器后重启了游戏。游戏根目录的 `FlightRecorder.asi.log` 可以帮助检查录制器是否加载。

**回放的声音从哪里来？** 网页根据飞行数据和地图音效素材自动合成声音，视频导出也使用同样的声音。播放时可用“音频：开/关”按钮静音。

**页面提示 WebGPU 不可用，或画面变黑？** 使用 Chrome / Edge 的普通窗口，确认硬件加速已开启，再尝试页面上的「重试初始化」或「显卡诊断」。驱动重置后可能需要正常关闭并重新打开浏览器。

**提示地图缺失或版本过旧？** 网站需要可用的地图包，请联系部署者处理；普通用户无需运行烘焙脚本。

**导出失败？** 确认浏览器支持 H.264 / AAC 编码，保持网页和网络连接可用，并尝试缩短片段。完成的视频先下载，再清理临时文件。

## 开发者

### 项目结构与准备工作

录制器是 Windows ASI，回放前端基于 OpenSA WebGPU，Node 服务负责提供网页和地图。云服务器只提供资源，视频仍由用户浏览器生成，因此服务器不需要 GPU 或 ffmpeg。

```text
GTASA-StuntTools/
  recorder/                    录制器及构建安装脚本
  tools/opensa/
    flight-replay.html         回放页面
    apps/web/src/standalone/   应用入口、录制器安装指南
    apps/web/src/flight/       地图、飞机、相机、仪表、音频与导出
    scripts/                  地图烘焙、打包与浏览器测试
    map-pak/                  生成的全地图包
  web-replay/
    local-server.mjs           本地及容器资源服务
    dist/opensa/              发布后的网页
    Dockerfile                精简运行镜像
    deploy/                   Compose 模板与部署说明
  start-replay.cmd             Windows 本地启动入口
```

源码仓库不包含游戏安装、地图包、录制器二进制、网页构建产物、`node_modules` 或 Zig 编译器，这些文件均被 Git 忽略。

- **前端与地图工具**：需要 Node.js、npm；地图烘焙另外需要自备游戏安装。容器运行时使用 Node.js 24。
- **录制器编译**：使用 Zig 0.14.0，预期路径为 `tools/zig/zig-windows-x86_64-0.14.0/zig.exe`。
- **浏览器测试**：需要本机 Chrome、可用的 WebGPU、已发布网页和地图包；部分视频校验需要 ffmpeg。

`node_modules` 存放构建所需的 JavaScript 依赖；Zig 用于把录制器源码编译成 ASI。它们用于开发构建，运行容器无需携带。

### 本地构建与运行

以下命令使用 PowerShell，每组注明起始目录。默认游戏目录为项目根目录的 `GTA San Andreas/`。

**先构建录制器**，使网页构建时能够生成下载包。从项目根目录执行：

```powershell
cd .\recorder
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

输出为 32 位 `FlightRecorder.asi`。如果只开发回放，可跳过录制器构建；页面仍可使用，安装指南会提示下载包不可用。

**安装依赖并构建网页**。另开终端，从项目根目录执行：

```powershell
cd .\tools\opensa
npm install --ignore-scripts --no-audit --no-fund
npx tsc --noEmit -p tsconfig.json
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1
```

构建发布到 `web-replay/dist/opensa/`，并将已有发布目录备份到 `web-replay/backups/`。现有的录制器二进制会自动打包为网页可下载的 ZIP；更新录制器后应重新构建网页。

**启动服务**。另开终端，从项目根目录执行：

```powershell
.\start-replay.cmd
```

保持窗口运行，浏览器访问 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。本地服务会尝试加载最新 CSV；尚未生成地图包时，页面提示缺少地图是正常的，完成下面的烘焙后刷新即可。

如需在本机录制，从 `recorder/` 执行安装脚本，随后重新启动游戏：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

自定义游戏目录可传入 `-GameRoot 'D:\Games\GTA San Andreas'`。安装脚本覆盖旧文件前会备份。

### 地图烘焙与路径配置

烘焙将游戏中的模型、贴图、碰撞和环境数据整理成浏览器可直接加载的地图包，避免回放时解析原始游戏安装。**所有录像共用一份全地图包**，无需为每段航迹单独生成。

先启动本地服务，再从 `tools/opensa/` 执行：

```powershell
npx tsx scripts\bake-map.mts map-pak
```

输出位于 `tools/opensa/map-pak/`，包含地图、两种飞机、特效与音频样本。当前包格式为 `replayAssets.version=3`；修改地图或飞机模组、升级不兼容的旧包后，需要重新烘焙。回放运行时必须有地图包。

游戏不在默认目录时，从项目根目录执行以下命令，直接启动服务：

```powershell
cd .\web-replay
$env:GAME_ROOT = 'D:\Games\GTA San Andreas'
$env:RECORDINGS_ROOT = 'D:\FlightRecordings'
node .\local-server.mjs
```

`start-replay.cmd` 会设置默认游戏目录，因此自定义 `GAME_ROOT` 时使用上面的启动方式。

| 环境变量 | 用途 / 默认值 |
| --- | --- |
| `GAME_ROOT` | 烘焙用游戏安装，默认项目根目录的 `GTA San Andreas/` |
| `RECORDINGS_ROOT` | 本地录像目录，默认游戏目录下的 `flight_recordings/` |
| `MAP_PAK_ROOT` | 地图包目录，默认 `tools/opensa/map-pak/` |
| `PORT` | 服务端口，默认 `4173` |
| `HOST` | 监听地址，默认 `127.0.0.1`；容器内使用 `0.0.0.0` |
| `NO_OPEN` | 非空时不自动打开浏览器 |

烘焙器默认读取 `http://127.0.0.1:4173/game-src`。更换服务端口后，在烘焙终端设置 `GAME_SOURCE_BASE` 指向对应地址。烘焙完成后，服务只需地图包和网页即可提供回放；本地自动载入录像还需要配置录像目录。

地图服务支持 Brotli / gzip 压缩。浏览器按文件内容校验并保存地图，复用未变资源，不缓存录制 CSV。部署时应保留 `Content-Encoding` 和 `Vary` 响应头，让已有反向代理正常传递压缩响应。

### Docker 构建与部署

先完成网页构建，再从项目根目录构建 Linux/amd64 镜像：

```powershell
docker build --platform linux/amd64 -f web-replay/Dockerfile -t gtasa-flight-replay:latest .
```

运行镜像包含 Node、必要运行库、已构建网页和录制器下载包；不包含开发依赖、编译器、游戏安装或地图。地图作为独立目录只读挂载，更换地图无需重新构建镜像。

Windows 本地验证示例：

```powershell
$pakPath = (Resolve-Path .\tools\opensa\map-pak).Path
docker run --rm --name gtasa-replay -p 127.0.0.1:4173:4173 --mount "type=bind,source=$pakPath,target=/map-pak,readonly" gtasa-flight-replay:latest
```

确保 4173 端口未被本地服务占用。公网访问需要通过 **HTTPS 反向代理**，使 WebGPU 和浏览器存储工作在安全上下文中；小范围使用可以直接由服务器提供地图，无需 CDN。

手动上传方案使用一个部署目录，放入压缩镜像、地图、Compose 配置及 `.env`。服务器安装 Docker / Compose 后，在该目录执行：

```sh
docker load -i gtasa-flight-replay-image.tar.gz
docker compose up -d --wait
```

Compose 使用本地已加载镜像，地图从相邻目录挂载。默认监听 `0.0.0.0:4173`，放行 TCP 4173 后可检查公网网页连通性；正式回放使用 HTTPS 代理。目录结构、校验、端口设置与日常维护见 [Docker Compose 部署说明](web-replay/deploy/README.md)。

现有构建的参考体积为：运行镜像约 **185 MiB**、gzip 导出包约 **49 MiB**、独立地图约 **794 MiB**，完整手动部署目录约 **843 MiB**。实际大小随构建和游戏资源变化；私有发布目录 `release/` 不进入 Git。

### 修改与测试

修改回放代码后，在 `tools/opensa/` 执行类型检查和发布构建，再选择与改动相关的浏览器测试：

```powershell
npx tsc --noEmit -p tsconfig.json
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1
node scripts\test-shot-sequence.mjs
node scripts\test-browser-export.mjs
```

其他测试包括机位图示、导出地块完整性、地图缓存及录制器安装指南：

```powershell
node scripts\test-shot-camera-diagram.mjs
node scripts\test-export-terrain.mjs
node scripts\test-map-cache.mjs
node scripts\test-recorder-guide.mjs
```

浏览器测试使用独立配置，并生成截图和报告。录制器测试从 `recorder/` 运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
```

CSV 当前为 v13，共 101 列，按列名读取，兼容 v4–v12。已停止录制原声，并移除回放未使用的 16 列，详见 [录制字段与精简说明](recorder/README.md)。原始数据以 25 Hz 采样，缺失字段保留未知；视频高帧率来自回放插值。仪表中的 `GAME km/h` 是游戏速度，`THROTTLE *` 是默认 W/S 输入代理；合成声音、未实测螺旋桨相位和附加踏板属于回放表现。

渲染、流送、录制字段和镜头时间线的实现细节见 [AGENTS.md](AGENTS.md)；录制器字段说明见 [recorder/README.md](recorder/README.md)。修改纹理上传或地图流送时，需保留现有上传预算、GPU 完成等待和并发限制，以避免黑屏与导出缺失地块。

### 许可与游戏资源

OpenSA 使用 **AGPL-3.0**，许可文本见 [tools/opensa/LICENSE](tools/opensa/LICENSE)。部署网络服务时，应按许可提供对应源码。

本项目不附带 GTA 游戏资源。地图包由自备游戏安装生成，包含游戏资产，不随源码仓库分发；私有地图包的使用与部署也需遵守相应资源许可。
