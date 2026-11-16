# YaYa bot

YaYa bot 是你的定时任务小帮手。把 Shell 或 Python 脚本交给它，挑一个时间，它就会准时开跑，并帮你收好每次执行记录。你还可以用它定时发送网络唤醒信号，或者接入 AI，让 AI 帮你安排任务。

通过 Docker Compose 部署，Linux、macOS 和 Windows（Docker Desktop）都能使用相同的安装方式。

## 功能

- Shell（Bash）和 Python 3 脚本，支持在线编辑与文件上传
- 保存前自动检查 Shell / Python 语法
- 可视化频率、时间和独立任务时区，无需填写 Cron
- 手动运行、超时终止、并发执行
- 执行状态、标准输出、错误输出和退出码
- Wake-on-LAN 网络唤醒
- SQLite 持久化，重启后自动恢复调度
- MCP Server，外部 LLM 可创建任务、立即执行并查询日志
- 可选访问令牌，默认只监听本机

## 快速启动

安装 Docker 及 Compose 插件后，在项目目录运行：

```bash
docker compose up -d --build
```

打开 <http://localhost:8080>。MCP 地址为 `http://localhost:8081/mcp`，客户端配置和工具说明见 [doc/MCP.md](doc/MCP.md)。

```bash
# 查看运行状态
docker compose ps

# 查看服务日志
docker compose logs -f

# 停止服务（不会删除任务数据）
docker compose down
```

任务与日志保存在名为 `yaya-data` 的 Docker 数据卷中。`docker compose down -v` 会永久删除这些数据，除非确定不再需要，否则不要加 `-v`。

### 启用访问令牌

```bash
cp .env.example .env
```

编辑 `.env`，把 `APP_API_TOKEN` 改为足够长的随机字符串，再启动服务。网页会要求输入一次令牌；令牌仅保存在当前浏览器标签页的会话存储中。

默认 `BIND_ADDRESS=127.0.0.1`，只有部署机器本机能访问。如果改为 `0.0.0.0` 以允许局域网访问，务必同时设置访问令牌，并使用防火墙限制来源。不要把无认证的脚本执行接口暴露到公网。

## 文档索引

| 文档 | 进一步阅读 |
| --- | --- |
| [MCP 服务指南](doc/MCP.md) | MCP 工具、客户端配置、调用示例、远程访问与安全说明 |
| [宿主机目录挂载指南](doc/MOUNTS.md) | 查看挂载信息、映射宿主机目录、读写权限与脚本示例 |

后续的专题文档统一放在 `doc/` 目录，并在这里添加入口。页面顶部的“文档”按钮也可打开文档中心，`doc/` 中新增的 Markdown 文档会自动出现在阅读列表中。

## 创建任务

### Shell / Python

脚本在容器内的 `/data/workspace` 工作目录执行，此目录随数据卷持久化。Shell 使用 Bash，并启用 `errexit`、`nounset` 和 `pipefail`。

每个脚本进程都可以读取以下环境变量：

| 变量 | 内容 |
| --- | --- |
| `TASK_ID` | 任务 ID |
| `RUN_ID` | 本次执行 ID |
| `TASK_NAME` | 任务名称 |
| `TZ` | 任务时区 |

Shell 示例：

```bash
date
df -h
printf '当前工作目录：%s\n' "$PWD"
```

Python 示例：

```python
from datetime import datetime
from pathlib import Path

Path("last-run.txt").write_text(datetime.now().isoformat(), encoding="utf-8")
print("执行完成")
```

镜像仅包含基础 Python 环境。需要额外系统工具或 Python 包时，请在 `Dockerfile` 中安装后重新构建，不建议每次执行任务时临时安装依赖。

### 执行计划

通过“重复频率＋时间＋时区”设置计划，无需了解 Cron：

- 每隔几分钟：1-59 分钟
- 每小时：指定每小时的第几分钟
- 每天：指定时分
- 每周：选择一个或多个星期，并指定时分
- 每月：选择 1-31 日并指定时分；日期不存在的月份会跳过

每个任务使用自己的 IANA 时区，例如 `Asia/Shanghai`、`UTC`、`America/New_York`。修改 Compose 中的 `TZ` 不会改变已有任务的时区。旧版本创建的任务仍可使用；遇到无法可视化表示的高级 Cron 时，编辑页面会保留原规则，只有主动选择新频率才会替换。

### 脚本上传与语法检查

Shell 可上传 `.sh`、`.bash` 文件，Python 可上传 `.py` 文件。文件必须是 UTF-8 文本且不超过 200 KB；上传后内容会进入编辑器，仍可继续修改。

点击“检查语法”可单独检查，保存任务时也会自动检查。Python 使用当前运行环境的 `compile()`，Shell 使用 `bash -n`，只检查语法，不会执行脚本。检查不通过的任务无法保存，错误位置会显示在编辑器下方。

### 网络唤醒

选择“网络唤醒（WoL）”，填写目标网卡 MAC、广播地址和 UDP 端口（通常为 9）。目标机器必须提前在 BIOS/UEFI、网卡和操作系统中启用 Wake-on-LAN。

执行成功只表示魔术包已发送，不能证明目标机器已经开机。Docker Desktop 的虚拟网络可能限制广播包；此时可尝试目标网段的定向广播地址，例如 `192.168.1.255`。Linux 上如仍受限，可在独立 Compose 覆盖配置中使用 `network_mode: host`，并先启用访问令牌和防火墙。host 网络模式不适用于 Docker Desktop。

## 重要边界

- 定时任务只有在容器运行时才会触发；停机期间错过的任务不会集中补跑。
- 脚本默认操作的是**容器**，不是宿主机。不要随意挂载宿主机根目录或 `docker.sock`，这会显著扩大风险。
- 普通 Docker 容器无法唤醒它自己所在、且已经睡眠或关机的宿主机。宿主机定时上电需使用主板 RTC/BIOS 定时唤醒、智能插座，或另装与具体操作系统配套的主机代理；这些不是跨平台 Docker 能统一提供的功能。
- 网络唤醒主要用于唤醒**同一二层网络中的其他机器**，通常不能跨公网直接使用。

## 本地开发

需要 Python 3.12（MCP SDK 要求 Python 3.10+），Linux 或 macOS 可直接运行；Windows 建议使用 Docker。

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

另开终端启动 MCP：

```bash
. .venv/bin/activate
YAYA_API_URL=http://127.0.0.1:8080 python -m app.mcp_server
```

本地数据默认写入 `./data`。API 交互文档位于 <http://localhost:8080/docs>。

## 项目结构

```text
app/
  main.py          API 与应用生命周期
  scheduler.py     APScheduler 调度
  executor.py      脚本执行、超时与 WoL
  database.py      SQLite 持久化
  schedules.py     Cron 校验与标准星期转换
  script_validation.py  Shell / Python 语法检查
  task_plans.py    LLM 友好时间参数转换
  mcp_server.py    MCP 工具与 HTTP 服务
  static/          无前端构建依赖的网页
compose.yaml       网页与 MCP 服务部署入口
Dockerfile         Python + Bash 运行镜像
doc/               专题文档目录
  MCP.md           MCP 介绍、配置和安全说明
```
