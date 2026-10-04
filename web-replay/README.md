# GTASA Flight Replay（本地版，OpenSA WebGPU）

双击项目根目录的 `start-replay.cmd`，会启动本地服务并打开：

`http://127.0.0.1:4173/`

回放页是 OpenSA 的 WebGPU 引擎（源码在 `../tools/opensa`，构建产物发布到 `dist/opensa/`）。
它从本机的 `../tools/opensa/map-pak` 读取地图、Hydra/Rustler、天气等数据；运行回放不需要游戏安装。
首次使用、游戏素材变更或从旧版 pak 升级后，在 `tools/opensa` 执行 `npx tsx scripts/bake-map.mts map-pak`，烘焙时才读取游戏目录。
pak 由用户在本机生成，不上传或分发游戏资源。

本地开发统一使用上述入口，旧的重复启动、强制 GPU 和浏览器配置修复／重置脚本已删除。Docker 直接运行 `node local-server.mjs`，部署命令见[项目 README](../README.md#docker-构建与部署)。运行镜像已构建并验证，压缩包约 49.27 MiB，不包含 Windows 启动脚本、npm／Yarn、开发依赖、编译器或地图；地图独立挂载。

## 用法

- 直接回放最新本地记录：`http://127.0.0.1:4173/?local=latest`
- 左侧「安装录制器」提供安装指南、已编译录制器 ZIP、录制文件位置与排查说明；无需普通用户运行构建脚本。网页重建会从 `recorder/build/` 生成 `dist/opensa/downloads/`；Docker 同时包含这个小型客户端安装包。
- 打开回放页后可拖入一个或多个 CSV，或点击选择文件。录制器只生成 CSV，回放与 MP4 自动使用合成声音。
- 多文件以各自起点对齐；点击左侧列表选择要跟随的飞行。
- 所有录像共用全地图 pak，无需按航迹重复烘焙。
- 播放 / 暂停 / 重新开始 / 逐帧 / 时间轴拖动 / 0.25×–4× 速度。
- 按 **V** 切换第三人称近、中、远、原版第一人称和机舱第一人称；重置视角回到默认跟随。
- “自由视角”可移动和旋转镜头；“终点热力图”显示所有片段最后有效位置的红点和俯视密度。红点是片段终点，不一定代表已确认死亡。
- 第三人称显示仪表和舵面反馈；镜头面板可保存镜头、分段或混合镜头，并预览／导出 MP4，操作控件不入画。
- 地图自动保存至浏览器缓存，支持暂停／继续和清理；服务器按客户端能力使用 Brotli／gzip 压缩传输。

## 本地服务提供的接口

- `/`：302 跳转到 `/opensa/flight-replay.html`（保留查询串）。
- `/opensa/*`：回放页静态资源。
- `/map-pak/*`：回放所需地图、飞机与环境资源。
- `/game-src/*`：仅供本地烘焙器使用，首次请求时才读取游戏目录。
- `/local-recording/latest.csv`：`flight_recordings/` 中最新的一份 CSV；可用 `RECORDINGS_ROOT` 指向其他 CSV 文件夹。
- `/video-export`：默认返回 410；仅显式设置 `ENABLE_SERVER_VIDEO_EXPORT=1` 时启用旧诊断接口。正常 MP4 导出完全在浏览器进行，无需服务器 Chrome／FFmpeg，也不上传录像、音频或视频。

端口 4173 已被占用时不会抛 `EADDRINUSE`：服务会提示“已在运行”，并打开已有页面。

## 重新构建回放页

```powershell
cd ..\tools\opensa
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1
```

环境/地图：天空、太阳、雾、水色由 pak 内的 `data/timecyc.dat` 驱动，时间取 CSV 的**游戏时钟**、天气取 `weather_*`；
旧文件没有这些字段时回退到参数化的晴天中午，绝不用电脑本地时间冒充游戏时间。
