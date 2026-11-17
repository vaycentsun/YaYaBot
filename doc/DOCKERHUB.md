# Docker Hub 使用指南

不想从源码构建，也可以直接拉取 YaYa bot 的 Docker Hub 镜像。网页和 MCP 服务共用同一个镜像，Compose 会为你启动两个容器。

## 镜像信息

- 仓库：<https://hub.docker.com/r/vaycent/yayabot>
- 最新镜像：`vaycent/yayabot:latest`
- 版本镜像：`vaycent/yayabot:1.0.0`
- 平台：`linux/amd64`、`linux/arm64`
- 数据目录：`/data`，必须挂载持久化数据卷

生产环境建议使用明确的版本标签，确认新版本后再升级；`latest` 适合快速体验。

## 使用 Compose 启动网页和 MCP

安装 Docker 及 Compose 插件后，在一个新目录下载 Compose 文件：

```bash
mkdir yayabot
cd yayabot
curl -o compose.yaml https://raw.githubusercontent.com/vaycentsun/YaYaBot/main/compose.hub.yaml
docker compose pull
docker compose up -d
```

打开：

- 网页：<http://localhost:8080>
- MCP：`http://localhost:8081/mcp`

常用命令：

```bash
# 查看容器状态和健康检查结果
docker compose ps

# 查看网页服务日志
docker compose logs -f yaya

# 查看 MCP 服务日志
docker compose logs -f mcp

# 停止服务，不删除任务数据
docker compose down
```

Windows PowerShell 也可以使用相同命令；如果没有 `curl`，可用浏览器下载 `compose.hub.yaml`，并把它重命名为 `compose.yaml`。

## 只启动网页服务

不需要 MCP 时，可以直接运行一个容器：

```bash
docker pull vaycent/yayabot:latest
docker run -d \
  --name yayabot \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v yaya-data:/data \
  vaycent/yayabot:latest
```

Windows PowerShell 可以把多行命令写成一行，或使用 PowerShell 的反引号续行符。

## 配置访问令牌

默认只监听 `127.0.0.1`，无需令牌即可从部署机器本机访问。需要局域网或远程访问时，必须配置访问令牌。

在 `compose.yaml` 所在目录创建 `.env`：

```dotenv
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
TZ=Asia/Shanghai
APP_API_TOKEN=请替换为足够长的随机字符串
MAX_WORKERS=4

MCP_BIND_ADDRESS=0.0.0.0
MCP_PORT=8081
MCP_API_TOKEN=请替换为另一个足够长的随机字符串
```

然后重新创建容器：

```bash
docker compose up -d
```

`APP_API_TOKEN` 用于网页 API，也供 MCP 容器访问后端；`MCP_API_TOKEN` 用于外部 MCP 客户端。两者应使用不同的随机字符串。对外开放时还应配置防火墙和 HTTPS，不要把无认证的脚本执行接口暴露到公网。

只需本机访问时，可以保持 `.env` 中的绑定地址为 `127.0.0.1`，或完全不创建 `.env`。

## 挂载宿主机目录

编辑下载后的 `compose.yaml`，在 `yaya` 服务的 `volumes` 下增加映射：

```yaml
services:
  yaya:
    volumes:
      - yaya-data:/data
      - "/宿主机目录:/mnt/shared:rw"
```

任务中使用 `/mnt/shared`，不要直接使用宿主机路径。只挂载真正需要的目录，不要挂载宿主机根目录或 `docker.sock`。详细示例见 [宿主机目录挂载指南](MOUNTS.md)。

## 升级镜像

使用 Compose 时，在 `compose.yaml` 所在目录运行：

```bash
docker compose pull
docker compose up -d
```

使用 `docker run` 时，先拉取新镜像，再删除并重新创建容器；只要继续使用同名 `yaya-data` 数据卷，任务和日志就会保留。

任务、执行日志和工作文件都保存在 Docker 数据卷中。**不要运行 `docker compose down -v` 或 `docker volume rm yaya-data`，除非你确定要永久删除这些数据。**

## 从源码构建

开发者仍然可以克隆仓库并在本地构建：

```bash
git clone https://github.com/vaycentsun/YaYaBot.git
cd YaYaBot
docker compose up -d --build
```

根目录的 `compose.yaml` 用于源码构建，`compose.hub.yaml` 用于直接拉取 Docker Hub 镜像。

## 使用 GitHub Tag 自动发布

仓库的 `.github/workflows/docker.yml` 会在推送到 `main` 或提交 PR 时验证 Docker 构建。推送 `v*` 标签后，还会自动构建并发布 `linux/amd64` 和 `linux/arm64` 镜像。

Fork 仓库后，需要在 **Settings → Secrets and variables → Actions** 配置 `DOCKERHUB_USERNAME` 和具有读写权限的 `DOCKERHUB_TOKEN`。标签必须指向已经包含工作流的提交。

```bash
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

标签 `v1.0.0` 会发布 `latest`、`1.0.0`、`1.0` 和 `1`。仅推送 `main` 不会发布新镜像。

## 发布自己的镜像

Fork 项目后，可以把镜像发布到自己的 Docker Hub 命名空间。先运行 `docker login`，再构建多平台镜像：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t 你的DockerHub用户名/yayabot:1.0.0 \
  -t 你的DockerHub用户名/yayabot:latest \
  --push .
```

使用自己的 Compose 时，可通过 `YAYA_IMAGE` 指定镜像，无需修改文件：

```bash
YAYA_IMAGE=你的DockerHub用户名/yayabot:latest docker compose up -d
```
