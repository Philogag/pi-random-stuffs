# @philogag/pi-tool-presistant-bash

pi 扩展:为 agent 管理**长驻 bash 会话**。

pi 内置的 `bash` 工具每次调用都新建子进程,`cd` / `export` / venv 激活等状态无法跨命令保留。本扩展给 agent 一个显式的持久 shell 会话管理能力,状态在命令间保留。

## 安装

```bash
pi install npm:@philogag/pi-tool-presistant-bash
```

- 安装后扩展自动启用,无需额外配置;用 `pi config` 可启用 / 禁用。
- 项目级安装加 `-l`(`pi install -l npm:@philogag/pi-tool-presistant-bash`,写入 `.pi/settings.json`,可随仓库共享)。
- 卸载:`pi remove npm:@philogag/pi-tool-presistant-bash`。
- 快速体验:`pi -e npm:@philogag/pi-tool-presistant-bash`(仅本次运行,不写入配置)。

## 工具

| 工具 | 作用 |
| --- | --- |
| `presistant-bash-create` | 创建长驻 shell 会话,返回 session id |
| `presistant-bash-create-container` | 创建 docker/podman 容器会话(见下) |
| `presistant-bash-exec` | 在指定会话内执行命令 |
| `presistant-bash-list` | 列出活跃会话(id、label、command、cwd、创建时间、存活状态) |
| `presistant-bash-destroy` | 销毁会话;容器会话会顺带 `docker/podman rm -f` 删容器 |

会话仅**内存**维护:`session_shutdown`(pi 会话结束)时全部销毁;`resume` 不恢复——agent 按需重新创建。

## 用法(agent 视角)

```text
presistant-bash-create   command=["docker","exec","-it","web","bash"] label="web container"
→ Created persistent bash session 8f2a… Use presistant-bash-exec with sessionId "8f2a…"

presistant-bash-exec     sessionId="8f2a…" command="cd /app && ./run_tests.sh"
→ …output… [exit code: 0]

presistant-bash-list
→ - 8f2a… (web container) — docker exec -it web bash @ /home/you [alive]

presistant-bash-destroy  sessionId="8f2a…"
→ Destroyed session 8f2a…
```

### 容器会话:`presistant-bash-create-container`

```text
presistant-bash-create-container  image="node:22" args=["-v","/host:/ct","-p","3000:3000"] shell="bash"
→ Created container abc12345def6 (docker node:22) with persistent bash session 8f2a…
```

参数:

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `image` | 镜像(必填),如 `node:22` / `alpine` / `python:3.12` | — |
| `runtime` | `docker`(可用时默认)或 `podman` | 自动探测 |
| `args` | 额外 `docker run` 参数(卷、端口、env、网络…) | `[]` |
| `shell` | 容器内 shell(Alpine 用 `sh`) | `bash` |
| `keepAlive` | 容器保活命令 | `["tail","-f","/dev/null"]` |

销毁会话(或 pi 退出)时执行 `docker/podman rm -f` 清理容器。

内部已处理两个 docker 实战坑(均经真实 docker 验证):

1. `docker run -it <image> bash` 在 stdin 为管道(无 PTY)时会立即退出 → 改为后台 `docker run -d ... tail -f /dev/null` 让容器长驻。
2. `docker exec -it <container> bash` 在管道 stdin 下也需要 TTY → 改用 `docker exec -i`(去掉 `-t`)。

## 设计要点

- **启动什么由 agent 决定**:`command` 是任意 argv——本地 bash、`docker exec`、`ssh host bash`、`zsh`、`fish` 等。进程直接 spawn(`shell: false`),并写入 `exec 2>&1` 让 stdout/stderr 与结束标记走单一管道、顺序一致。
- **状态保留**:同一进程在 `exec` 调用间存活,`cd` / `export` / `PATH` / venv 激活全部保留。
- **结束检测**:stdout 回显带退出码的结束标记,输出归组与退出码跨 stdout/stderr 都可靠。
- **不跨 pi 会话持久化**:`session_shutdown` 全部 kill;`resume` 从空开始(设计如此)。用 `presistant-bash-list` 查看当前存活会话。

## 开发

```bash
pnpm install                 # 安装依赖(弱依赖来自宿主 pi,devDeps 供本地构建)
pnpm --filter @philogag/pi-tool-presistant-bash test        # 测试
pnpm --filter @philogag/pi-tool-presistant-bash typecheck
pnpm --filter @philogag/pi-tool-presistant-bash build       # 产出 dist/
```

### 依赖说明

运行时依赖(`@earendil-works/pi-coding-agent` / `typebox`)声明为 **peerDependencies(弱依赖)**:宿主 pi 环境已内置这些包,插件不重复打包;`devDependencies` 中保留同名依赖供本地 typecheck / test。
