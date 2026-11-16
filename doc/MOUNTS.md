# 宿主机目录挂载指南

想让任务整理宿主机里的文件，可以先把目录挂载进容器。首页的“挂载目录”会列出已经可用的路径，脚本里填写对应的**容器路径**就能使用。

## 页面信息怎么看

| 信息 | 含义 |
| --- | --- |
| 容器路径 | 脚本实际使用的路径，例如 `/mnt/shared` |
| 挂载来源路径 | 内核挂载信息中的来源根路径，用来辅助辨认目录 |
| 可读写 / 只读 | 任务能否修改这个目录里的文件 |
| 文件系统 | 挂载来源使用的文件系统类型 |

默认的 `/data` 用来保存 YaYa bot 的任务、日志和工作文件，不要随意删除其中的数据库。

在 macOS 和 Windows 上，Docker Desktop 运行在虚拟机中，因此“挂载来源路径”可能是虚拟机内部标识，不一定与访达或资源管理器里看到的宿主机路径完全相同。编写任务时始终以“容器路径”为准。

## 添加一个宿主机目录

编辑项目根目录的 `compose.yaml`，找到 `yaya` 服务的 `volumes`，在 `yaya-data:/data` 下面增加自己的映射：

```yaml
services:
  yaya:
    volumes:
      - yaya-data:/data
      - "/宿主机目录:/mnt/shared:rw"
```

冒号分为三部分：

```text
宿主机路径 : 容器路径 : 访问权限
```

`rw` 表示可读写，`ro` 表示只读。只是读取日志或备份文件时，建议使用 `ro`。

### Linux

```yaml
- "/srv/shared:/mnt/shared:rw"
- "/var/log:/mnt/host-logs:ro"
```

### macOS

```yaml
- "/Users/你的用户名/shared:/mnt/shared:rw"
- "/Users/你的用户名/Documents:/mnt/documents:ro"
```

如果 Docker Desktop 无法访问目录，请检查其资源或文件共享设置，允许共享对应位置。

### Windows

```yaml
- "C:/Users/你的用户名/shared:/mnt/shared:rw"
- "D:/logs:/mnt/host-logs:ro"
```

建议使用引号和正斜杠，减少 Compose 解析 Windows 路径时的问题。

修改后重新部署：

```bash
docker compose up -d
```

回到首页，“挂载目录”中应该能看到 `/mnt/shared` 等容器路径。

## 在任务里使用

Shell 示例：

```bash
ls -lah /mnt/shared
find /mnt/shared -type f -name "*.log"
```

Python 示例：

```python
from pathlib import Path

shared = Path("/mnt/shared")
for file in shared.iterdir():
    print(file.name, file.stat().st_size)
```

写入文件前，先确认页面显示“可读写”，并检查宿主机目录权限。YaYa bot 默认使用非 root 用户运行，宿主机目录必须允许容器用户访问。

## 常见问题

- **页面没有刚添加的目录**：检查 Compose 缩进和路径，确认重新执行了 `docker compose up -d`，再刷新页面。
- **脚本报 Permission denied**：目录虽然已挂载，但容器用户没有操作系统层面的读写权限，需要调整宿主机目录权限。
- **macOS / Windows 找不到来源路径**：这是 Docker Desktop 虚拟机路径差异，不影响使用容器路径。
- **页面显示只读**：把映射末尾改为 `rw` 并重新部署；如果只是查看文件，保持 `ro` 更安全。

## 安全提醒

只挂载任务真正需要的目录。不要因为方便就挂载宿主机根目录、系统目录或 Docker 的 `docker.sock`，否则脚本错误或被滥用时，影响范围会扩大到整台宿主机。删除、移动和覆盖文件前，建议先用手动运行和少量测试文件确认脚本行为。
