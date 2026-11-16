# YaYa bot MCP Server

让 AI 也能给 YaYa bot 安排任务：创建一个定时脚本、看看运行结果、定时发送网络唤醒信号，都可以交给 AI 来完成。

YaYa bot MCP Server 通过 Model Context Protocol（MCP）连接外部 LLM。AI 不需要理解 Cron，只要告诉它“每天 09:00”“工作日 18:30”或“每 10 分钟”，就能安排执行计划。

## 架构与地址

```text
外部 LLM / MCP Client
        │ MCP Streamable HTTP + Bearer Token
        ▼
yaya-ops-mcp :8081
        │ 内部 HTTP API
        ▼
yaya-ops :8080 → SQLite / 调度器 / 脚本执行器
```

- MCP 地址：`http://127.0.0.1:8081/mcp`
- 传输方式：Streamable HTTP，无状态模式，JSON 响应
- 默认只监听部署机器的本机地址
- MCP 不直接操作数据库，所有任务都经过原有 API、语法检查和调度器
- 任务和执行日志与网页端实时共享，无需额外数据卷

启动：

```bash
docker compose up -d --build
```

网页仍为 <http://localhost:8080>，MCP 为 `http://localhost:8081/mcp`。

## 可用工具

| 工具 | 用途 |
| --- | --- |
| `create_script_task` | 创建 Shell 或 Python 定时任务，自动检查语法 |
| `create_wol_task` | 创建 Wake-on-LAN 定时任务 |
| `check_script` | 只检查脚本语法，不执行、不保存 |
| `list_tasks` | 查询任务 ID、执行计划、状态和下次执行时间 |
| `run_task` | 立即执行指定任务 |
| `get_task_runs` | 查询最近执行记录、退出码和日志 |

当前 MCP 不提供修改和删除工具，避免 LLM 意外覆盖或移除已有任务。

## 执行计划参数

`create_script_task` 和 `create_wol_task` 共用以下参数：

| 参数 | 说明 | 示例 |
| --- | --- | --- |
| `frequency` | 必填：`minutes`、`hourly`、`daily`、`weekly`、`monthly` | `daily` |
| `timezone` | IANA 时区，默认 `Asia/Shanghai` | `UTC` |
| `time` | 每天、每周、每月任务的时分，默认 `09:00` | `18:30` |
| `minute` | 每小时任务的第几分钟，默认 `0` | `15` |
| `interval_minutes` | 分钟间隔，1-59，默认 `10` | `5` |
| `weekdays` | 每周任务的星期数组；0 或 7 为周日，1 为周一 | `[1,2,3,4,5]` |
| `month_day` | 每月日期，1-31，默认 `1` | `15` |
| `enabled` | 是否启用定时调度，默认 `true` | `false` |

例如：

- 每 10 分钟：`frequency="minutes", interval_minutes=10`
- 每小时第 15 分：`frequency="hourly", minute=15`
- 每天 09:30：`frequency="daily", time="09:30"`
- 工作日 18:30：`frequency="weekly", time="18:30", weekdays=[1,2,3,4,5]`
- 每月 1 日 02:00：`frequency="monthly", time="02:00", month_day=1`

每月 31 日等日期在不存在的月份会跳过。脚本任务还支持 `timeout`（秒）；WoL 任务还支持 `mac`、`broadcast` 和 `port`。

## 客户端配置

在支持 HTTP MCP 服务和自定义请求头的客户端中添加：

```json
{
  "mcpServers": {
    "yaya-ops": {
      "type": "http",
      "url": "http://127.0.0.1:8081/mcp",
      "headers": {
        "Authorization": "Bearer 你的MCP_API_TOKEN"
      }
    }
  }
}
```

不同客户端的 JSON 外层结构可能不同，核心配置是 URL、HTTP 类型和 `Authorization: Bearer ...` 请求头。未设置 `MCP_API_TOKEN` 时不需要该请求头，但服务应只监听本机。

### 官方 Python SDK 示例

安装依赖：

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install mcp==1.30.0
```

调用示例：

```python
import asyncio
import os

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main():
    token = os.getenv("MCP_API_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    async with httpx.AsyncClient(headers=headers) as http_client:
        async with streamable_http_client(
            "http://127.0.0.1:8081/mcp", http_client=http_client
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                print(await session.list_tools())

                result = await session.call_tool(
                    "create_script_task",
                    {
                        "name": "每天生成运维问候",
                        "task_type": "python",
                        "script": "from datetime import datetime\nprint(datetime.now())",
                        "frequency": "daily",
                        "time": "09:00",
                        "timezone": "Asia/Shanghai",
                    },
                )
                print(result)


asyncio.run(main())
```

## 推荐给 LLM 的指令示例

- “创建一个名为‘工作日磁盘检查’的 Shell 任务，工作日 18:30 执行 `df -h`，时区 Asia/Shanghai。”
- “每 10 分钟运行这个 Python 脚本。先检查语法，语法通过后再创建任务。”
- “列出所有任务，找到‘数据库备份’并立即运行，然后告诉我最近一次执行日志。”
- “每周一到周五 08:00 向 MAC `00:11:22:33:44:55` 发送网络唤醒。”

创建成功后，工具会返回任务 ID、内部 Cron 和下次执行时间。立即运行返回的是排队记录，需通过 `get_task_runs` 再查询最终状态和日志。`list_tasks` 的列表位于返回对象的 `tasks` 字段，`get_task_runs` 的记录位于 `runs` 字段；没有执行记录时 `runs` 为空数组。

## 远程访问与安全

MCP 能间接创建可执行任意脚本的任务，风险等同于开放网页端的脚本创建接口。

1. 默认保持 `MCP_BIND_ADDRESS=127.0.0.1`。
2. 局域网访问改为 `0.0.0.0` 时，必须设置独立的 `MCP_API_TOKEN`；否则 MCP 容器会拒绝启动。
3. 使用防火墙限制客户端 IP，远程公网访问应再通过 HTTPS 反向代理加密。
4. `APP_API_TOKEN` 是 MCP 到网页后端的内部凭据，`MCP_API_TOKEN` 是外部 LLM 到 MCP 的凭据，建议使用不同的随机字符串。
5. 不要把任一令牌写进提示词、公开仓库或截图。

`.env` 示例：

```dotenv
APP_API_TOKEN=后端随机令牌
MCP_BIND_ADDRESS=0.0.0.0
MCP_PORT=8081
MCP_API_TOKEN=MCP独立随机令牌
```

远程客户端将 URL 改为服务器地址，例如 `https://ops.example.com/mcp`。路径映射需保留为 `/mcp`。

## 故障排查

- **401 Unauthorized**：检查 `Authorization: Bearer ...` 是否使用 `MCP_API_TOKEN`，不是 `APP_API_TOKEN`。
- **连接被拒绝**：确认 `docker compose ps` 中 `yaya-ops-mcp` 正在运行，且客户端访问的是 8081。
- **MCP 提示无法连接后端**：检查 `yaya-ops` 是否健康，以及两个容器的 `APP_API_TOKEN` 是否一致。
- **创建任务返回语法错误**：修正脚本后重试；检查工具不会执行脚本。
- **容器启动即退出**：如果 `MCP_BIND_ADDRESS` 不是本机地址，必须同时设置 `MCP_API_TOKEN`。
