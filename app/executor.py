import os
import signal
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor


OUTPUT_LIMIT = 200_000


def _limit_output(value):
    if len(value) <= OUTPUT_LIMIT:
        return value
    return value[:OUTPUT_LIMIT] + "\n\n[输出过长，已截断]"


def _wake_on_lan(task):
    mac_bytes = bytes.fromhex(task["mac"].replace(":", ""))
    packet = b"\xff" * 6 + mac_bytes * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, (task["broadcast"], task["port"]))
    return f"已发送 Wake-on-LAN 魔术包\n目标：{task['mac']}\n地址：{task['broadcast']}:{task['port']}"


class Executor:
    def __init__(self, database, workspace, max_workers=4):
        self.database = database
        self.workspace = workspace
        self.pool = ThreadPoolExecutor(max_workers=max_workers)

    def submit(self, task_id, trigger_kind="manual"):
        task = self.database.get_task(task_id)
        if task is None:
            return None
        if trigger_kind == "scheduled" and not task["enabled"]:
            return None
        run = self.database.create_run(task, trigger_kind)
        self.pool.submit(self._execute, run["id"], task_id)
        return run

    def _execute(self, run_id, task_id):
        self.database.start_run(run_id)
        task = self.database.get_task(task_id)
        if task is None:
            self.database.finish_run(run_id, "failed", "任务已被删除")
            return

        try:
            if task["type"] == "wol":
                output = _wake_on_lan(task)
                self.database.finish_run(run_id, "success", output, 0)
                return

            if task["type"] == "shell":
                command = ["/bin/bash", "-euo", "pipefail", "-c", task["script"]]
            else:
                command = [sys.executable, "-c", task["script"]]

            environment = os.environ.copy()
            environment.update(
                {
                    "TASK_ID": task_id,
                    "RUN_ID": run_id,
                    "TASK_NAME": task["name"],
                    "TZ": task["timezone"],
                }
            )
            process = subprocess.Popen(
                command,
                cwd=self.workspace,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                start_new_session=True,
            )
            try:
                stdout, stderr = process.communicate(timeout=task["timeout"])
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    stdout, stderr = process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    stdout, stderr = process.communicate()
                output = self._format_output(stdout, stderr)
                output += f"\n执行超过 {task['timeout']} 秒，已终止。"
                self.database.finish_run(
                    run_id, "timeout", _limit_output(output.strip()), process.returncode
                )
                return

            output = self._format_output(stdout, stderr)
            status = "success" if process.returncode == 0 else "failed"
            self.database.finish_run(
                run_id, status, _limit_output(output.strip()), process.returncode
            )
        except Exception as exc:
            self.database.finish_run(
                run_id, "failed", _limit_output(f"执行异常：{exc}")
            )

    @staticmethod
    def _format_output(stdout, stderr):
        sections = []
        if stdout:
            sections.append(f"[标准输出]\n{stdout.rstrip()}")
        if stderr:
            sections.append(f"[错误输出]\n{stderr.rstrip()}")
        return "\n\n".join(sections)

    def shutdown(self):
        self.pool.shutdown(wait=False, cancel_futures=True)
