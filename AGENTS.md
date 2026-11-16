# AGENTS.md

## 项目概览

YaYa bot 是一个中文定时任务管理项目，展示文案应通俗易懂、轻松活泼。后端使用 FastAPI、APScheduler 和 SQLite，前端是无构建步骤的原生 HTML/CSS/JavaScript。支持 Shell、Python、Wake-on-LAN、MCP、Markdown 文档中心和容器挂载信息展示。

## 启动与部署

Docker 是标准部署方式：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

- 网页：`http://localhost:8080`
- MCP：`http://localhost:8081/mcp`
- 不要对任务数据执行 `docker compose down -v`，该命令会删除持久化数据。

本地开发需要 Python 3.12：

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

## 代码结构

- `app/main.py`：REST API、应用生命周期、静态缓存策略。
- `app/scheduler.py`：APScheduler 任务注册和恢复；不要显式传 `next_run_time=None`。
- `app/executor.py`：脚本执行、进程组超时终止、WoL。
- `app/database.py`：SQLite 连接、任务和执行记录。
- `app/schemas.py`：任务输入校验，创建和更新必须通过脚本语法检查。
- `app/schedules.py`：内部 Cron 校验和标准星期转换，0 和 7 都表示周日。
- `app/task_plans.py`：MCP 友好时间参数转 Cron。
- `app/mcp_server.py`：独立 MCP Streamable HTTP 服务和工具。
- `app/mounts.py`：解析 `/proc/self/mountinfo`，不得为此引入 `docker.sock`。
- `app/documents.py`：发现、读取并渲染 `doc/*.md`。
- `app/static/`：原生网页，无 npm 或前端构建流程。
- `doc/`：所有专题文档。

## 开发约定

- 保持现有 Python 命名和结构，不引入不必要的框架或依赖；新增依赖必须固定版本。
- 前端继续使用原生 JavaScript，不增加 Node 构建流程。修改静态资源时检查版本化 URL 和 `Cache-Control: no-cache`，避免新旧文件混用。
- 用户界面不直接展示 Cron 输入；使用频率、时间、时区等友好设置。修改时间参数转换时，同时检查前端和 `task_plans.py` 的行为。
- Shell 使用 `bash -n` 检查语法，Python 使用 `compile()`；语法检查不得执行脚本。
- 脚本默认在容器中执行。操作宿主机文件必须显式配置挂载，脚本使用页面展示的容器路径。
- 不挂载宿主机根目录或 `docker.sock` 作为默认配置。
- MCP 固定在 `mcp==1.30.0`；2.x 的 `MCPServer` 等接口不兼容。`list_tasks` 返回 `tasks` 字段，`get_task_runs` 返回 `runs` 字段。
- MCP 与网页 API 使用不同令牌：外部客户端用 `MCP_API_TOKEN`，MCP 到后端用 `APP_API_TOKEN`。非本机开放 MCP 时必须配置 `MCP_API_TOKEN`。
- 默认端口绑定保持 `127.0.0.1`。对外开放时同时考虑令牌、TLS 和防火墙。
- FastAPI 自带 API 文档是 `/docs`，项目文档中心是 `/documents.html`，不要混淆路径。

## 文档约定

- 新专题文档必须放入 `doc/`，不要放在项目根目录。
- 新文档需要在 `README.md` 的“文档索引”中添加链接和简短说明。
- 文档中心会自动发现 `doc/*.md`，无需修改前端列表。
- 修改文档目录或命名规则时，同步更新 `Dockerfile` 的复制步骤、README 和相关页面链接。
- 文档使用中文，优先给出可直接运行的示例，并说明宿主机、容器和 Docker Desktop 虚拟机路径的区别。

## 验证

修改后按影响范围执行：

```bash
python3.12 -m compileall -q app
node --check app/static/app.js
node --check app/static/documents.js
docker compose up -d --build
docker compose ps
```

项目目前没有自动化测试套件。功能变更应通过真实 API、浏览器页面或官方 MCP 客户端进行端到端验证，不能只做导入检查。MCP 1.30 客户端通过 `httpx.AsyncClient(headers=...)` 传递鉴权头。

验证结束后删除临时数据库、虚拟环境、挂载样本和其他测试产物，不要删除已有用户数据。
