import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import Database
from .documents import get_document, list_documents
from .executor import Executor
from .mounts import read_mounts
from .scheduler import TaskScheduler
from .schemas import ScriptCheckInput, TaskInput
from .script_validation import check_script


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR.parent / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "workspace").mkdir(parents=True, exist_ok=True)
API_TOKEN = os.getenv("APP_API_TOKEN", "")

database = Database(DATA_DIR / "yaya.db")
executor = Executor(
    database,
    str(DATA_DIR / "workspace"),
    max_workers=int(os.getenv("MAX_WORKERS", "4")),
)
scheduler = TaskScheduler(database, executor)


@asynccontextmanager
async def lifespan(_):
    database.recover_interrupted_runs()
    scheduler.start()
    yield
    scheduler.shutdown()
    executor.shutdown()


app = FastAPI(title="YaYa bot", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def revalidate_static_files(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".css", ".js")):
        response.headers["Cache-Control"] = "no-cache"
    return response


def require_token(x_api_token: Optional[str] = Header(default=None)):
    if API_TOKEN and (
        x_api_token is None or not hmac.compare_digest(x_api_token, API_TOKEN)
    ):
        raise HTTPException(status_code=401, detail="访问令牌无效")


def task_response(task):
    result = dict(task)
    result["next_run_at"] = (
        scheduler.next_run_time(task["id"]) if task["enabled"] else None
    )
    return result


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/scripts/check", dependencies=[Depends(require_token)])
def validate_script(payload: ScriptCheckInput):
    return check_script(payload.type, payload.script)


@app.get("/api/tasks", dependencies=[Depends(require_token)])
def list_tasks():
    return [task_response(task) for task in database.list_tasks()]


@app.post("/api/tasks", status_code=201, dependencies=[Depends(require_token)])
def create_task(payload: TaskInput):
    task = database.create_task(payload.model_dump())
    scheduler.sync(task)
    return task_response(task)


@app.put("/api/tasks/{task_id}", dependencies=[Depends(require_token)])
def update_task(task_id: str, payload: TaskInput):
    task = database.update_task(task_id, payload.model_dump())
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    scheduler.sync(task)
    return task_response(task)


@app.delete("/api/tasks/{task_id}", status_code=204, dependencies=[Depends(require_token)])
def delete_task(task_id: str):
    scheduler.remove(task_id)
    if not database.delete_task(task_id):
        raise HTTPException(status_code=404, detail="任务不存在")
    return None


@app.post(
    "/api/tasks/{task_id}/run", status_code=202, dependencies=[Depends(require_token)]
)
def run_task(task_id: str):
    run = executor.submit(task_id)
    if run is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return run


@app.get("/api/runs", dependencies=[Depends(require_token)])
def list_runs(
    task_id: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    return database.list_runs(task_id=task_id, limit=limit)


@app.get("/api/runs/{run_id}", dependencies=[Depends(require_token)])
def get_run(run_id: str):
    run = database.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="执行记录不存在")
    return run


@app.get("/api/mounts", dependencies=[Depends(require_token)])
def mounts():
    return read_mounts()


@app.get("/api/documents")
def documents():
    return list_documents(BASE_DIR.parent / "doc")


@app.get("/api/documents/{document_name}")
def document(document_name: str):
    try:
        return get_document(BASE_DIR.parent / "doc", document_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文档不存在") from None


@app.exception_handler(ValueError)
def value_error_handler(_, exc):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


app.mount("/", StaticFiles(directory=str(BASE_DIR / "static"), html=True), name="static")
