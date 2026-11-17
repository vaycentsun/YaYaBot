# YaYa Bot

[简体中文](README.md) | [English](README.en.md)

YaYa Bot is your friendly scheduled-task companion. Hand it a Shell or Python script, pick a time, and it will run on schedule while keeping a record of every execution. You can also use it to send Wake-on-LAN packets or connect an AI assistant to help manage tasks.

Deploy it with Docker Compose for the same installation experience on Linux, macOS, and Windows with Docker Desktop.

## Features

- Shell (Bash) and Python 3 scripts, with an online editor and file uploads
- Automatic Shell and Python syntax checks before saving
- Visual frequency, time, and per-task timezone settings—no Cron syntax required
- Manual runs, timeout termination, and concurrent execution
- Execution status, standard output, standard error, and exit codes
- Wake-on-LAN support
- SQLite persistence with automatic schedule recovery after restarts
- MCP server that lets external LLMs create tasks, run them immediately, and query logs
- Optional access tokens, with local-only listening by default
- Instant Chinese/English interface switching with a saved language preference

## Quick Start

### Option 1: Use Docker Hub (Recommended)

Image: <https://hub.docker.com/r/vaycentsun/yayabot>, available for `linux/amd64` and `linux/arm64`. After installing Docker and the Compose plugin, run:

```bash
mkdir yayabot
cd yayabot
curl -o compose.yaml https://raw.githubusercontent.com/vaycentsun/YaYaBot/main/compose.hub.yaml
docker compose pull
docker compose up -d
```

### Option 2: Build from Source

Clone the project, then run this command in the project directory:

```bash
docker compose up -d --build
```

Both options start the web interface and MCP. Open <http://localhost:8080>. The MCP endpoint is `http://localhost:8081/mcp`; see [doc/MCP.md](doc/MCP.md) for client configuration and tool details (Chinese).

```bash
# Check service status
docker compose ps

# Follow service logs
docker compose logs -f

# Stop services without deleting task data
docker compose down
```

Tasks and logs are stored in the `yaya-data` Docker volume. `docker compose down -v` permanently deletes this data, so do not add `-v` unless you are sure you no longer need it.

### Enable Access Tokens

Copy the example when building from source, or download it for a Docker Hub deployment:

```bash
# Source deployment
cp .env.example .env

# Docker Hub deployment
curl -o .env https://raw.githubusercontent.com/vaycentsun/YaYaBot/main/.env.example
```

Edit `.env`, replace `APP_API_TOKEN` with a sufficiently long random string, and start the services. The web interface will ask for the token once; it is stored only in the session storage of the current browser tab.

The default `BIND_ADDRESS=127.0.0.1` allows access only from the deployment machine. If you change it to `0.0.0.0` for LAN access, be sure to set an access token and use a firewall to restrict sources. Never expose an unauthenticated script execution API to the public internet.

## Documentation

| Document | Further reading |
| --- | --- |
| [Docker Hub Guide](doc/DOCKERHUB.en.md) | Image pulls, Compose startup, configuration, upgrades, and multi-platform publishing |
| [MCP Server Guide](doc/MCP.md) (Chinese) | MCP tools, client configuration, usage examples, remote access, and security |
| [Host Directory Mount Guide](doc/MOUNTS.md) (Chinese) | Mount details, host directory mappings, read/write permissions, and script examples |

Additional topic guides live in `doc/` and are linked here. The “Docs” button at the top of the web interface opens the documentation center, where new Markdown files in `doc/` automatically appear in the reading list.

## Creating Tasks

### Shell / Python

Scripts run in the `/data/workspace` working directory inside the container, which is persisted in the data volume. Shell scripts use Bash with `errexit`, `nounset`, and `pipefail` enabled.

Every script process can read these environment variables:

| Variable | Value |
| --- | --- |
| `TASK_ID` | Task ID |
| `RUN_ID` | Current run ID |
| `TASK_NAME` | Task name |
| `TZ` | Task timezone |

Shell example:

```bash
date
df -h
printf 'Working directory: %s\n' "$PWD"
```

Python example:

```python
from datetime import datetime
from pathlib import Path

Path("last-run.txt").write_text(datetime.now().isoformat(), encoding="utf-8")
print("Run completed")
```

The image includes only a basic Python environment. If you need additional system tools or Python packages, install them in the `Dockerfile` and rebuild the image rather than installing dependencies each time a task runs.

### Schedules

Configure schedules with “frequency + time + timezone,” without learning Cron syntax:

- Every few minutes: 1–59 minutes
- Hourly: choose the minute of each hour
- Daily: choose the hour and minute
- Weekly: select one or more weekdays and the time
- Monthly: select days 1–31 and the time; months without the selected date are skipped

Each task uses its own IANA timezone, such as `Asia/Shanghai`, `UTC`, or `America/New_York`. Changing `TZ` in Compose does not change existing task timezones. Tasks created by older versions remain supported. When an advanced Cron rule cannot be represented by the visual controls, the edit page preserves the original rule and replaces it only if you explicitly select a new frequency.

### Script Uploads and Syntax Checks

Shell tasks accept `.sh` and `.bash` uploads, while Python tasks accept `.py` files. Files must be UTF-8 text no larger than 200 KB. Uploaded content is loaded into the editor, where you can continue modifying it.

Click “检查语法” to run a standalone syntax check; saving a task also checks it automatically. Python uses the current runtime's `compile()`, and Shell uses `bash -n`. These checks only validate syntax and never execute the script. Tasks that fail validation cannot be saved, and error locations appear below the editor.

### Wake-on-LAN

Select “网络唤醒（WoL）,” then enter the target network interface's MAC address, broadcast address, and UDP port (usually 9). Wake-on-LAN must first be enabled on the target machine in its BIOS/UEFI, network interface, and operating system.

A successful run only means the magic packet was sent; it does not prove the target machine has powered on. Docker Desktop's virtual network may restrict broadcast packets. In that case, try a directed broadcast address for the target subnet, such as `192.168.1.255`. If broadcasting is still restricted on Linux, you can use `network_mode: host` in a separate Compose override file after enabling access tokens and a firewall. Host networking is not available with Docker Desktop.

## Important Limitations

- Scheduled tasks only trigger while the container is running. Missed tasks are not run in a batch after downtime.
- Scripts operate inside the **container**, not on the host, by default. Do not mount the host root directory or `docker.sock` without careful consideration, as this significantly increases risk.
- A regular Docker container cannot wake the host it runs on if that host is asleep or powered off. Scheduled host power-on requires motherboard RTC/BIOS wake timers, a smart plug, or a separate host agent designed for the specific operating system; cross-platform Docker cannot provide this functionality by itself.
- Wake-on-LAN primarily wakes **other machines on the same layer-2 network** and generally cannot be used directly across the public internet.

## Local Development

Python 3.12 is required (the MCP SDK requires Python 3.10+). Linux and macOS can run the app directly; Docker is recommended on Windows.

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

Start MCP in a separate terminal:

```bash
. .venv/bin/activate
YAYA_API_URL=http://127.0.0.1:8080 python -m app.mcp_server
```

By default, local data is written to `./data`. Interactive API documentation is available at <http://localhost:8080/docs>.

## Project Structure

```text
app/
  main.py          API and application lifecycle
  scheduler.py     APScheduler scheduling
  executor.py      Script execution, timeouts, and WoL
  database.py      SQLite persistence
  schedules.py     Cron validation and standard weekday conversion
  script_validation.py  Shell / Python syntax validation
  task_plans.py    LLM-friendly time parameter conversion
  mcp_server.py    MCP tools and HTTP service
  static/          Web interface with no frontend build dependencies
compose.yaml       Web and MCP service deployment entry point
Dockerfile         Python + Bash runtime image
doc/               Topic documentation
  MCP.md           MCP introduction, configuration, and security
```
