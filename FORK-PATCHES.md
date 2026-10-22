# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `v1.3.213`（2026-10-22，`2afeb3dd`）。v1.3.211 已修复 v1.3.209 的 TTL 测试断言错误 |
| 线上基线 | `v1.3.199-fp3`（运行时提交 `8780ee14`；补丁 3/4/8/9） |
| 本地准备分支 | `fork-patches-v1.3.213-prep`：已 rebase 到 v1.3.213，仅保留补丁 3/4/9；补丁 8 由上游覆盖下线。用户已授权强推与 2026-10-23 04:00 低峰部署 |
| 保护点 | `pre-rebase-13209-fp3` = 原 `fork-patches`（`f90d4b25`）；v1.3.213 纯净 worktree `../vm2api-v1.3.213-baseline` |
| 本地候选镜像 | `vm2api:v1.3.213-fp1-prep` = `sha256:65288c63448f4cbb70b21c2c3f670c1f23d859be26cf463f5a93ff04930b0123`（647,191,809 bytes）。纯净镜像 = `sha256:85b116bc693ae6e92f9241b75785572e92c2918bfac63a1971f70803471b1ebe`。均仅在本机 Docker |

## v1.3.199→213 升级要点

1. 数据库迁移仍是 `039_cluster_node_direct_links`、`040_cluster_node_platform`、`041_usage_logs_inbound_device`。迁移后回滚必须连备份恢复，不能只退镜像。
2. v1.3.200 更新 `kin-kernel` / `cli-node` 到 `payload-2026.10.19-kernel-cli`；部署后必须确认自动 wrap sync 2/2 并核对两个槽内 payload。
3. v1.3.210 只把 `kin-computer` 更新到 `a6497083…`，payload release 为 `payload-2026.10.22-computer-linux`；不必重建已有槽，已有身份不重算。
4. v1.3.209 更新 `bin/kin-worker`；遥测上传间隔默认可配为 10 分钟，旧 worker 换新或重写 `worker.json` 后生效。
5. v1.3.212/213 新增官方 Claude/Codex passthrough，默认关闭。本次部署保持默认关闭，不在部署窗口开启新行为。
6. 本实例不用扩展集群节点；不启用 `kin-slot-gate` direct-link。
7. 旧 git 历史会导致批量 fetch tags 报 clobber；只 fetch 新 tag，不强改旧 tag。

## Active patches

### 补丁 3：cli-hop 小 max_tokens 保底

- 保留显式小预算 1024 保底；thinking 请求提升到 4096。v1.3.213 普通请求不自动填 thinking，测试已按新语义更新。
- 纯净与 fork 专项均通过。

### 补丁 4：cli-hop 输出上限与超长上下文错误语义

- 保留。超长上下文识别在上游 `stream-error-status.mjs`；输出上限恢复逻辑合入 v1.3.213 `streamGoWorker`，保留 envelope 日志、thread beta 与 openBlocks 行为。
- Linux 专项通过，覆盖 Unix socket 流式行为。

### 补丁 9：硬正则否定/防御语境豁免

- 保留。上游 v1.3.213 改进 JEV 来源标签，但没有等价“不能/禁止绕过”防御语境豁免。
- 语义仍限定同一短句与近距离后缀；直接破限仍拦截，专项通过。

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---|---:|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游 v1.3.203-209 稳定官方 system/messages 前缀与 lift 模型，覆盖原目标 |

## 验证结论

- 专项：纯净 v1.3.213 `126 tests / 96 pass / 30 skip / 0 fail`；fork `140 tests / 105 pass / 35 skip / 0 fail`。
- Windows 全量：fork 与纯净 v1.3.213 均为 35/273 个失败文件，集合逐项一致；v1.3.209 的 TTL 失败已消失，无 fork 回归。
- Linux 镜像内全量：fork 与纯净均为 10/273 个失败文件，集合逐项一致；主要是本机镜像无 Docker daemon/外网与 `wrap-cli-runtime` 超时口径，无 fork 回归。
- Linux 补丁专项：`go-worker-client + min-max-tokens + jev-intercept` 93/93 通过。
- Go race 全部通过；gofmt 无输出；Web Prettier/build 通过；Web Vitest 61 files / 480 tests 全部通过。
- 候选镜像 `VERSION=1.3.213`，`kin-kernel=8f1347cc…`、`kin-computer=a6497083…`、`kin-worker=26b1acf8…`、`cli-node=b5054cb8…` 均与 manifest/构建一致。
- `npm audit --omit=dev` 仍有 1 个 moderate：`socks-proxy-agent -> socks -> ip-address@10.5.0`。上游未处理，本次不引入额外依赖补丁。

## 04:00 部署顺序

1. 只读确认 04:00 前后 5 分钟无业务请求、两个槽无长请求、VPS 磁盘/内存可用。
2. 面板一致性备份 + 另存 live routing / distill 配置 + 当前镜像 rollback tag。
3. 用户已授权强推：将 `fork-patches-v1.3.213-prep` 按 lease 强推到 `origin/fork-patches`。
4. VPS 只用 `git reset --keep origin/fork-patches`，保留 live config。
5. 用纯净 `git archive origin/fork-patches` 构建候选镜像；构建产物 hash 必须与本机 `sha256:65288c…` 内容口径一致（同 commit + payload）。
6. 切 override image 并 `up -d --no-build`；确认迁移 039/040/041、wrap sync 2/2、两个槽 payload 与 health。
7. 跑 verify-fixes 默认用例 + 公网 401/带 key models + 真实小请求；观察 `kernel_unavailable` / OOM / 5xx。
8. 回写部署文档。若任何硬门槛失败，停止并按备份回滚，不做试探性重试。
