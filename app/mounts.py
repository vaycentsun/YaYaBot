import re
from pathlib import Path


MOUNTINFO_PATH = Path("/proc/self/mountinfo")
EXCLUDED_FILESYSTEMS = {
    "autofs",
    "bpf",
    "cgroup",
    "cgroup2",
    "configfs",
    "debugfs",
    "devpts",
    "devtmpfs",
    "fusectl",
    "hugetlbfs",
    "mqueue",
    "nsfs",
    "overlay",
    "proc",
    "pstore",
    "ramfs",
    "securityfs",
    "squashfs",
    "sysfs",
    "tmpfs",
    "tracefs",
}
EXCLUDED_PATHS = {
    "/",
    "/etc/hostname",
    "/etc/hosts",
    "/etc/resolv.conf",
}


def _unescape(value):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), value)


def read_mounts(path=MOUNTINFO_PATH):
    if not path.is_file():
        return {"supported": False, "mounts": []}

    mounts = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) < 10 or "-" not in fields:
            continue
        separator = fields.index("-")
        if separator < 6 or len(fields) <= separator + 2:
            continue
        root = _unescape(fields[3])
        container_path = _unescape(fields[4])
        options = fields[5].split(",")
        filesystem = fields[separator + 1]
        if container_path in EXCLUDED_PATHS or filesystem in EXCLUDED_FILESYSTEMS:
            continue
        mounts[container_path] = {
            "container_path": container_path,
            "source_path": root,
            "writable": "ro" not in options,
            "filesystem": filesystem,
        }

    return {
        "supported": True,
        "mounts": sorted(mounts.values(), key=lambda item: item["container_path"]),
    }
