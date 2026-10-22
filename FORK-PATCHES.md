# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `v1.3.217`（2026-10-23，tag 指向 `70011089`）。凌晨发现 v1.3.214-217，已按门槛追新验证 |
| 线上基线 | `v1.3.217-fp1`（2026-10-23 04:28 SGT 部署，运行时提交 `624dae97`；补丁 3/4/9） |
| 分支 | 运行时源码为 `624dae97`，由 v1.3.213 准备提交按 lease 强推；部署记录提交叠在其后并已同步远端 |
| 保护点 | `pre-rebase-13209-fp3` = 原 `fork-patches`（`f90d4b25`）；纯净 worktree `../vm2api-v1.3.217-baseline` |
| 镜像 | 本机候选 `vm2api:v1.3.217-fp1-prep` = `sha256:06f39578315a3bfe13413b7ffb51d000a667c4e14b3a290b65f4a5605f28f9ad`；VPS 运行镜像 `vm2api:v1.3.217-fp1` = `sha256:55b3c9f0818c46ad8b53af366119b465f054c206c84703d192824d221eda688c`（854,708,606 bytes） |
| 备份/回滚 | 面板备份 `bak_3f91e0fc00d4`，SHA256 `f35435ddf524480544427848a533ba1cd1091ae8a7b3977126f4bff854ffcb6e`；保护目录 `/home/ayang/pre13199-to-13217fp1.20261022T2019Z/`；旧镜像 tag `vm2api:v1.3.199-fp3-rollback-13217fp1` |

## v1.3.199→217 升级要点

1. 数据库迁移 `039_cluster_node_direct_links`、`040_cluster_node_platform`、`041_usage_logs_inbound_device`、`042_usage_logs_image_generation` 均已落库；042 只给 `usage_logs` 加 image 字段。迁移后回滚必须连备份恢复，不能只退镜像。
2. v1.3.214 修复 OpenAI Responses 首个真实输出前的 failover commit；v1.3.215/216 收窄 usage 与租户槽位权限；v1.3.217 新增 GPT Images 与迁移 042。本实例未改 live 路由，official passthrough 关闭，且当前无 Codex/GPT 槽，Images 请求不可调度。
3. payload 与 v1.3.213 一致：`kin-kernel=8f1347cc…`、`kin-computer=a6497083…`、`kin-worker=26b1acf8…`、`cli-node=b5054cb8…`；控制面镜像与两个槽内哈希一致，wrap sync `2/2 failed=0`。
4. 官方 Claude/Codex passthrough 默认关闭；本实例不用扩展集群节点，不启用 direct-link。

## Active patches

### 补丁 3：cli-hop 小 max_tokens 保底

- 普通小预算保底 1024；显式 thinking 请求提升到 4096。v1.3.213 起普通请求不自动填 thinking，线上验证脚本 C 已改为 1024 口径。
- 纯净/fork 专项均通过；线上 A/C 均 PASS。

### 补丁 4：cli-hop 输出上限与超长上下文错误语义

- 保留。超长上下文识别在上游 `stream-error-status.mjs`；输出上限恢复逻辑合入 v1.3.217 `streamGoWorker`，保留 envelope 日志、thread beta 与 openBlocks 行为。
- Linux/线上 D1、D2 均 PASS。

### 补丁 9：硬正则否定/防御语境豁免

- 保留。上游 v1.3.217 仍无等价防御语境豁免；语义限定同一短句与近距离后缀。
- 专项通过，直接破限样本仍按上游拦截。

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---|---:|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游稳定官方 system/messages 前缀与 lift 模型，覆盖原目标 |

## 验证结论

- 专项：纯净 v1.3.217 `43/43`；fork `125 tests / 90 pass / 35 skip / 0 fail`。
- Windows 全量：fork 与纯净 v1.3.217 均为 `35/283` 个失败文件，失败文件集合逐项一致，均为既有平台口径。
- Go race 在 VPS `golang:1.25` 容器全部通过；Web build 通过；Web Vitest `63 files / 489 tests` 全部通过。
- 本机与 VPS 镜像 `VERSION=1.3.217`，四个 payload/worker 哈希均与 manifest/准备记录一致。
- `npm audit --omit=dev` 仍受上游 `socks-proxy-agent -> socks -> ip-address@10.5.0` moderate 影响，本次不额外改依赖。

## 2026-10-23 部署结论

1. 04:00 前后 5 分钟排除健康/面板探针后业务请求为 0，根分区可用空间大于 5GB；三容器最近 10 分钟无持续 OOM/kernel restart。
2. 备份、live routing/distill/.env/vms 副本、rollback tag 与 rollback compose 均完成；三向合并后配置哈希保持 `b87c7175…` / `97a1b693…`。
3. 迁移 039/040/041/042 落库，health OK，双槽 running/schedulable，native kernel 诊断 OK 且无冷却。
4. verify-fixes 默认 A/C/D1/D2/K1/K2/S 全 PASS（B 显式跳过）。公网无 key 401、带 key 200 且返回 23 个模型。
5. 启动 wrap sync 瞬态出现 1 条 `kin-console-test` 内置流式探测 `kernel_unavailable: native cli stdout closed`，发生在槽内核重启窗口；后续真实验证请求无该错误、无 5xx。
6. 20:28:30–20:43:58 UTC 观察 15 分钟：三容器无 OOM/fatal/panic/kernel restart，20:38 后无新增请求，双槽诊断 OK，根分区可用 6.8G。备份 DB 解包复核 `quick_check=ok`，备份内最高迁移 038。
