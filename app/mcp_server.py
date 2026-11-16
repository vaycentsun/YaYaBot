import hmac
import json
import os
import urllib.error
import urllib.request
from typing import Annotated, Literal
from urllib.parse import quote

import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field
from starlette.responses import JSONResponse

from .task_plans import build_cron


API_URL = os.getenv("YAYA_API_URL", "http://yaya:8080").rstrip("/")
API_TOKEN = os.getenv("APP_API_TOKEN", "")
MCP_TOKEN = os.getenv("MCP_API_TOKEN", "")
MCP_BIND_ADDRESS = os.getenv("MCP_BIND_ADDRESS", "127.0.0.1")
MCP_PORT = int(os.getenv("MCP_PORT", "8081"))

Frequency = Literal["minutes", "hourly", "daily", "weekly", "monthly"]
Name = Annotated[str, Field(description="任务名称")]
Timezone = Annotated[str, Field(description="IANA 时区，例如 Asia/Shanghai 或 UTC")]
Time = Annotated[str, Field(description="每天、每周、每月任务的 24 小时执行时间，格式 HH:MM")]
Minute = Annotated[int, Field(description="每小时任务的执行分钟，0-59", ge=0, le=59)]
Interval = Annotated[int, Field(description="间隔分钟数，1-59", ge=1, le=59)]
Weekdays = Annotated[list[int] | None, Field(description="每周任务的星期数字列表，0 或 7 为周日，1 为周一，例如 [1,3,5]")]
MonthDay = Annotated[int, Field(description="每月任务的日期，1-31；不存在的月份会跳过", ge=1, le=31)]
Enabled = Annotated[bool, Field(description="是否启用定时调度，关闭后仍可手动运行")]

mcp = FastMCP(
    "YaYa bot",
    instructions="通过可视化时间参数创建和管理 YaYa 定时运维任务。脚本创建时会自动检查语法。星期使用 0 或 7 表示周日，1 表示周一。",
    host="0.0.0.0",
    port=MCP_PORT,
    streamable_http_path="/mcp",
    json_response=True,
    stateless_http=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


def api_request(method, path, payload=None):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = urllib.request.Request(
        API_URL + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "X-API-Token": API_TOKEN},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read()).get("detail", exc.reason)
        except Exception:
            detail = exc.reason
        if isinstance(detail, list):
            detail = "；".join(item.get("msg", str(item)) for item in detail)
        raise ValueError(f"YaYa API 拒绝请求（{exc.code}）：{detail}") from None
    except urllib.error.URLError as exc:
        raise ValueError(f"无法连接 YaYa 后端：{exc.reason}") from None


def schedule_cron(frequency, time, minute, interval_minutes, weekdays, month_day):
    return build_cron(
        frequency=frequency,
        time=time,
        minute=minute,
        interval_minutes=interval_minutes,
        weekdays=weekdays,
        month_day=month_day,
    )


@mcp.tool()
def create_script_task(
    name: Name,
    task_type: Annotated[Literal["shell", "python"], Field(description="脚本类型")],
    script: Annotated[str, Field(description="完整脚本文本；保存时自动检查语法")],
    frequency: Frequency,
    timezone: Timezone = "Asia/Shanghai",
    time: Time = "09:00",
    minute: Minute = 0,
    interval_minutes: Interval = 10,
    weekdays: Weekdays = None,
    month_day: MonthDay = 1,
    enabled: Enabled = True,
    timeout: Annotated[int, Field(description="执行超时秒数，1-86400", ge=1, le=86400)] = 300,
):
    """创建 Shell 或 Python 定时任务，返回任务 ID 和下次执行时间。"""
    payload = {
        "name": name,
        "type": task_type,
        "script": script,
        "cron": schedule_cron(frequency, time, minute, interval_minutes, weekdays, month_day),
        "timezone": timezone,
        "enabled": enabled,
        "timeout": timeout,
        "mac": "",
        "broadcast": "255.255.255.255",
        "port": 9,
    }
    return api_request("POST", "/api/tasks", payload)


@mcp.tool()
def create_wol_task(
    name: Name,
    mac: Annotated[str, Field(description="目标设备 MAC，例如 00:11:22:33:44:55")],
    frequency: Frequency,
    timezone: Timezone = "Asia/Shanghai",
    time: Time = "09:00",
    minute: Minute = 0,
    interval_minutes: Interval = 10,
    weekdays: Weekdays = None,
    month_day: MonthDay = 1,
    broadcast: Annotated[str, Field(description="IPv4 广播地址")] = "255.255.255.255",
    port: Annotated[int, Field(description="WoL UDP 端口", ge=1, le=65535)] = 9,
    enabled: Enabled = True,
):
    """创建 Wake-on-LAN 定时任务，唤醒局域网中的其他设备。"""
    payload = {
        "name": name,
        "type": "wol",
        "script": "",
        "cron": schedule_cron(frequency, time, minute, interval_minutes, weekdays, month_day),
        "timezone": timezone,
        "enabled": enabled,
        "timeout": 300,
        "mac": mac,
        "broadcast": broadcast,
        "port": port,
    }
    return api_request("POST", "/api/tasks", payload)


@mcp.tool()
def check_script(
    task_type: Annotated[Literal["shell", "python"], Field(description="脚本类型")],
    script: Annotated[str, Field(description="要检查的完整脚本文本")],
):
    """只检查脚本语法，不执行脚本，也不创建任务。"""
    return api_request("POST", "/api/scripts/check", {"type": task_type, "script": script})


@mcp.tool()
def list_tasks() -> dict:
    """列出全部任务的 ID、类型、执行计划、启停状态和下次执行时间。"""
    tasks = api_request("GET", "/api/tasks")
    return {
        "tasks": [
            {
                key: task[key]
                for key in ("id", "name", "type", "cron", "timezone", "enabled", "next_run_at")
            }
            for task in tasks
        ]
    }


@mcp.tool()
def run_task(task_id: Annotated[str, Field(description="任务 ID")]):
    """立即运行指定任务，包括已停用定时调度的任务。"""
    return api_request("POST", f"/api/tasks/{quote(task_id, safe='')}/run")


@mcp.tool()
def get_task_runs(
    task_id: Annotated[str, Field(description="任务 ID")],
    limit: Annotated[int, Field(description="返回最近记录的数量，1-50", ge=1, le=50)] = 10,
) -> dict:
    """查询任务最近的执行状态、时间、退出码和输出日志。"""
    runs = api_request("GET", f"/api/runs?task_id={quote(task_id, safe='')}&limit={limit}")
    return {"runs": runs}


class BearerAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and MCP_TOKEN:
            headers = dict(scope.get("headers", []))
            authorization = headers.get(b"authorization", b"").decode("latin-1")
            expected = f"Bearer {MCP_TOKEN}"
            if not hmac.compare_digest(authorization, expected):
                response = JSONResponse(
                    {"error": "unauthorized", "message": "需要有效的 Bearer 访问令牌"},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def run():
    if MCP_BIND_ADDRESS not in ("127.0.0.1", "localhost", "::1") and not MCP_TOKEN:
        raise RuntimeError("对局域网或公网开放 MCP 时必须设置 MCP_API_TOKEN")
    app = BearerAuthMiddleware(mcp.streamable_http_app())
    uvicorn.run(app, host="0.0.0.0", port=MCP_PORT, log_level="info")


if __name__ == "__main__":
    run()
