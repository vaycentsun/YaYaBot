# Docker Hub Guide

You can run YaYa Bot without building from source by pulling its Docker Hub image. The web interface and MCP service share one image, and Compose starts a container for each service.

## Image Details

- Repository: <https://hub.docker.com/r/vaycent/yayabot>
- Latest image: `vaycent/yayabot:latest`
- Versioned image: `vaycent/yayabot:1.0.0`
- Platforms: `linux/amd64` and `linux/arm64`
- Data directory: `/data`, which must be mounted as a persistent volume

For production, prefer a specific version tag and upgrade deliberately. Use `latest` for a quick trial.

## Start the Web and MCP Services with Compose

After installing Docker and the Compose plugin, download the Compose file into a new directory:

```bash
mkdir yayabot
cd yayabot
curl -o compose.yaml https://raw.githubusercontent.com/vaycentsun/YaYaBot/main/compose.hub.yaml
docker compose pull
docker compose up -d
```

Open:

- Web interface: <http://localhost:8080>
- MCP endpoint: `http://localhost:8081/mcp`

Common commands:

```bash
# Check container status and health checks
docker compose ps

# Follow web service logs
docker compose logs -f yaya

# Follow MCP service logs
docker compose logs -f mcp

# Stop services without deleting task data
docker compose down
```

The same commands work in Windows PowerShell. If `curl` is unavailable, download `compose.hub.yaml` in a browser and rename it to `compose.yaml`.

## Start Only the Web Service

If you do not need MCP, run a single container:

```bash
docker pull vaycent/yayabot:latest
docker run -d \
  --name yayabot \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v yaya-data:/data \
  vaycent/yayabot:latest
```

In Windows PowerShell, put the command on one line or use the PowerShell backtick for line continuation.

## Configure Access Tokens

By default, YaYa listens only on `127.0.0.1` and can be used from the deployment machine without a token. Access tokens are required before enabling LAN or remote access.

Create `.env` beside `compose.yaml`:

```dotenv
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
TZ=Asia/Shanghai
APP_API_TOKEN=replace-with-a-long-random-string
MAX_WORKERS=4

MCP_BIND_ADDRESS=0.0.0.0
MCP_PORT=8081
MCP_API_TOKEN=replace-with-a-different-long-random-string
```

Recreate the containers:

```bash
docker compose up -d
```

`APP_API_TOKEN` protects the web API and is also used by the MCP container to reach the backend. `MCP_API_TOKEN` is used by external MCP clients. Use a different random string for each. Configure a firewall and HTTPS before exposing services, and never expose an unauthenticated script execution API to the public internet.

For local-only access, keep both bind addresses set to `127.0.0.1`, or do not create `.env` at all.

## Mount Host Directories

Edit the downloaded `compose.yaml` and add a mapping under the `yaya` service's `volumes`:

```yaml
services:
  yaya:
    volumes:
      - yaya-data:/data
      - "/host/directory:/mnt/shared:rw"
```

Use `/mnt/shared` in tasks rather than the host path. Mount only the directories your tasks need, and never mount the host root directory or `docker.sock` for convenience. See the [Host Directory Mount Guide](MOUNTS.md) (Chinese) for examples.

## Upgrade the Image

With Compose, run these commands in the directory containing `compose.yaml`:

```bash
docker compose pull
docker compose up -d
```

With `docker run`, pull the new image, then remove and recreate the container. Reuse the same `yaya-data` volume to preserve tasks and logs.

Tasks, execution history, and workspace files are stored in the Docker volume. **Do not run `docker compose down -v` or `docker volume rm yaya-data` unless you intend to delete this data permanently.**

## Build from Source

Developers can still clone and build locally:

```bash
git clone https://github.com/vaycentsun/YaYaBot.git
cd YaYaBot
docker compose up -d --build
```

The root `compose.yaml` builds from source, while `compose.hub.yaml` pulls the Docker Hub image directly.

## Publish Automatically with a GitHub Tag

The `.github/workflows/docker.yml` workflow verifies the Docker build on pushes to `main` and pull requests. Pushing a `v*` tag also builds and publishes `linux/amd64` and `linux/arm64` images.

After forking the repository, configure `DOCKERHUB_USERNAME` and a read/write `DOCKERHUB_TOKEN` under **Settings → Secrets and variables → Actions**. The tag must point to a commit that already contains the workflow.

```bash
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

Tag `v1.0.0` publishes `latest`, `1.0.0`, `1.0`, and `1`. Pushing `main` alone does not publish a new image.

## Publish Your Own Image

After forking the project, you can publish to your own Docker Hub namespace. Run `docker login`, then build a multi-platform image:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-dockerhub-username/yayabot:1.0.0 \
  -t your-dockerhub-username/yayabot:latest \
  --push .
```

Set `YAYA_IMAGE` to use your image without editing Compose:

```bash
YAYA_IMAGE=your-dockerhub-username/yayabot:latest docker compose up -d
```
