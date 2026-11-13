# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | 最新 release `v1.4.083`（2026-11-13 核对，`1df69e29`）；本地准备分支从该 tag 检出，生产与测试实例都尚未切换 |
| 线上基线 | VPS10 生产仍是 `vm2api:v1.4.028-fp1`（运行源码 `2e848ed4`，schema 047）。测试实例仍是 `v1.4.056-fp1-test-prep`（源码 `21d5aeef`，schema 054），它是另一套账号来源，不作为本次生产预发 |
| 分支 | 本地准备分支 `fork-patches-v1.4.083-prep`，worktree `../vm2api-v1.4.083-prep`，HEAD `1df69e29` 加未提交补丁；远端尚未推送，部署前由用户按 lease 强推 |
| 保护点 | 纯净对照 worktree `../vm2api-v1.4.083-baseline`，detached `1df69e29`。旧 `../vm2api-v1.4.028-baseline`（`65d02fec`）与 `fork-patches-v1.4.056-prep` 在本次闭环前保留 |
| baseline 纪律 | 上游纯净对照 worktree 只用于测试归因；升级闭环后只保留最新版本一个，历史 baseline 已清理 |
| 镜像 | 生产仍运行 `vm2api:v1.4.028-fp1` = `sha256:246a54f3bb3a361e96c3aa2142259eade397ca88dfe8064299cb682778822bcc`。083 候选镜像尚未构建。测试实例镜像保持 `v1.4.056-fp1-test-prep`，本次不切换 |
| 生产备份/回滚 | 最新备份 `bak_76c4c7ed2b10`（26,303,215 bytes，SHA256 `a81ffd52…6bb9`，db 147,116,032 bytes），`quick_check=ok`；保护目录 `/opt/vm2api-primary/pre-14028fp1-switch-20261030T023012Z`。028 快速回滚可切旧镜像，但精确回滚必须停写并恢复备份，且把本机三槽与 VPS9 vm-01 payload 同步回 025 |
| 测试备份/回滚 | v1.4.056 切换前冷备 `/opt/vm2api-test-backups/pre-14056fp1-test-20261110T062234Z.tar.gz`（3,008,331,831 bytes，SHA256 `756cede7…8812`，含 data/vms/config/runtime.env 与旧 systemd unit）。历史 fp1 冷备 `/opt/vm2api-test/backups/pre-14041fp1-20261105T081122Z.tar.gz`；fp2-test 前冷备 `/opt/vm2api-test-backups/pre-container-prefix-20261109T071141Z.tar.gz`。切回不支持前缀的旧镜像前必须先停测试控制面并防止其重建无前缀 `kin-*` |
| 已解决上游问题 | #817 官方 first-use hello / usage 缺首方身份句的问题已由上游 `v1.4.028` 修复；用户手动完成 vm-03/vm-04 初装并验收 OK，不得重复执行 |

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

## v1.4.028→v1.4.041 变化

1. 区间无新增 DB migration，schema 继续停在 047。#837 自 `v1.4.030` 起修复 `prepareSlotOAuth` 读取嵌套 kernel health 的问题，解决非 native 槽 OAuth 导入必报 `Target VM native CLI is not ready`。
2. payload release 切到 `payload-2026.11.01-codex-image-kernel`：`kin-codex-kernel` 与 `kin-oauth-auth` 更新；Claude 槽关键 `kin-kernel` / `kin-kernel.bin`、`cli-node`、`cc-node` 哈希不变。测试实例只跑 Claude 槽，切换控制面后无需 `wrap-cli/sync`，不得重启测试槽容器或改变出口。
3. `v1.4.038` 起 Node 控制面包含长连接超时、代理真实 CONNECT 探测、远端健康抖动、Claude Code thinking/cache 与设备亲和等修复；`v1.4.041` 继续补硬规则否定语境、Codex tool history、密钥租户隔离与槽位同步待办重试。
4. 部署要求以上游 `v1.4.038` 口径为准：更新 Node 控制面与 `web/dist` 后重启；不必 `wrap-cli/sync`，不必刷新 payload 到槽；不要覆盖 `routing.json`、`vms/`、`data/`、runtime env。

## v1.4.041→v1.4.056 变化

1. 新增 DB migration 048/054：`api_endpoints.risk_review_enabled` 与 `api_keys.allowed_models`。两者均为 additive column/default，但切换测试或生产前必须做一致性备份；精确回滚仍按“停写 + 恢复备份”处理，不能只切旧镜像。
2. payload manifest 与 Claude 槽关键二进制不变；控制面 Dockerfile 新增随镜像构建的 `kin-redact` helper。构建仍需独立 Docker buildx `--network host`，升级只需重启控制面，不触发 `wrap-cli/sync` 或生产槽 payload 刷新。
3. 控制面新增 graceful draining、#852 槽位假死/连续静默超时感知、API endpoint 风险审核、内容脱敏、租户用量视图、Key 级模型白名单与冷 KVM 槽迁移。#852 不解决 Claude `no_capacity` 进入 unit circuit 的分类问题。
4. v1.4.055/056 引入 CRAG v2 双内核与许可证体系，默认仍走 cli-node；当前测试/生产未启用 CRAG，不需要购买或激活授权，也不得因升级自动切换槽内核。


## v1.4.056→v1.4.083 变化

1. `056..083` 没有新的 SQL。生产从 schema 047 升上来仍只新增 048、054 两列，都是 additive。切换前必须做一致性备份；精确回滚要停写并恢复备份，不能只切旧镜像。
2. 083 的 pinned payload 是 `v1.4.077`，另有独立 CRAG 包 `crag_release=v2.8.16`。相对生产 028，`kin-kernel` 从 `f57d4e71…4288` 变为 `09fc853d…5a87`，`cli-node` 从 `8484c4c5…611b` 变为 `b5dac65d…99ed`，并新增 CRAG 出厂包。真正切换时要按哈希 sync payload。不要启用 CRAG，不要 `docker rm` 槽，确认 health 前不要重启 Docker/containerd。
3. 083 的 CHANGELOG 说本版相对 077/081 不换内核、不必 `wrap-cli/sync`。那只对已经在 077 payload 上的实例成立。生产仍在 028 payload，不能沿用这句。
4. `alignSamplingWithThinking` 仍早于 `ensureOfficialPrintThinking`。显式 `cragPrint: true` 但 kernel 不是实际 active 的 CRAG worker 时，不再算 print。

## Active patches

### 补丁 4：cli-hop 输出上限与超长上下文错误语义

- 保留。输出上限恢复逻辑重放到 v1.4.010 新 `streamGoWorker`，并保留 outbound headers 内部诊断帧过滤、提交队列、thread beta 与 openBlocks 行为。v1.4.056 仍把泛化 5xx 归入 provider/circuit，也未恢复 wrap CLI output-cap 错误语义。
- Linux 专项通过，覆盖 Unix socket 流式行为。

### 补丁 9：硬正则否定/防御语境豁免

- 保留。上游仍无等价防御语境豁免；语义限定同一短句与近距离后缀，并与上游 `isNegatedExtraction` 共存。`extra` 临时自定义规则不享受防御豁免，保持上游“自定义规则显式命中即拦截”的契约。
- 专项通过，直接破限仍拦截。

### 上游已覆盖：OAuth ensure 400 调度保护（候选补丁 10 不再立项）

- v1.4.045 起，worker 会标记 `credential_ensure_failed`；致命 grant 被升级为 401 并走 `oauth_revoked` 永久停调度，非致命 refresh 失败按账号冷却 10 分钟并换槽。上游测试覆盖致命 401、已提交不重放与非致命 ensure 失败。
- 该行为比原先“所有 HTTP 400 + refresh_failed 一律永久 paused”更细：临时 token endpoint 故障不会永久停槽，`invalid_grant`/`invalid_refresh_token` 等致命 grant 仍不会继续消耗请求。

### 补丁 13：最终 worker payload 的 thinking sampling 对齐

- 动机：OpenAI Chat 入站显式携带非 1 `temperature` 且未传 `thinking` 时，`finalizeWorkerPayload` 会按官方 print 形态注入 adaptive thinking，但保留原 sampling 字段，Anthropic 返回 400。早期 `prepareAnthropicRequest` 的 sampling 对齐发生在注入前，无法覆盖该路径。
- 改动：仅当标准 worker 最终 payload 为 enabled/adaptive thinking 且调用方原本显式传了 sampling 字段时，在最终阶段复制 body 后把已有 `temperature` 改为 `1` 并删除 `top_p/top_k`；原本缺省 `temperature` 继续缺省，不扩大官方出站形状。CRAG v2 print 自建 wire 且不转发 thinking/temperature，保持内部 envelope 原样。
- 验收：覆盖未传 thinking + `temperature=0.1/0.2/0.5`、缺省 temperature、显式 thinking、`between_tools`、disabled 与 repaired 路径；`go-worker-client` / `between-tools` / `official-303` / `auto-mode` 定向回归通过。
- 合并注意：上游若把 `alignSamplingWithThinking` 移到 `ensureOfficialPrintThinking` 之后且保持“缺省不补 temperature”语义，可下线本补丁。
- 下线条件：上游原生修复该最终注入路径，并提供同等回归。


### 补丁 14：本地容量拒绝不进 provider circuit

- 保留。kernel admission 的 `no_capacity` 或 `runtime overloaded` 归 `scope=worker, reason=local_capacity`，无 cooldown、无 `circuit`。裸 `overloaded` 仍走 `overloadedUnit`。
- `unit-decision` 把 `local_capacity` 标为 `origin=local`。高压复测属于线上动作，未授权不做。
- 下线条件：上游把该本地拒绝从 provider unit circuit 中分开，并有同等回归。

### 补丁 12：并行控制面 Docker 槽名前缀
- 生产不设置 `KIN_SLOT_CONTAINER_PREFIX`。测试实例继续用自己的 `test-`，本次升级不改测试实例。

- 动机：VPS10 生产与测试控制面共用独立 Docker daemon，但槽容器名由 VM ID 全局生成（`vm-02 -> kin-02`）。测试实例误建同名 VM 后会接管生产本机槽容器，导致生产 503 `kernel_unavailable`。为并行实例提供可选 Docker 名称前缀。
- 改动：新增 `KIN_SLOT_CONTAINER_PREFIX`（必须以 `-` 结尾）。未设置时保持上游 `kin-*` 行为；设置后统一生成与解析 `kin-*` 槽容器名，并对历史 `runtime.container` 补前缀；v1.4.056 rebase 后同步覆盖 `slotExecContainer()`，避免测试实例 docker exec / 恢复操作命中生产同名容器。该开关只给测试实例使用，生产不设置。
- 验证：新增容器命名单测，覆盖无前缀、生成名、历史持久名、已带前缀名、docker exec 入口与非法前缀。v1.4.056 Linux 专项 PASS。
- 合并注意：上游若原生提供 control-plane/container namespace，应优先上游方案并下线本补丁。
- 下线条件：测试实例改用独立 Docker daemon，或上游提供等价隔离能力。

### 上游已解决：官方初装 hello 429

- v1.4.023/v1.4.025 的 first-use 直连路径缺 `CRS_OFFICIAL_CLI_SYSTEM`，导致 hello 与 `/usage` 被上游 429 `rate_limit_error "Error"` 拒绝；v1.4.028 已在官方 bootstrap 命令补回。
- 2026-10-30 用户手动完成 vm-03/vm-04 force 初装；只读复核 `hello_ok=true`、`usage_ok=true`、`status=ok`，后续不得重复执行。

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---|---:|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游稳定官方 system/messages 前缀与 lift 模型，覆盖原目标 |
| 11 official_full user 断点 | v1.4.025 | 上游 #797 的 shapedFallback 在缺少 messages marker 时按预算/TTL 补点；保留 fork 测试作回归 |
| 3 cli-hop 小 max_tokens 保底 | v1.4.056 | 上游 #885/v1.4.043 提供 `min_max_tokens` preserve/floor 契约与模型目录默认值；无条件 1024 保底会违反 preserve 并覆盖模型默认 64000，下线源码补丁，保留显式小预算透传回归 |
| 候选 10 OAuth 400 自动停调度 | v1.4.056 | 上游 v1.4.045 已区分致命 grant 401 永久停用与非致命 ensure 400 十分钟冷却，fork 不再立项 |

## 当前验证结论（v1.4.083 准备态，尚未部署）

- 状态：2026-11-13 本地准备完成到可进入部署窗口之前。补丁未提交，候选镜像未构建，生产 `vm2api-primary` 与测试 `vm2api-test` 都未切换。两套实例是不同账号来源，测试实例不是本版预发，本次不碰测试实例。
- 补丁裁决：保留 4、9、12、13、14。补丁 3 与候选 10 维持下线。生产不设置 `KIN_SLOT_CONTAINER_PREFIX`，不启用 CRAG。
- Windows 五文件专项：203 tests，153 pass，0 fail，50 skip。日志 `.claude-scratch/vm2api-v14083-fork-unit.log`。
- Linux `node:22-bookworm-slim` 只跑 `go-worker-client.test.mjs`：69 pass，0 skip。补丁 4 的 Unix 流式 output-cap 通过。日志 `.claude-scratch/vm2api-v14083-linux-gwc.log`。
- `schedule-state.test.mjs` 与 `upstream-error-policy.test.mjs`：62 pass。`local_capacity` 已并入无状态调度集合，和 `slot_busy` 一样保持 `on`。日志 `.claude-scratch/vm2api-v14083-schedule.log`。
- Go：本机没有 go。Docker `golang:1.25` 经 `http://10.10.250.250:10250` 执行 `go test -race ./...`，退出码 0。worker 源码无改动。日志 `.claude-scratch/vm2api-v14083-go-proxy.log`。
- Windows 隔离全量扫描发生在 `schedule-state` 修复前：prep 360 个文件失败 71，纯净 baseline 359 个文件失败 70。同名失败文件的 `not ok` 行逐条相同。当时多出来的唯一失败文件是 `schedule-state.test.mjs`，修复后已单独通过；多出来的测试文件是已通过的 `container-name.test.mjs`。全量 Linux 单测和 VPS 验收都还没跑，不能把这次对齐写成线上通过。
- 上游行为变化：默认 `cc_entrypoint=cli` 时，缺失 thinking 会填 `{type:adaptive, display:updates}` 并带 `thinking-display-updates-2026-08-18`；显式 `sdk-cli` 才是 `omitted`。028 生产一律填 `omitted`。这不是补丁 13。
- 仍不能切换：没有候选镜像，没有新的生产一致性备份，028 到 083 的 `kin-kernel` / `cli-node` 哈希变化尚未 sync。083 CHANGELOG 里相对 077/081 不必 sync 的说法不适用于仍在 028 payload 的生产。生产 schema 仍是 047，048 与 054 还没应用到生产库。

## 当前验证结论（v1.4.056 测试部署态，2026-11-10）

- rebase：73 个 fork 提交落到 `v1.4.056`，仅补丁 12 在 `rust-kernel-supervisor.mjs` 与上游 CRAG import 冲突；已保留上游 CRAG / workerPaths，并合入槽名前缀。相对上游源码差异收敛为补丁 4/9/12/13 与对应测试、台账。
- 补丁裁决：补丁 3 下线。上游 v1.4.042/#885 与 v1.4.043 已提供 `min_max_tokens` preserve/floor 和模型目录默认值，fork 无条件 1024 保底会违反 preserve 并覆盖 Sonnet 5 缺省 64000；相关测试改为验证显式小预算透传与上游 entry floor。
- 补丁 13：`official print thinking aligns only explicit caller sampling` PASS，覆盖 `temperature=0.1/0.2/0.5/1`、缺省 temperature、`top_p/top_k`、CRAG 不改写、`between_tools` 与 repaired 不回填 thinking。
- Linux `node:22-bookworm-slim` 定向回归 9 个文件 / 204 tests / 204 PASS，覆盖补丁 4/9/12/13、Unix socket 流式、official-303、auto-mode、cli-hop body 与 max_tokens 契约。
- Linux 全量隔离单测未作为通过结论：`node:22-bookworm-slim` 缺 openssl / `bin/kin-egress`，且无 IPv6 `::1`，观察到的 direct-link、egress、private-dir、proxy-agent/ipv6 失败均为容器环境依赖；随后在 `wrap-cli-runtime.test.mjs` 挂起后中止。需在 VPS10 完整构建环境或含依赖的 Linux 容器完成双侧全量对照。
- Go：`golang:1.25-bookworm` 中 worker `go test -race ./...`、worker/api-kernel/redact `go vet ./...`、api-kernel/redact `go test ./...` 全部通过；gofmt 对 worker/api-kernel/redact 无差异。
- Web：pnpm 10 下 Vitest 76 files / 596 tests PASS，build（含 typecheck）PASS。`format:check` 报上游 v1.4.056 既有 `settings/index.tsx`、`redaction-pane.tsx` 两处格式差异；lint 为上游既有 8 errors / 41 warnings（含分层 import、no-control-regex 与 react-refresh 警告），fork 未改 web 源码，均非阻断。
- Docker：VPS10 独立 Docker buildx `--network host` 构建通过，候选 `vm2api:v1.4.056-fp1-test-prep` = `sha256:1184c39d…08a1`，`VERSION=1.4.056`，`kin-redact` 已随镜像产出；Claude `kin-kernel=f57d4e71…4288`、`cli-node=8484c4c5…611b` 不变，15 个 payload 按 `payload-2026.11.01-codex-image-kernel` 下载校验。测试实例已于 2026-11-10 14:25 SGT 切换。
- 高压复测中 `temperature + adaptive` 400 已有最小修复；`kernel no_capacity/runtime overloaded` 仍会进入 provider 503 / unit circuit，生产升级继续阻塞，需另立补丁并高压复测。

## 2026-11-10 v1.4.056-fp1-test-prep 部署结论

1. 切换前最近 5 分钟业务请求为 0，`KIN_SLOT_CONTAINER_PREFIX=test-` 生效。14:22 UTC+8 停止测试控制面后创建冷备 `/opt/vm2api-test-backups/pre-14056fp1-test-20261110T062234Z.tar.gz`（3,008,331,831 bytes，SHA256 `756cede719b63a89cc94e1c85bac005531fad847b8dc3fce1e191ea81cf88812`）；备份包含 data、vms、src/config、runtime.env 与旧 systemd unit。生产容器与测试槽容器均未重启。
2. 槽位数量复核：11-09 22:33 SGT 定时备份 manifest 仍有 7 个 VM（vm-01~06/vm-t01），11-10 14:20 升级前只读预检已仅剩 `vm-01/vm-02/vm-t01`；vm-03~06 在升级开始前已被移除，应用日志与 Docker event 未留下可归因记录。本次升级未删除或重建槽容器。
3. 14:25:19 仅将 `vm2api-test.service` 镜像 tag 从 `v1.4.041-fp2-test` 改为 `v1.4.056-fp1-test-prep` 后重启测试控制面；health 约 4 秒恢复 200。未执行 `wrap-cli/sync`，未刷新 payload，未改变出口。
4. DB migration 048/054 成功，schema 至 054，`api_endpoints.risk_review_enabled` 与 `api_keys.allowed_models` 存在，`PRAGMA quick_check=ok`。`test-kin-01/02/t01` 启动时间与 RestartCount 均保持不变，生产 `vm2api-primary` 仍为 `v1.4.028-fp1` 且 health 200。
5. 公网验收：`https://vmapi2.gateway.coglet.org/health=200`；无 key `/v1/models=401`。补丁 13 真实回归：入站 Chat `temperature=0.2` 且无 thinking，出站 `temperature=1 + adaptive/omitted`，上游 200，客户端 200 并输出 `OK`（4 output tokens）。
6. 14:25–14:41 观察：测试 health 持续 200，期间 99 条业务请求全部 200、0 错误；日志无 fatal/panic/uncaught/OOM/kernel restart/refresh_failed。启动时 bridge-heal 重建 3 个测试代理对应 egress helper，未见槽容器重启。

## 2026-11-09 v1.4.041-fp2-test 槽名前缀部署结论

1. 事故根因：生产/测试控制面目录与 DB 隔离，但共享 VPS10 独立 Docker daemon；上游按 VM ID 生成全局 `kin-*` 容器名，测试同名 `vm-02` 接管 `kin-02` 后，生产 vm-02 报 503 `kernel_unavailable`。
2. 部署：从提交 `8a6d953a` 纯净归档构建 `vm2api:v1.4.041-fp2-test` = `sha256:2aee0a1c…1230e`；测试 `runtime.env` 写入 `KIN_SLOT_CONTAINER_PREFIX=test-`，systemd 镜像 tag 切到 fp2-test。切换前冷备 SHA256 `8b56cb25…ff80`，未重启 Docker/containerd，未触碰生产镜像。
3. 验收：测试槽 `test-kin-01/test-kin-02/test-kin-t01` 均挂载 `/opt/vm2api-test`；生产 vm-02 recover 成功，`kin-02` 挂载 `/opt/vm2api-primary/vms/vm-02`，ready_slots=20、watchdog 清零、参与调度；生产与测试公网 health 200，生产 vm-02 后续真实请求连续 200。

## 2026-11-05 v1.4.041-fp1-prep 测试实例部署结论

1. 用户明确要求只部署测试实例。16:11 SGT 前冷备 `/opt/vm2api-test/backups/pre-14041fp1-20261105T081122Z.tar.gz`（SHA256 `2da7902c…5395`，含 data/vms/config/runtime.env 与旧 systemd unit），随后仅修改 `vm2api-test.service` 镜像 tag 并重启测试控制面；未重启 Docker/containerd，未触碰 `vm2api-primary` 与生产槽。
2. 测试镜像源码为本地 `fork-patches-v1.4.041-prep` 提交 `298a2597`。启动后 health 200、schema 047、公网 health 200；无 key `/v1/models=401`，带测试 key 200 且 25 个模型。
3. `vm-t01` 槽容器保持原启动时间与 `restarts=0`，health 为 `healthy=true` / `vm_telemetry=true` / `telemetry_ready=true` / `ready_slots=20` / `cli_restarts=0`。未执行 `wrap-cli/sync`，因 Claude 槽 payload 哈希不变。
4. 在新控制面内直接调用 `prepareSlotOAuth(vm-t01)` 成功，返回 `{ok:true, status:"running", home:"/home/kincli"}`；确认上游 #837 已解决此前 OAuth 导入必报 `Target VM native CLI is not ready` 的问题。
5. 启动日志仅保留 `ExecStartPre` 对已删除旧容器的预期 `No such container` 提示；未见 fatal/panic/uncaught/OOM/refresh_failed。生产 `vm2api-primary` 仍为 `v1.4.028-fp1`。

## 2026-10-30 v1.4.028 验证结论（历史）

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
4. 在独立 Docker buildx 中从纯净 `git archive <commit>` 构建下一版 `fp<N>` 镜像；必须带 `--network host`。v1.4.056 起镜像还需编译 `kin-redact`。不得改动既有 nerdctl 系统 containerd，确认成功前不得重启 Docker。
5. 更新 `vm2api-primary.service` 镜像 tag 后重启主控容器，先验收 health、启动日志与槽位 `restart=no` 语义。随后按目标版本 CHANGELOG 处理 payload：若 Claude 槽 payload 哈希不变，仅核对哈希且不得触发 `wrap-cli/sync` / fleet 刷新；仅当 payload 变化才执行 `restart:true` 同步与节点 fleet 刷新。
6. 验收 health、生产槽位状态、schema 版本（v1.4.056 目标为 054）、公网 401/200、真实小请求和 15 分钟观察；`verify-fixes` 适配 VPS10 前不作为硬门槛，适配后恢复默认用例验收。
7. 升级成功并完成文档留档后，用 `git worktree remove` 清理历史 baseline，只保留本次最新版本；最后 `git worktree prune` 并复核 `git worktree list`。
8. 升级前确认 telemetry 全关、全部生产槽绑定出口不变；部署后按第 5 条完成 payload 校验或同步。#817 已闭环，除非更换账号或凭证，不再执行官方 force 初装。

## 2026-10-29 v1.4.025 准备与生产迁移结论

1. 已创建 `fork-patches-v1.4.025-prep` 并完成 rebase；有效源码补丁收敛为 3/4/9，补丁 11 源码随上游 #797 下线，仅保留测试。用户已按 lease 强推 `origin/fork-patches=8c194533`。
2. 本机候选镜像 `vm2api:v1.4.025-fp1-prep` = `sha256:a0616374…e27b90`；VPS10 生产镜像 `vm2api:v1.4.025-fp1` = `sha256:17a3ca32…c812b0`。
3. 生产 DB/槽位凭证已从 VPS9 迁移到 VPS10，schema 至 047；四槽真实请求与出口验证 PASS。VPS9 反向为单槽节点，旧主控停止保留回滚，DNS 指向 VPS10。

## 2026-10-30 v1.4.028 准备结论（历史阶段）

1. 目标版本裁决为 release tag `v1.4.028`（`77b72613`），不追 post-tag `upstream/main` 的未发版 #815 修复。
2. 用户授权后，代理已推送保护 tag `pre-rebase-14028-9f36f08b`，并按 lease 将 `fork-patches` 从 `9f36f08b` 强推到 v1.4.028 准备态；后续台账提交均为 docs-only。当时生产切换仍需等待低峰窗口和独立确认。
3. VPS10 只读预检通过：`vm2api-containerd` / `vm2api-docker` / `vm2api-primary` active，health 200，根分区可用 72G，独立 Docker 29.1.3 + buildx 0.38.1。已从纯净 `git archive` 构建 `vm2api:v1.4.028-fp1-prep` = `sha256:246a54f3…22bcc`，并随最终 prep HEAD 缓存重建同 ID；15 个 payload 文件与 manifest 匹配，当时生产容器仍为 `v1.4.025-fp1`。
4. 部署前保护现场已完成：面板一致性备份 `bak_2e6e382e2a15`（26,335,085 bytes，SHA256 `b9dcfed4fa36692cf8b5202b4e81d543bcee018015c06b3f8844e7724edc28e1`，db 147,329,024 bytes，includes db/5 vms/5 config）；`PRAGMA quick_check=ok`。保护目录 `/opt/vm2api-primary/pre-14028fp1-20261030T015247Z` 内 `data-vms-config.tar.gz` SHA256 `69e51c79…b8fc`，另含 runtime env、主控/Nginx systemd unit 与 Nginx conf；旧镜像另打 `vm2api:v1.4.025-fp1-pre-14028`。
5. 预检发现 vm-01/vm-02 旧 seed policy 显式开启 telemetry，vm-03/vm-04 有历史 sidecar 进程残留。已通过面板把四槽 seed/worker 配置全关并停止旧 sidecar；vm-01 远端确认虽耗时较长，但最终 HTTP 200 / `action=stopped`，远端 worker 配置与进程均复核关闭。四个 VM 的 proxy/node/container 与保护包逐项一致。

## 2026-10-30 v1.4.028-fp1 部署结论

1. 用户明确要求立即部署。10:30:12 SGT 创建切换前备份 `bak_76c4c7ed2b10` 并 hold 四槽，`inflight=0`；10:30:47 SGT 仅更新 `vm2api-primary.service` 镜像 tag 并重启主控容器，未重启 Docker/containerd。health 约 4 秒恢复 200，schema 仍 047，`quick_check=ok`。
2. 手动 `wrap-cli/sync restart:true` 返回 4/4 OK：本机 vm-02/vm-03/vm-04 wrapper 与 kernel 校验通过；VPS9 vm-01 使用 baked 镜像 `/opt/kin/`，实际 `kin-kernel.bin=f57d4e71…4288`、`cli-node=8484c4c5…611b`，`.kin/` 旧缓存不参与运行。四槽 kernel health 均 200 / healthy / ready_slots=20 / cli_restarts=0，telemetry enabled=false。验收后恢复调度 `restored=4`。
3. 公网验收：无 key `/v1/models=401`，带 key 200 且 24 个模型。四槽各一条 haiku 最小真实请求均 200 / `OK`，output 4 tokens；vm-03/vm-04 官方初装由用户手动完成，代理仅读取状态确认 `hello_ok=true`、`usage_ok=true`、`status=ok`，未重复执行。
4. 10:30:47–10:46:00 SGT 观察 15 分钟：35 条 200、2 条 503 `account_pool_exhausted`（10:37:55/10:38:23 SGT，发生在恢复调度后的短暂资格刷新窗口，随后同模型连续 200）；无 fatal/panic/OOM/kernel restart/refresh_failed。`/opt/vm2api-primary/src` 已用 `git reset --keep` 同步到 `2e848ed4`，routing/distill SHA 前后不变。

## 2026-10-27 部署结论

1. 用户明确要求立即部署，未等待空窗；切换前 5 分钟业务请求 95 条。`git reset --keep` 因 live routing/distill 与上游默认同文件演进被拒绝，已先快照 live 配置，再按“live 值 + 新默认值”合并，`.env/vms/data` 未覆盖。
2. 04:57:33 UTC 先切 `v1.4.011-fp1`：health OK、迁移 042、两槽 `restart=no`，自动 wrap sync `2/2 failed=0`，fleet telemetry/egress `2/2`。窗口出现 1 条内置探测 503、2 条 529、1 条 200 后中断与 1 条 502，随后同槽恢复 200。
3. 上游 v1.4.010 shaped official_full 逻辑跳过 user 断点，K2 cache_read=0 且纯净 v1.4.011 同样失败；补丁 11 提交 `67a81360` 后，05:13:22 UTC 切 `vm2api:v1.4.011-fp2`。本版 payload 不变，不重启槽容器。
4. 验收：health OK；迁移最高 042；vm-01/vm-02 running/schedulable、rust kernel healthy/reachable、ready_slots 19/20、cli_restarts 0；verify-fixes A/C/D1/D2/K1/K2/S 全 PASS，K1 写 10,121、K2 读 10,121；公网无 key 401、带 key 200 且 24 模型。
5. 05:13:22–05:28:30 UTC 观察 15 分钟：158 条 200、3 条 429（2 条为本地 key 并发限制、1 条关联调用方重试），无 5xx；health probe 200；无 OOM/fatal/panic/kernel restart。`HPE_INVALID_EOF_STATE` 为客户端提前断开/重试。
