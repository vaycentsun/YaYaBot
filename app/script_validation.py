import subprocess


def check_script(script_type, script):
    if not script.strip():
        return {"valid": False, "message": "脚本内容不能为空"}
    if script_type == "python":
        try:
            compile(script, "<script>", "exec")
            return {"valid": True, "message": "Python 语法检查通过"}
        except SyntaxError as exc:
            location = f"第 {exc.lineno or '?'} 行"
            if exc.offset:
                location += f"第 {exc.offset} 列"
            return {"valid": False, "message": f"Python 语法错误（{location}）：{exc.msg}"}

    try:
        result = subprocess.run(
            ["/bin/bash", "-n"],
            input=script,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"valid": False, "message": f"无法完成 Shell 语法检查：{exc}"}
    if result.returncode == 0:
        return {"valid": True, "message": "Shell 语法检查通过"}
    message = result.stderr.strip() or "未知 Shell 语法错误"
    return {"valid": False, "message": f"Shell 语法错误：{message}"}


def ensure_valid_script(script_type, script):
    result = check_script(script_type, script)
    if not result["valid"]:
        raise ValueError(result["message"])
