import re
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger


WEEKDAYS = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")


def _numeric_weekdays(part):
    base, separator, step_text = part.partition("/")
    step = int(step_text) if separator else 1
    if step < 1:
        raise ValueError("星期字段的步长必须大于 0")

    if base == "*":
        values = range(0, 7, step)
    elif re.fullmatch(r"\d+", base):
        start = int(base)
        if start < 0 or start > 7:
            raise ValueError("星期数字必须在 0-7 之间")
        start = 0 if start == 7 else start
        values = range(start, 7, step) if separator else (start,)
    elif re.fullmatch(r"\d+-\d+", base):
        start_text, end_text = base.split("-")
        start, end = int(start_text), int(end_text)
        if start < 0 or end > 7 or start > end:
            raise ValueError("星期数字范围无效")
        values = (value % 7 for value in range(start, end + 1, step))
    else:
        return None

    return ",".join(WEEKDAYS[value] for value in values)


def to_apscheduler_cron(expression):
    fields = expression.split()
    if len(fields) != 5:
        raise ValueError("Cron 表达式必须包含 5 个字段")

    weekday_parts = []
    for part in fields[4].split(","):
        converted = _numeric_weekdays(part)
        weekday_parts.append(converted if converted is not None else part.lower())
    fields[4] = ",".join(weekday_parts)
    return " ".join(fields)


def validate_schedule(expression, timezone):
    try:
        ZoneInfo(timezone)
    except Exception as exc:
        raise ValueError("无效的 IANA 时区") from exc

    try:
        return CronTrigger.from_crontab(
            to_apscheduler_cron(expression), timezone=timezone
        )
    except Exception as exc:
        raise ValueError(f"无效的 Cron 表达式：{exc}") from exc
