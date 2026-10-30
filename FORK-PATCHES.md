# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `v1.4.028`（2026-10-30，`77b72613`）已 rebase；生产仍为 `v1.4.025` |
| 线上基线 | VPS10 生产 `v1.4.025-fp1`（2026-10-29 起；运行镜像源码 `8c194533`；补丁 3/4/9；迁移至 047）。VPS9 旧 `v1.4.011-fp2` 停止保留回滚 |
| 分支 | 本地 `fork-patches-v1.4.028-prep` 已基于 `v1.4.028` 完成 rebase；`origin/fork-patches=9f36f08b` 仍为生产留档分支。运行镜像固定在源码 `8c194533`，后续文档提交不改变已运行镜像 |
| 保护点 | 旧保护 `pre-rebase-13209-fp3`、`pre-rebase-13218-fc6a626b`、`pre-rebase-14010-96704234`、`pre-rebase-14025-8ef18c79`；升级闭环前临时保留 `../vm2api-v1.4.025-baseline` 与 `../vm2api-v1.4.028-baseline` |
| baseline 纪律 | 上游纯净对照 worktree 只用于测试归因。升级成功、验收与文档留档完成后，删除全部历史 `vm2api-v*-baseline`，只保留本次最新版本一个；失败未闭环前可临时保留新旧两个 |
| 镜像 | VPS10 运行 `vm2api:v1.4.025-fp1` = `sha256:17a3ca329d251b43714917a490eb58fde6b2ad67f8775b69364581e310c812b0`；上一版本机候选 `vm2api:v1.4.025-fp1-prep` = `sha256:a0616374b436a790d0ba9781cf4dac91c4082bd7f9869cda5f962f4bb4e27b90`。2026-10-30 本机候选 `vm2api:v1.4.028-fp1-prep` = `sha256:9cf67fb91aab1e7a2e157b949ebe07af22d0c82d845d41bda2aa8b24cf3150cd`（649,464,859 bytes） |
| 备份/回滚 | 生产迁移前 VPS9 备份 `bak_271bcbbc0f1d`（23,228,530 bytes，SHA256 `fb9fa123…90ad4`）；VPS10 空库快照 `/opt/vm2api-primary/data.empty-pre-restore.20261029T050345Z`。DB 已到 047，回滚必须先备份 VPS10 当前库，再恢复到升级后的 VPS9，不能只切旧镜像 |
| 已知上游缺陷 | #817 官方 first-use hello / usage 缺首方身份句的问题已由上游 `v1.4.028` 修复；不再 cherry-pick #816。部署后 vm-03/vm-04 各只允许重跑一次 force 初装 |

## v1.4.011→v1.4.025 变化

1. 区间新增 DB 迁移 043-047：`usage_logs` 流式时序与上游 service tier、JEV state、`jev_usage` 明细、`request_attempts` 调度排队时序。升级必须先做面板一致性备份；回滚旧控制面需同时恢复备份 DB，不能只切镜像。
2. payload 从 `payload-2026.10.26-cli-effort` 换为 `payload-2026.10.28-kernel-agent-id`：`kin-kernel=8a61aaa3…c16`、`kin-computer=a6497083…2bb`、`cli-node=49757637…4e1`；`kin-worker/kin-egress/kin-slot-gate/cc-node` 哈希不变。切换后仍需确认 wrap sync 与 fleet payload。
3. 协议与缓存：#797 系列 refines caller system/cache policy、agent summary 会话隔离、zero/official 模板补点；上游已原生覆盖 fork 补丁 11 的 shaped official_full user 断点修复。#812 新增 VM/node offline 通知。
4. 调度与可靠性：#795 复用调度快照并区分真实排队耗时，#804 修复准入完成后实时并发计数，#805 修复省略 `stream` 时按 Accept 返回 JSON，另有 Codex 计费/非流式/超时修复。ARM64 原生 CLI 变化不影响 VPS9 amd64 本机槽与 VPS10 远端 amd64 槽。
5. v1.4.005 起的部署顺序仍强制：构建/切换新控制面 → health 与 `restart=no` 迁移成功 → wrap/fleet payload 刷新 → 验收。不要先重启 Docker；不要覆盖 `routing.json`、`vms/`、`data/`、`.env`。

## v1.4.025→v1.4.028 变化

1. 无新增 DB migration，schema 继续停在 047；Node 依赖与 lockfile 不变。#817 在 hello 与 `/usage` 直连命令补官方 CLI 身份句，上游已覆盖 #816 的修复方向。
2. payload release 切到 `payload-2026.10.29-telemetry-kernel`：`kin-kernel` / `kin-kernel.bin` 为 `f57d4e71…4288`（13,228,472 bytes），`cli-node` 为 `8484c4c5…611b`（27,933,052 bytes）；`kin-worker`、`kin-egress`、`kin-slot-gate`、`kin-oauth-auth`、`kin-computer`、`cc-node` 哈希不变。切换后必须执行 wrap sync `restart:true` 并刷新本机与 VPS9 节点 fleet payload。
3. Linux VM telemetry 从 Go sidecar 迁入 native kernel / cli-node，删除自愈与回退；新槽默认关闭，只有 `seed_policy.telemetry_disabled === false` 显式开启。升级前确认四个槽与 `official_cc.sync_telemetry` 均保持关闭，且不得改变绑定出口。
4. JEV 内置决策题从六题收敛为三题，保存的未修改内置题会自动升级，面板自定义题保留；#820/#825 同时收窄维修/源码类误伤。该行为变化需在部署验收中覆盖补丁 9 防御语境样本。
5. 协议与调度修复：#818 过期 cache-prefix 快照即删，#814 保留 eager tool streaming，#819 保留数组 system，#807 不再读取无人写入的 `accounts.schedulable`，#672 面板显示订阅到期，#665 GPT 等待队列按账号定向唤醒。`upstream/main` 在 tag 后又合并 #815，但尚未 release，本次不追 main。

## Active patches

### 补丁 3：cli-hop 小 max_tokens 保底

- 保留显式小预算 1024 保底；显式 thinking 请求提升到 4096。
- v1.4.010 rebase 冲突位于 official_303/lean 出站组装区；已保留新出站结构，把两个保底插入 `prepareCliHopBody`。原生 cli-node 负责模型策略后，不再假设控制面自动填充 thinking。

### 补丁 4：cli-hop 输出上限与超长上下文错误语义

- 保留。输出上限恢复逻辑重放到 v1.4.010 新 `streamGoWorker`，并保留 outbound headers 内部诊断帧过滤、提交队列、thread beta 与 openBlocks 行为。
- Linux 专项通过，覆盖 Unix socket 流式行为。

### 补丁 9：硬正则否定/防御语境豁免

- 保留。上游仍无等价防御语境豁免；语义限定同一短句与近距离后缀。
- 专项通过，直接破限仍拦截。

### 候选补丁 10：OAuth 400 错误码透传与自动停调度（未实现）

- 动机：2026-10-23 vm-02 连续 10 条 400 `refresh_failed`，槽未被自动停调度，只能人工禁用并重新登录。
- 拟改文件：`worker/internal/oauthcmd/oauthcmd.go`（保留 `RefreshError.Code`）、`src/lib/transport/kernel-router.mjs` 或凭证调度分类（将 HTTP 400 + `refresh_failed` 视为 fatal）、对应 Go/Node 单测。
- 验收：`invalid_grant` / `invalid_refresh_token` / 空 code + HTTP 400 均自动 paused；429、5xx、网络超时仍 retryable；重新导入凭证后清除 `refresh_error` 并恢复调度。

### 上游已解决：官方初装 hello 429

- v1.4.023/v1.4.025 的 first-use 直连路径缺 `CRS_OFFICIAL_CLI_SYSTEM`，导致 hello 与 `/usage` 被上游 429 `rate_limit_error "Error"` 拒绝；v1.4.028 已在官方 bootstrap 命令补回。
- 部署成功并完成 payload 刷新后，仅对受影响的 vm-03/vm-04 各重跑一次 force 初装；通过标准为 `hello_ok=true`、`usage_ok=true`、`status=ok`，失败不得重复尝试。

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---|---:|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游稳定官方 system/messages 前缀与 lift 模型，覆盖原目标 |
| 11 official_full user 断点 | v1.4.025 | 上游 #797 的 shapedFallback 在缺少 messages marker 时按预算/TTL 补点；保留 fork 测试作回归 |

## 当前验证结论（v1.4.028 准备态，2026-10-30）

- rebase：61 个 fork 提交无冲突落到 `v1.4.028`；相对上游的源码差异仍只落在补丁 3/4/9 及对应测试、台账。#817 已由上游覆盖，不 cherry-pick #816。
- Linux Node 对照：在 `node:22-bookworm-slim` 中按 312 个 unit 文件逐文件执行、单文件 20s 超时，fork 与纯净 v1.4.028 均为 294 pass / 10 fail / 8 timeout，逐文件状态日志 SHA256 同为 `06cc5c8e…4ae83`。失败/超时集中在 openssl、IPv6、Docker/cgroup、SQLite/挂载与 `sticky-router` / `wrap-cli-runtime` 环境依赖，双侧一致，不构成 fork 回归。
- Go：worker `go vet ./...`、`go test ./...`、`go test -race ./...` 全部通过；api-kernel `go vet ./...` 与 `go test ./...` 通过。gofmt 无差异。
- Web：pnpm 10 下 Vitest 69 files / 529 tests、build、typecheck、Prettier 全部通过。Lint 在 fork 与纯净 028 均为 8 errors / 39 warnings 且逐项一致；上游 CI 不执行 lint，记录为上游既有非阻断项。
- Docker：`git archive` + buildx `--network host --load` 构建通过，候选 `vm2api:v1.4.028-fp1-prep` = `sha256:9cf67fb9…150cd`，`VERSION=1.4.028`。镜像内 `kin-kernel` / `kin-kernel.bin` = `f57d4e71…4288`，`cli-node` = `8484c4c5…611b`，其余关键 payload 哈希与 manifest 一致；补丁 3/4/9 专项测试在镜像本体中全部通过。
- `npm audit --omit=dev` 仍有上游 `socks -> ip-address` moderate；依赖与 025 相同，未额外改 lockfile。

## 下次升级标准门槛（VPS10 生产）

1. 默认选择 04:00–08:00 空窗，且最近 5 分钟业务请求为 0；用户明确要求立即部署时可跳过等待，但必须记录切换窗口在途请求结果。
2. rebase 后由用户审查并执行 `--force-with-lease` 推送；若只是在当前远端 HEAD 上追加热修提交，可普通 push。
3. 备份 `/opt/vm2api-primary/{data,vms,src/config}`、runtime env 与 Nginx release；创建面板一致性备份，确认 SHA256 与 `quick_check`。
4. 在独立 Docker buildx 中从纯净 `git archive <commit>` 构建下一版 `fp<N>` 镜像；必须带 `--network host`。不得改动既有 nerdctl 系统 containerd，确认成功前不得重启 Docker。
5. 更新 `vm2api-primary.service` 镜像 tag 后重启主控容器，先验收 health、启动日志与槽位 `restart=no` 语义；随后确认/触发 `wrap-cli/sync restart:true` 与 fleet payload 刷新，核对关键 payload 哈希。
6. 验收 health、四个槽位状态、schema 版本、公网 401/200、真实小请求和 15 分钟观察；`verify-fixes` 适配 VPS10 前不作为硬门槛，适配后恢复默认用例验收。
7. 升级成功并完成文档留档后，用 `git worktree remove` 清理历史 baseline，只保留本次最新版本；最后 `git worktree prune` 并复核 `git worktree list`。
8. 升级前确认 telemetry 全关、四个槽绑定出口不变；部署后 wrap/fleet 刷新成功，才允许按上游 #817 修复各重跑一次官方 force 初装。

## 2026-10-29 v1.4.025 准备与生产迁移结论

1. 已创建 `fork-patches-v1.4.025-prep` 并完成 rebase；有效源码补丁收敛为 3/4/9，补丁 11 源码随上游 #797 下线，仅保留测试。用户已按 lease 强推 `origin/fork-patches=8c194533`。
2. 本机候选镜像 `vm2api:v1.4.025-fp1-prep` = `sha256:a0616374…e27b90`；VPS10 生产镜像 `vm2api:v1.4.025-fp1` = `sha256:17a3ca32…c812b0`。
3. 生产 DB/槽位凭证已从 VPS9 迁移到 VPS10，schema 至 047；四槽真实请求与出口验证 PASS。VPS9 反向为单槽节点，旧主控停止保留回滚，DNS 指向 VPS10。

## 2026-10-30 v1.4.028 准备结论

1. 目标版本裁决为 release tag `v1.4.028`（`77b72613`），不追 post-tag `upstream/main` 的未发版 #815 修复。
2. 本地 prep 分支完成 rebase、全量对照验证与本机候选镜像构建；用户已授权本次由代理执行 `--force-with-lease` 推送。生产切换仍需等待低峰窗口和独立确认。
3. VPS10 只读预检通过：`vm2api-containerd` / `vm2api-docker` / `vm2api-primary` active，health 200，根分区可用 72G，独立 Docker 29.1.3 + buildx 0.38.1，生产镜像仍是 `v1.4.025-fp1`。

## 2026-10-27 部署结论

1. 用户明确要求立即部署，未等待空窗；切换前 5 分钟业务请求 95 条。`git reset --keep` 因 live routing/distill 与上游默认同文件演进被拒绝，已先快照 live 配置，再按“live 值 + 新默认值”合并，`.env/vms/data` 未覆盖。
2. 04:57:33 UTC 先切 `v1.4.011-fp1`：health OK、迁移 042、两槽 `restart=no`，自动 wrap sync `2/2 failed=0`，fleet telemetry/egress `2/2`。窗口出现 1 条内置探测 503、2 条 529、1 条 200 后中断与 1 条 502，随后同槽恢复 200。
3. 上游 v1.4.010 shaped official_full 逻辑跳过 user 断点，K2 cache_read=0 且纯净 v1.4.011 同样失败；补丁 11 提交 `67a81360` 后，05:13:22 UTC 切 `vm2api:v1.4.011-fp2`。本版 payload 不变，不重启槽容器。
4. 验收：health OK；迁移最高 042；vm-01/vm-02 running/schedulable、rust kernel healthy/reachable、ready_slots 19/20、cli_restarts 0；verify-fixes A/C/D1/D2/K1/K2/S 全 PASS，K1 写 10,121、K2 读 10,121；公网无 key 401、带 key 200 且 24 模型。
5. 05:13:22–05:28:30 UTC 观察 15 分钟：158 条 200、3 条 429（2 条为本地 key 并发限制、1 条关联调用方重试），无 5xx；health probe 200；无 OOM/fatal/panic/kernel restart。`HPE_INVALID_EOF_STATE` 为客户端提前断开/重试。
