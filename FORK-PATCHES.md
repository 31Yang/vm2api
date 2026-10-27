# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `v1.4.011`（2026-10-27，`3ca3e01c`；上游 `main` 已强制重写，fetch 时大量旧 tag rejected 属预期） |
| 线上基线 | `v1.4.011-fp2`（2026-10-27 05:13:22 UTC 起；运行源码 `67a81360`；补丁 3/4/9/11；迁移至 042） |
| 分支 | `fork-patches-v1.4.011-prep` = `origin/fork-patches` = `67a81360`，保留补丁 3/4/9/11 |
| 保护点 | 旧保护 `pre-rebase-13209-fp3`、`pre-rebase-13218-fc6a626b`、`pre-rebase-14010-96704234`；v1.4.011 纯净 worktree `../vm2api-v1.4.010-baseline`，升级未闭环前暂保留 v1.3.218 baseline |
| baseline 纪律 | 上游纯净对照 worktree 只用于测试归因。升级成功、验收与文档留档完成后，删除全部历史 `vm2api-v*-baseline`，只保留本次最新版本一个；失败未闭环前可临时保留新旧两个 |
| 镜像 | VPS 运行 `vm2api:v1.4.011-fp2` = `sha256:336c10f31ab54352b220515211e19c5b392fd63dc5372f273a61552c1785df3c`（856,247,163 bytes）；本机对照 `vm2api:v1.4.011-fp2-prep` = `sha256:730d0c08b97d41f66e0eed4ba6ec207d8c7196e08e50ec54fb571769b53f03f2` |
| 备份/回滚 | 本次面板备份 `bak_f411434ec4e7`（18,947,509 bytes，SHA256 `33e2a8dc…e05796`）；保护目录 `/home/ayang/pre13218-to-14010prep.20261027T022547Z/`；快速回滚镜像 `vm2api:v1.3.218-fp1-rollback-14010fp1` + `git reset --keep 7013c520`，无 DB 结构变化 |

## v1.3.218→v1.4.011 变化

1. 区间共 214 个提交：新增 official_303 / 2.1.303 出站参照、模型缺省 effort、调度状态与 session seat、历史 5H/7D 窗口、面板 VM 池与统计重做、OAuth 身份头保留、KVM MAC/disk serial 回填等；无新增 DB 迁移（仍止于 042）。
2. payload 从 `payload-2026.10.22-computer-linux` 换为 `payload-2026.10.26-cli-effort`：`kin-worker=d6b29f11…71b`、`kin-egress=0bf1eeb0…277`、`kin-slot-gate=78f78d59…859`、`cli-node=f29bbfa4…b68`；Go helper 不再由 Dockerfile 源码编译，改按 manifest 下载。
3. v1.4.005 起本机槽容器改为 `restart=no` 并由控制面先恢复出口再拉起；`src/server.mjs` 启动早期执行 `syncLocalSlotRestartPolicies`，迁移失败会阻止控制面启动。
4. v1.4.007 起 `cli-node` 必须同步到槽内；v1.4.009 起升级路径改为经新控制面执行 `wrap-cli/sync restart:true` 与 fleet telemetry。镜像 entrypoint 在 payload 变化且 `KIN_AUTO_SYNC_WRAP=1` 时会后台执行 `sync-wrap-cli.mjs`。
5. 部署顺序必须是：构建/切换新控制面 → 确认 health 与 `restart=no` 迁移成功 → 触发/确认 wrap sync 与 fleet payload 刷新 → 验收。不要先重启 Docker；不要覆盖 `routing.json`、`vms/`、`data/`、`.env`。
6. v1.4.011 仅追加 #761：KVM 槽恢复时回填 MAC / disk serial，env 不完整的旧容器强制重建；无迁移、无 payload/依赖变化，不影响本机 Docker 槽。

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

### 补丁 11：official_full 模板保留 user 缓存断点

- 动机：v1.4.010 起 shaped official_full system 含 `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`，上游因此同时跳过 system 重建与 user 断点；第三方多轮请求只剩 system 断点，K2 cache_read 为 0，纯净 v1.4.011 的 `cache-breakpoints` 也失败。
- 改动文件：`src/lib/protocol/outbound-attempt.mjs` 与 `test/unit/cli-hop-body.test.mjs`。
- 行为：保留 shaped system 原文；除 official_303 lean 与 prepared-zero 外，仍调用 `officialMessageMarker` 给最后两条 user 补 1h 断点。
- 本地验收：新增 shaped official_full 用例通过；补丁 3/4/9 专项仍仅剩纯净同版一致的 `go-worker-client` beta 断言失败；official_303 / cache-breakpoints 失败集合与纯净 v1.4.011 一致。线上 K1/K2 已恢复 PASS，K2 读取 10,121 tokens。

### 候选补丁 10：OAuth 400 错误码透传与自动停调度（未实现）

- 动机：2026-10-23 vm-02 连续 10 条 400 `refresh_failed`，槽未被自动停调度，只能人工禁用并重新登录。
- 拟改文件：`worker/internal/oauthcmd/oauthcmd.go`（保留 `RefreshError.Code`）、`src/lib/transport/kernel-router.mjs` 或凭证调度分类（将 HTTP 400 + `refresh_failed` 视为 fatal）、对应 Go/Node 单测。
- 验收：`invalid_grant` / `invalid_refresh_token` / 空 code + HTTP 400 均自动 paused；429、5xx、网络超时仍 retryable；重新导入凭证后清除 `refresh_error` 并恢复调度。

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---|---:|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游稳定官方 system/messages 前缀与 lift 模型，覆盖原目标 |

## v1.4.011 准备验证

- VPS 只读预检（2026-10-27 10:14 SGT）：`/opt/vm2api` 在 `fork-patches@7013c520`，运行镜像 `vm2api:v1.3.218-fp1`，health `status=ok`，双槽与 `anytls-socks` 运行中；git 3 项 live 差异、根分区可用 9.5G。未执行 fetch/build/backup/restart。
- VPS 预置（2026-10-27 10:31 SGT，未部署）：`origin/fork-patches` 已 fetch 到 `e771682d`；保护目录 `/home/ayang/pre13218-to-14010prep.20261027T022547Z/`（0700）保存 `.env`、compose、live config、构建日志与状态。面板备份 `bak_f411434ec4e7`，18,947,509 bytes，SHA256 `33e2a8dc…e05796` 已复核。当前镜像另打 `vm2api:v1.3.218-fp1-rollback-14010fp1`。VPS 从纯净 archive 构建 `vm2api:v1.4.010-fp1-prep` = `sha256:d28f2bb0…5be0`（856,241,596 bytes），`VERSION=1.4.010` 且 6 个关键 payload 哈希与 manifest 一致。运行容器、HEAD 与 3 项 live 差异保持不变；根分区剩余 7.4G。
- 补丁专项：fork 相关 4 个测试文件 `125 tests / 87 pass / 37 skip / 1 fail`；唯一失败为纯净 v1.4.010 同样失败的 `go-worker-client` beta 断言，属上游 tip 既有 Windows 口径。补丁 3/4/9 对应用例全部通过。
- v1.4.011 增量专项：补丁 3/4/9 与新增 `kvm-machine`、`remote-slot-restart-loop` 共 `140 tests / 102 pass / 37 skip / 1 fail`；唯一失败仍是纯净同版一致的 `go-worker-client` beta 断言。Go race 与 gofmt 通过，本地候选镜像 `VERSION=1.4.011` 且 payload 哈希一致。
- Windows 全量：fork 与纯净 v1.4.011 均为 `59/292` 个失败文件，逐文件集合一致；口径为上游 beta/persona 断言、Windows SQLite `EBUSY` 清理锁、路径/权限/Unix Docker 依赖等平台问题。
- Go race 在 `golang:1.25-bookworm` 容器全部通过；Biome 通过；`/usr/local/go/bin/gofmt -l worker` 无输出。
- Linux 镜像内全量：fork fp2 与纯净 v1.4.011 均为 `37/292` 个失败文件，集合一致；其中 `wrap-cli-runtime.test.mjs` 在本机容器缺运行时依赖且长期挂起，双侧同卡同判，最终人工终止后计入失败。
- Docker Web build 通过。fork 与纯净在干净 web stage 容器中 Vitest 均为 `68 files / 523 tests，7 failed`，失败集合均为 `src/lib/persona-template.test.ts`，属上游 v1.4.010 tip 既有断言失败。
- 候选/运行镜像 `VERSION=1.4.011`；`kin-kernel=8f1347cc…`、`kin-computer=a6497083…`、`kin-worker=d6b29f11…`、`kin-egress=0bf1eeb0…`、`kin-slot-gate=78f78d59…`、`cli-node=f29bbfa4…`、`cc-node=be5eec49…` 均与 manifest 一致。
- `npm audit --omit=dev` 仍有上游 `socks-proxy-agent -> socks -> ip-address@10.7.3` moderate，未额外改依赖。

## 下次升级标准门槛

1. 默认选择 04:00–08:00 空窗，且最近 5 分钟业务请求为 0；用户明确要求立即部署时可跳过等待，但必须记录切换窗口在途请求结果。
2. rebase 后由用户审查并执行 `--force-with-lease` 推送；若只是在当前远端 HEAD 上追加热修提交，可普通 push。
3. 保留/备份 live routing、distill rules、`.env` 与 rollback compose；创建面板一致性备份。
4. VPS `git fetch origin` 后用 `git reset --keep origin/fork-patches`，不得覆盖 live 配置；从纯净 `git archive origin/fork-patches` 构建下一版 `fp<N>` 镜像，VPS 构建不使用 Windows 侧代理参数。
5. 切换 `up -d --no-build` 后先验收控制面 health、启动日志与 `restart=no` 迁移；确认成功前不得重启 Docker。随后确认/触发 `wrap-cli/sync restart:true` 与 fleet payload 刷新，核对 `cli-node/kin-worker/kin-egress/kin-slot-gate` 哈希。
6. 验收 health、双槽状态、迁移仍至 042、verify-fixes 默认用例、公网 401/200、真实小请求和 15 分钟观察。
7. 升级成功并完成文档留档后，用 `git worktree remove` 清理历史 baseline，只保留本次最新版本；最后 `git worktree prune` 并复核 `git worktree list`。

## 2026-10-27 部署结论

1. 用户明确要求立即部署，未等待空窗；切换前 5 分钟业务请求 95 条。`git reset --keep` 因 live routing/distill 与上游默认同文件演进被拒绝，已先快照 live 配置，再按“live 值 + 新默认值”合并，`.env/vms/data` 未覆盖。
2. 04:57:33 UTC 先切 `v1.4.011-fp1`：health OK、迁移 042、两槽 `restart=no`，自动 wrap sync `2/2 failed=0`，fleet telemetry/egress `2/2`。窗口出现 1 条内置探测 503、2 条 529、1 条 200 后中断与 1 条 502，随后同槽恢复 200。
3. 上游 v1.4.010 shaped official_full 逻辑跳过 user 断点，K2 cache_read=0 且纯净 v1.4.011 同样失败；补丁 11 提交 `67a81360` 后，05:13:22 UTC 切 `vm2api:v1.4.011-fp2`。本版 payload 不变，不重启槽容器。
4. 验收：health OK；迁移最高 042；vm-01/vm-02 running/schedulable、rust kernel healthy/reachable、ready_slots 19/20、cli_restarts 0；verify-fixes A/C/D1/D2/K1/K2/S 全 PASS，K1 写 10,121、K2 读 10,121；公网无 key 401、带 key 200 且 24 模型。
5. 05:13:22–05:28:30 UTC 观察 15 分钟：158 条 200、3 条 429（2 条为本地 key 并发限制、1 条关联调用方重试），无 5xx；health probe 200；无 OOM/fatal/panic/kernel restart。`HPE_INVALID_EOF_STATE` 为客户端提前断开/重试。

## 2026-10-23 部署结论

1. 用户明确要求立即部署，未等待业务空窗；切换窗口既有业务请求均 200，无 5xx。
2. 01:33:45 UTC 切换 `vm2api:v1.3.218-fp1`；槽容器未重启，无迁移/wrap sync/payload 变化。启动后自动移除废弃 `codex.official_passthrough` 键，routing SHA256 `4197add1…c06d`，distill 保持 `97a1b693…e2b0`。
3. health OK，迁移最高 042；vm-01/vm-02 native kernel healthy，ready_slots 20/19，credential fresh。
4. verify-fixes A/C/D1/D2/K1/K2/S 全 PASS；K1/K2 出站均为 system 2 点 + user 2 点，共 4 个 1h 断点。
5. 公网 models 无 key 401、带 key 200 且 23 个模型。控制面启动期仅 bridge-heal 重建两个 egress helper，无 kernel restart/OOM。
6. 01:33:45–01:48:45 UTC 观察 15 分钟无 OOM/fatal/panic/kernel restart/5xx；97 条 200、46 条 429（37 条为 `ysg` key 并发 4 本地限流），`HPE_INVALID_EOF_STATE` 为客户端提前断开/重试。清理 4.453GB build cache 后根分区可用 8.7G。
