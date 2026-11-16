import ipaddress
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .schedules import validate_schedule
from .script_validation import ensure_valid_script


class ScriptCheckInput(BaseModel):
    type: Literal["shell", "python"]
    script: str = Field(max_length=200_000)


class TaskInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: Literal["shell", "python", "wol"]
    script: str = Field(default="", max_length=200_000)
    cron: str = Field(min_length=9, max_length=100)
    timezone: str = Field(default="Asia/Shanghai", max_length=64)
    enabled: bool = True
    timeout: int = Field(default=300, ge=1, le=86_400)
    mac: str = ""
    broadcast: str = "255.255.255.255"
    port: int = Field(default=9, ge=1, le=65_535)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("任务名称不能为空")
        return value

    @field_validator("cron")
    @classmethod
    def clean_cron(cls, value):
        return " ".join(value.split())

    @model_validator(mode="after")
    def validate_task(self):
        validate_schedule(self.cron, self.timezone)
        if self.type in ("shell", "python"):
            ensure_valid_script(self.type, self.script)
            self.mac = ""
        else:
            mac = self.mac.strip().replace("-", ":").lower()
            if not re.fullmatch(r"[0-9a-f]{2}(:[0-9a-f]{2}){5}", mac):
                raise ValueError("MAC 地址格式无效")
            self.mac = mac
            self.script = ""
            try:
                ipaddress.IPv4Address(self.broadcast)
            except ipaddress.AddressValueError as exc:
                raise ValueError("广播地址必须是有效的 IPv4 地址") from exc
        return self
