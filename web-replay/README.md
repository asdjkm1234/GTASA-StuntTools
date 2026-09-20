# GTASA Flight Replay（本地版，OpenSA WebGPU）

双击 `启动本地回放.cmd`，会启动本地服务并打开：

`http://127.0.0.1:4173/`

回放页是 OpenSA 的 WebGPU 引擎（源码在 `../tools/opensa`，构建产物发布到 `dist/opensa/`）。
它只从本机的 `../GTA San Andreas` 按需读取原版 Hydra/Rustler、贴图、IDE/IPL 与地图模型，不会上传或分发任何游戏资源。

## 用法

- 直接回放最新本地记录：`http://127.0.0.1:4173/?local=latest`
- 打开回放页后可拖入一个或多个 CSV，或点击选择文件。
- 多文件以各自起点对齐；点击左侧列表选择要跟随的飞行。
- 播放 / 暂停 / 重新开始 / 逐帧 / 时间轴拖动 / 0.25×–4× 速度。
- 按 **V** 切换「延迟跟随」与「机舱第一人称」；重置视角回到默认跟随。

## 本地服务提供的接口

- `/`：302 跳转到 `/opensa/flight-replay.html`（保留查询串）。
- `/opensa/*`：回放页静态资源。
- `/game-src/__index`：游戏目录的 `{path,size}` 扁平索引（OpenSA http-dir 加载器读取）。
- `/game-src/<path>`：按需读取游戏文件，支持 `Range` 分段，用于大型 IMG（如 `models/gta3.img`）。
- `/local-recording/latest.csv`：`flight_recordings/` 中最新的一份 CSV。

端口 4173 已被占用时不会抛 `EADDRINUSE`：服务会提示“已在运行”，并打开已有页面。

## 重新构建回放页

```powershell
cd ..\tools\opensa
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1
```

环境/地图：天空、太阳、雾、水色由 `data/timecyc.dat` 驱动，时间取 CSV 的**游戏时钟**、天气取 `weather_*`；
旧文件没有这些字段时回退到参数化的晴天中午，绝不用电脑本地时间冒充游戏时间。
