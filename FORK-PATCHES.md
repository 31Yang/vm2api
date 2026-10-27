# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `v1.4.010`（2026-10-27，`165b4991`；上游 `main` 已强制重写，fetch 时大量旧 tag rejected 属预期） |
| 线上基线 | `v1.3.218-fp1`（2026-10-23 01:33:45 UTC 起；运行源码 `7013c520`；补丁 3/4/9；迁移至 042） |
| 准备分支 | 本机 `fork-patches-v1.4.010-prep`（未推送、未部署）；`origin/fork-patches` 仍在 `fc6a626b`，保留补丁 3/4/9 |
| 保护点 | 旧保护 `pre-rebase-13209-fp3`、本次本机保护 `pre-rebase-13218-fc6a626b`；v1.4.010 纯净 worktree `../vm2api-v1.4.010-baseline`，升级未闭环前暂保留 v1.3.218 baseline |
| baseline 纪律 | 上游纯净对照 worktree 只用于测试归因。升级成功、验收与文档留档完成后，删除全部历史 `vm2api-v*-baseline`，只保留本次最新版本一个；失败未闭环前可临时保留新旧两个 |
| 镜像 | 本机候选 `vm2api:v1.4.010-fp1-prep` = `sha256:99556e47519d325de5ab610ebe1912b4f3f3b2492bcd83fefe6aa38676ab53e2`（648,087,796 bytes）；VPS 运行 `vm2api:v1.3.218-fp1` = `sha256:119df3deb26abfde75991fc0a2dfc31dbaababc0a8df42d4e069ed81532d02d5`（854,694,197 bytes）。v1.4.010 纯净镜像尚未在 VPS 构建 |
| 备份/回滚 | 面板备份 `bak_d36e06b608e8`（10,471,304 bytes，SHA256 `97efb6d2…8808`）；保护目录 `/home/ayang/pre13217-to-13218fp1.20261023T012705Z/`；旧镜像 tag `vm2api:v1.3.217-fp1-rollback-13218fp1` |

## v1.3.218→v1.4.010 变化

1. 区间共 212 个提交：新增 official_303 / 2.1.303 出站参照、模型缺省 effort、调度状态与 session seat、历史 5H/7D 窗口、面板 VM 池与统计重做、OAuth 身份头保留等；无新增 DB 迁移（仍止于 042）。
2. payload 从 `payload-2026.10.22-computer-linux` 换为 `payload-2026.10.26-cli-effort`：`kin-worker=d6b29f11…71b`、`kin-egress=0bf1eeb0…277`、`kin-slot-gate=78f78d59…859`、`cli-node=f29bbfa4…b68`；Go helper 不再由 Dockerfile 源码编译，改按 manifest 下载。
3. v1.4.005 起本机槽容器改为 `restart=no` 并由控制面先恢复出口再拉起；`src/server.mjs` 启动早期执行 `syncLocalSlotRestartPolicies`，迁移失败会阻止控制面启动。
4. v1.4.007 起 `cli-node` 必须同步到槽内；v1.4.009 起升级路径改为经新控制面执行 `wrap-cli/sync restart:true` 与 fleet telemetry。镜像 entrypoint 在 payload 变化且 `KIN_AUTO_SYNC_WRAP=1` 时会后台执行 `sync-wrap-cli.mjs`。
5. 部署顺序必须是：构建/切换新控制面 → 确认 health 与 `restart=no` 迁移成功 → 触发/确认 wrap sync 与 fleet payload 刷新 → 验收。不要先重启 Docker；不要覆盖 `routing.json`、`vms/`、`data/`、`.env`。

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

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---|---:|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游稳定官方 system/messages 前缀与 lift 模型，覆盖原目标 |

## v1.4.010 准备验证

- VPS 只读预检（2026-10-27 10:14 SGT）：`/opt/vm2api` 在 `fork-patches@7013c520`，运行镜像 `vm2api:v1.3.218-fp1`，health `status=ok`，双槽与 `anytls-socks` 运行中；git 3 项 live 差异、根分区可用 9.5G。未执行 fetch/build/backup/restart。
- 补丁专项：fork 相关 4 个测试文件 `125 tests / 87 pass / 37 skip / 1 fail`；唯一失败为纯净 v1.4.010 同样失败的 `go-worker-client` beta 断言，属上游 tip 既有 Windows 口径。补丁 3/4/9 对应用例全部通过。
- Windows 全量：fork 与纯净 v1.4.010 均为 `59/291` 个失败文件，逐文件集合一致；口径为上游 beta/persona 断言、Windows SQLite `EBUSY` 清理锁、路径/权限/Unix Docker 依赖等平台问题。
- Go race 在 `golang:1.25-bookworm` 容器全部通过；Biome 通过；`/usr/local/go/bin/gofmt -l worker` 无输出。
- Linux 镜像内全量：fork 与纯净均为 `37/291` 个失败文件，集合一致；其中 `wrap-cli-runtime.test.mjs` 在本机容器缺运行时依赖且长期挂起，双侧同卡同判，最终人工终止后计入失败。
- Docker Web build 通过。fork 与纯净在干净 web stage 容器中 Vitest 均为 `68 files / 523 tests，7 failed`，失败集合均为 `src/lib/persona-template.test.ts`，属上游 v1.4.010 tip 既有断言失败。
- 候选镜像 `VERSION=1.4.010`；`kin-kernel=8f1347cc…`、`kin-computer=a6497083…`、`kin-worker=d6b29f11…`、`kin-egress=0bf1eeb0…`、`kin-slot-gate=78f78d59…`、`cli-node=f29bbfa4…`、`cc-node=be5eec49…` 均与 manifest 一致。
- `npm audit --omit=dev` 仍有上游 `socks-proxy-agent -> socks -> ip-address@10.7.3` moderate，未额外改依赖。

## 下次升级标准门槛

1. 默认选择 04:00–08:00 空窗，且最近 5 分钟业务请求为 0；用户明确要求立即部署时可跳过等待，但必须记录切换窗口在途请求结果。
2. 用户审查后自行 `--force-with-lease` 推送本机 `fork-patches-v1.4.010-prep` 到 `origin/fork-patches`；旧远端值为 `fc6a626bdd25d1285916ebaf48c450b0fd930393`。
3. 保留/备份 live routing、distill rules、`.env` 与 rollback compose；创建面板一致性备份。
4. VPS `git fetch origin` 后用 `git reset --keep origin/fork-patches`，不得覆盖 live 配置；从纯净 `git archive origin/fork-patches` 构建 `vm2api:v1.4.010-fp1`，VPS 构建不使用 Windows 侧代理参数。
5. 切换 `up -d --no-build` 后先验收控制面 health、启动日志与 `restart=no` 迁移；确认成功前不得重启 Docker。随后确认/触发 `wrap-cli/sync restart:true` 与 fleet payload 刷新，核对 `cli-node/kin-worker/kin-egress/kin-slot-gate` 哈希。
6. 验收 health、双槽状态、迁移仍至 042、verify-fixes 默认用例、公网 401/200、真实小请求和 15 分钟观察。
7. 升级成功并完成文档留档后，用 `git worktree remove` 清理历史 baseline，只保留本次最新版本；最后 `git worktree prune` 并复核 `git worktree list`。

## 2026-10-23 部署结论

1. 用户明确要求立即部署，未等待业务空窗；切换窗口既有业务请求均 200，无 5xx。
2. 01:33:45 UTC 切换 `vm2api:v1.3.218-fp1`；槽容器未重启，无迁移/wrap sync/payload 变化。启动后自动移除废弃 `codex.official_passthrough` 键，routing SHA256 `4197add1…c06d`，distill 保持 `97a1b693…e2b0`。
3. health OK，迁移最高 042；vm-01/vm-02 native kernel healthy，ready_slots 20/19，credential fresh。
4. verify-fixes A/C/D1/D2/K1/K2/S 全 PASS；K1/K2 出站均为 system 2 点 + user 2 点，共 4 个 1h 断点。
5. 公网 models 无 key 401、带 key 200 且 23 个模型。控制面启动期仅 bridge-heal 重建两个 egress helper，无 kernel restart/OOM。
6. 01:33:45–01:48:45 UTC 观察 15 分钟无 OOM/fatal/panic/kernel restart/5xx；97 条 200、46 条 429（37 条为 `ysg` key 并发 4 本地限流），`HPE_INVALID_EOF_STATE` 为客户端提前断开/重试。清理 4.453GB build cache 后根分区可用 8.7G。
