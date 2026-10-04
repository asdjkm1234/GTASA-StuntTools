# GTASA Flight Replay 手动上传部署包

将这个目录完整上传到 Linux x86_64 云服务器的任意文件夹。服务器只需安装 Docker Engine 和 Docker Compose；镜像已在开发机编译，无需安装 Node、npm 或 Zig。

目录中的地图包是完整副本，运行时直接只读挂载。此部署目录约 **843 MiB**，包括约 793.64 MiB 地图和 约 49 MiB 压缩镜像。镜像内的回放页同时提供录制器安装指南及约 185 KiB 的 v13 客户端 ZIP（只含飞行录制器与安装说明） 下载，用户无需编译录制器。

```text
release/
  compose.yaml
  .env
  README.md
  gtasa-flight-replay-image.tar.gz
  gtasa-flight-replay-image.tar.gz.sha256
  image-info.json
  OPENSA-LICENSE
  SHA256SUMS
  map-pak/
    index.json
    cells/ collision/ textures/ data/ aircraft/ fx/ ...
```

上传时也上传隐藏文件 `.env`。即使没有 `.env`，Compose 也会使用文档中的默认端口和监听地址。

## 启动

进入上传目录，手动加载镜像，再启动：

```sh
sha256sum -c SHA256SUMS
docker load -i gtasa-flight-replay-image.tar.gz
docker compose up -d --wait
docker compose ps
```

`SHA256SUMS` 校验镜像、地图和固定配置，`.env` 可按服务器情况修改。Compose 设置为只使用本地镜像，不会自动从镜像仓库拉取，也不会在云服务器重新构建。地图固定挂载当前目录的 `map-pak`，无需修改绝对路径。

## 访问

默认回放服务监听 `0.0.0.0:4173`。在云安全组和服务器防火墙放行 TCP 4173 后，可通过 `http://服务器公网IP:4173/` 检查网页连通性。正式回放仍需 HTTPS。在现有云服务器面板／Nginx 等工具中配置一个 HTTPS 网站，将它反向代理到 `http://127.0.0.1:4173`，之后用户通过 HTTPS 域名访问。

WebGPU 和浏览器地图缓存需要安全上下文，普通公网 IP 的 HTTP 页面不能作为正式回放入口。无需 CDN；地图 Brotli／gzip 压缩和浏览器缓存已启用。代理保留服务返回的 `Content-Encoding`／`Vary`，不要再次压缩已有压缩响应。

用户在网页本地拖入 CSV 即可回放，不用将录像放到云服务器。上传目录不包含你的录制文件、开发依赖或原游戏安装。

## 常用操作

```sh
docker compose logs --tail=100 -f replay
docker compose restart replay
docker compose down
```

端口占用时，修改 `.env` 的 `REPLAY_PORT`，再执行 `docker compose up -d`；同步修改 HTTPS 代理目标端口。`REPLAY_BIND_ADDRESS` 默认为 `0.0.0.0`；若仅允许本机 HTTPS 代理访问，可改为 `127.0.0.1`。修改绑定地址后执行 `docker compose up -d --wait`，重新创建容器；仅执行 restart 不会更新端口绑定。

如果健康检查提示地图文件权限不足，在上传目录执行 `chmod -R a+rX map-pak` 后再启动；容器以 UID 1000 只读访问地图。服务进程及地图目录均只读，日志自动轮换。镜像不带 shell，排查服务使用上面的日志命令。

地图资源仅来自自己的游戏安装，此目录用于你的服务器部署，不进入 Git。提供回放网络服务时，按 OpenSA 的 AGPL-3.0 提供对应源码；许可证见 `OPENSA-LICENSE`，对应源码从开发项目提供。
