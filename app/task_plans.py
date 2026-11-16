import re


def build_cron(
    frequency,
    time="09:00",
    minute=0,
    interval_minutes=10,
    weekdays=None,
    month_day=1,
):
    if frequency == "minutes":
        if not isinstance(interval_minutes, int) or not 1 <= interval_minutes <= 59:
            raise ValueError("interval_minutes 必须在 1-59 之间")
        return "* * * * *" if interval_minutes == 1 else f"*/{interval_minutes} * * * *"

    if frequency == "hourly":
        if not isinstance(minute, int) or not 0 <= minute <= 59:
            raise ValueError("minute 必须在 0-59 之间")
        return f"{minute} * * * *"

    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", time):
        raise ValueError("time 必须使用 24 小时 HH:MM 格式")
    hour, minute_value = (int(value) for value in time.split(":"))

    if frequency == "daily":
        return f"{minute_value} {hour} * * *"
    if frequency == "monthly":
        if not isinstance(month_day, int) or not 1 <= month_day <= 31:
            raise ValueError("month_day 必须在 1-31 之间")
        return f"{minute_value} {hour} {month_day} * *"
    if frequency == "weekly":
        if not weekdays:
            raise ValueError("每周任务至少需要一个 weekdays 数字")
        normalized = set(weekdays)
        if any(not isinstance(day, int) or not 0 <= day <= 7 for day in normalized):
            raise ValueError("weekdays 仅支持 0-7，0 和 7 表示星期日")
        days = sorted({0 if day == 7 else day for day in normalized})
        return f"{minute_value} {hour} * * {','.join(str(day) for day in days)}"
    raise ValueError("frequency 仅支持 minutes、hourly、daily、weekly、monthly")
