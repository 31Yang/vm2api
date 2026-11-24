# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | 最新 release `v1.4.188`（2026-11-24，`f9ba1a60`），本地准备分支从该 tag cherry-pork rebase |
| 线上基线 | VPS10 生产 `vm2api:v1.4.083-fp1`（2026-11-13 切换，schema 054；v1.4.156 候选备妥但从未部署）。对外实例 `v1.4.056-fp1-test-prep`（源码 `21d5aeef`，schema 054，`KIN_SLOT_CONTAINER_PREFIX=test-`） |
| 分支 | 本地准备分支 `fork-patches-v1.4.188-prep`（worktree `../vm2api-v1.4.188-prep`），源码提交 `8d3c54f7`（"fix: prepare fork patches for v1.4.188"，17 文件 +1095/−38 vs tag）；本台账 docs 提交不改变镜像内容。远端尚未推送，推送需用户 `--force-with-lease` |
| 保护点 | 纯净对照 worktree `../vm2api-v1.4.188-baseline`（`f9ba1a60`）。156 的 prep/baseline worktree 与候选镜像保留（可作中途备选），083 系列在闭环前保留 |
| 镜像 | 候选 `vm2api:v1.4.188-fp1` = `sha256:5b8ecc83b301c1bbdfebdf6ed302ccf61705b844a0e0b0c649b7b69ef021891b`（1.03GB，VERSION=1.4.188），源 `/var/tmp/vm2api-v14188-src`（git archive `8d3c54f7`），构建日志 `/var/tmp/vm2api-v14188-build.log`（0 ERROR）。镜像内哈希与 manifest 一致：`kin-kernel=25cd83e3…08ca`（bin 与 wrap-cli 同）、`cli-node=f6c3744d…a6788`（与 156 相同未变）、`kin-worker=402716ec…5300`、`kin-egress=7dcae417…049a`、`kin-oauth-auth=66abd584…85b3`（47,421,622B）。156 候选 `de99562f…88cba5` 仍留在 VPS10；两实例计划同用 `v1.4.188-fp1`（补丁 12 为 env 门控，生产不设前缀） |
| 生产备份/回滚 | 切换脚本内做面板 hold + `VACUUM INTO` 一致性快照（预期 schema 054 或 062）+ unit/runtime.env/routing/distill/vms JSON 保护目录；回滚 tag 按实际旧镜像生成（`vm2api:v1.4.083-fp1-pre-14188` 或 156 路径）。迁移 055–067 全 additive，紧急回滚可切旧镜像容忍新列 |
| 对外备份/回滚 | **28G 库 + ~26G 剩余磁盘无法整库冷备**。改做小表 dump + `/opt/vm2api-test` config/vms/runtime.env/unit 文件备份；回滚=切回旧镜像 tag（additive 列可容忍，两版都支持槽名前缀） |
| 已解决上游问题 | #817 官方 first-use hello（v1.4.028）；OAuth 400 调度保护（v1.4.045，候选补丁 10 关闭）；CRAG print 采样 400（v1.4.136，见补丁 13）；**`native stdin write blocked for 10s` 停顿（v1.4.166 内核只计实际写入时间，正面覆盖 2026-11-20 定位的根因）** |

## v1.4.156→v1.4.188 变化

1. 新增 DB 迁移 063–067，**全部 additive**：063 `api_endpoints.body_policy`（默认 `persona`，行为不变；面板可切 caller 透传）；064 `proxies.dns_disable_svcb_https`（把池级 SVCB/HTTPS DNS 开关落到每条代理，带回填 UPDATE，行数=代理数）；065/066/067 给 `crag_shop_orders` 补 `redemption_sha256`/`device_host`/`activation_error_*` 三列（不用 CRAG 商城则空表）。两实例目标 schema 067；升级自动应用，无降级路径，回滚依赖 additive 容忍。
2. payload：`kin-kernel` 9284c819→`25cd83e3`（**v1.4.166 重编，共享 stdin 10s 看门狗只计实际写入时间，半写失败关闭旧管道——即 11-20 定位的 `native stdin write blocked` 停顿的上游修复**）；`kin-worker`→`402716ec`（157）；`kin-egress`→`7dcae417`（167 共享出口产物修正；首次替换 helper 仍可能短暂断旧连接，1.4.144 注记继续适用）；`kin-oauth-auth`→`66abd584`（174，14MB→47MB，Setup Token 不再伪造一年期票）；CRAG 内核 3.1.7→3.1.14（MCP 续接 410 修复，槽位须重启才加载——wrap sync 本来就会重启）。**`cli-node` 与 glibc239 shim 与 156 逐字节相同**，wrap 刷新实际只换 `kin-kernel.bin`。新增 `geminiDefaultLinuxAmd64` 载荷族（0.4.3，不用不激活）。
3. 同步机制改版：`scripts/sync-wrap-cli.mjs` 删除；entrypoint `sync_shared()` 每次启动从镜像刷新 `$ROOT/bin/*`、`share/wrap-cli/{kin-kernel.bin,kin-kernel,cli-node,cc-node}` 与 `share/crag/kin-kernel`（内容比较）；`KIN_AUTO_SYNC_WRAP=1` + `VM2API_BOOTSTRAP_WRAP_CHANGED=1` 门控的启动槽位同步保留，日志串 `vm2api: wrap-cli slot sync complete (N/M, failed=X)` 不变；面板 `POST /api/panel/wrap-cli/sync` 路由不变。新增蓝绿部署套件（`deploy/bluegreen/`，不用）。entrypoint 新增控制面独占 flock 与蓝绿标记拒绝启动（单容器路径不受影响）。
4. 与 fork 补丁交集的上游语义：v1.4.168 `sampling_repairable` + `dropSampling` 重试（补丁 13 交互已分析，见下）；v1.4.180 #1611 硬正则收紧（中文绕过类要求带安全/内容/道德/伦理宾语 + 否定lookbehind；补丁 9 共存，fork 正向测试短语已随新正则更新）；v1.4.167 普通关键词命中不再进设备/会话封禁阶梯（缓解 059/061 对对外实例的误伤面）；v1.4.183 `thinking_incompatible`（adaptive thinking 预算与 max_tokens 不兼容时结构化 400——上游自家 schedule-state 表漏了该 reason，fork 已补行修复）；v1.4.176 本机槽「不就绪也不忙」改重探不再立即判挂；v1.4.157 来宾内核 `StartLimitIntervalSec` 与损坏 `.claude.json` 启动前修复。
5. 新能力不使用不激活：CRAGGemini 常驻池与 OAuth、共享出口（按槽 opt-in）、batch-group 无会话批量调度、kernel-lease 准入、蓝绿部署、TOTP 两步验证（170）、槽位伴生浏览器桌面（157）、端点 body_policy 切 caller（默认 persona 保持现行为）、count_tokens 入口（176）。升级后不购买 CRAG 订阅、不切槽内核到 CRAG、不开 Gemini、不动 proxy 的 DNS 开关。
6. 宿主身份 saga（175/186/187，CRAG 订阅侧三连改）：我们不用 CRAG 订阅，全部惰性；但注意 **186 曾把身份改为采样真值导致 4 台宿主 403，187 已热修回存储值优先并自愈 `.legacy`**——若未来启用 CRAG 订阅，勿停留在 186。
7. Node 依赖与 lockfile 零变化（package.json 仅加 `verify:oauth-egress` 脚本）；Dockerfile 四阶段结构不变，构建仍需独立 Docker + `--network host`。

## Active patches

### 补丁 4：cli-hop 输出上限与超长上下文错误语义

- 保留。188 移植：`heldEventLine` 终末 flush 移到上游 181 新增的 `stopCancel()`（单跳取消栅栏）之后——终态后的收尾交付不可取消，fork 的 held 行仍在 buffer 尾处理之前；上游新测试「do not post cancel after terminal message delivery」逐字保留并先于 fork 测试块。上游 1.4.086 native_handoff 仍只覆盖 CRAG V3 路径，cli-hop output-cap 语义上游仍缺。
- Windows 六文件专项通过（Unix socket 部分跳过，Linux 侧镜像内验证）。

### 补丁 9：硬正则否定/防御语境豁免

- 保留。上游 180 给中文规则加了否定 lookbehind（不要/不得/禁止/切勿/不是/并非），与 fork 的从句级防御线索检查（`isDefensivePolicyMatch`，48 字符窗口 + 近距离后缀）双层共存：上游只看紧邻前缀，fork 覆盖同从句更早位置的线索；`extra` 自定义规则不享受豁免的契约不变。fork 正向用例按新正则补宾语（`绕过安全限制`），防御样本 `禁止绕过安全过滤` 同时被两层放行。
- 专项通过，直接破限仍拦截。

### 补丁 12：并行控制面 Docker 槽名前缀

- 保留（仅对外实例设置 `KIN_SLOT_CONTAINER_PREFIX=test-`，生产不设置）。上游 188 仍无 control-plane 容器命名空间；`container-name.mjs` 为 fork 专属文件上游不存在；三个生成点（`rust-kernel-supervisor` / `slot-exec` / `vm-runtime`）全部经 `withSlotContainerPrefix` 收口，188 新增的 shared-egress 代码路径也走同一 `containerName()` 包装。切换脚本带前缀保命检查（env 恰好 1 处 `^test-$`、unit 0 处、切换后 `test-kin-*` 在列且无裸 `kin-*`）。
- 下线条件：测试实例改用独立 Docker daemon，或上游提供等价隔离能力。

### 补丁 13：最终 worker payload 的 thinking sampling 对齐

- 保留。188 的 `gateCragBody` 增第 5 参 `dropSampling`（print 路径 `alignSamplingWithThinking(body, {drop})`）；fork 行保持「上游新签名调用 + fork 对齐器在后」。**`sampling_repairable` 重试时采样剥离发生在更早的 `prepareAnthropicRequest`（outbound-attempt.mjs:495），到达本阶段的 body 已无采样字段，fork 对齐器读取 `original`（即已剥离的 body）天然 no-op**；若采样字段仍残留（病态直连），对齐器落在 API 默认值 `temperature=1` 并删 `top_p/top_k`，对重试合法。已加断言固化该契约。曾试过 `print || dropSampling ? directed : …` 旁路，因会放行 `top_p=0.9` 存活而放弃——无旁路版在两条路径上都产出合法形状。
- 下线条件：上游把最终注入路径的采样对齐收编并提供同等回归。

### 补丁 14：本地容量拒绝不进 provider circuit

- 保留。上游 188 仍未给 kernel admission 的 `no_capacity`/`runtime overloaded` 分类；`isLocalCapacityRefusal` 分支落位在上游新 #1562「首帧前 SOCKS/proxy 502 → proxy_transport_failure」之后，两分支共存（SOCKS 拨号失败换出口，本地容量满换 unit 不开闸）。`schedule-state` 无状态集合在 fork 里同时含 `local_capacity`（fork）与 `thinking_incompatible`（fork 补上游缺口）。
- 下线条件：上游把该本地拒绝从 provider unit circuit 中分开，并有同等回归。

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---:|---|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游稳定官方 system/messages 前缀与 lift 模型覆盖 |
| 11 official_full user 断点 | v1.4.025 | 上游 #797 shapedFallback 覆盖；保留 fork 测试作回归 |
| 3 cli-hop 小 max_tokens 保底 | v1.4.056 | 上游 `min_max_tokens` 契约覆盖；无条件保底违反 preserve，维持下线 |
| 候选 10 OAuth 400 自动停调度 | v1.4.045 | 上游区分致命 grant 401 与非致命 400 冷却，维持关闭 |

## 当前验证结论（v1.4.188 准备态）

- rebase：fork 单提交 `8168691c`（156）cherry-pick 到 `f9ba1a60`，冲突仅 3 文件（`upstream-error-policy.mjs`、`go-worker-client.mjs`、`go-worker-client.test.mjs`；156 时为 5 文件），按「上游新结构 + fork 补丁语义」解决；其余 14 文件自动合并后逐 hunk 比对确认 fork 语义完整（jev-intercept 防御线索、stream-error-status 溢出归类、patch 12 三调用点、unit-decision local 归因）。结果提交 `8d3c54f7`。
- 补丁裁决：保留 4、9、12、13、14；补丁 3 与候选 10 维持下线；本轮零下线。fork 额外修上游自身缺口一处（schedule-state 补 `thinking_incompatible` 行，上游 188 自家测试在该 reason 上失败）。
- Windows 六文件专项（gwc/cli-hop-body/container-name/jev-intercept/schedule-state/upstream-error-policy）：**251 tests / 187 pass / 0 fail / 64 skip**（156 为 241/178/63；+10 来自上游新测试：cancel 栅栏、#1562 三例等，fork 新增 dropSampling 断言并入既有用例）。
- Biome 对全部 fork 改动文件通过；`node --check` 全部通过（曾出现一次测试文件拼接括号失衡，已修复后复验）。
- 全量隔离单测双侧对照（Windows）：**prep 101/437 失败文件 vs 纯净 baseline 102/436**；**失败集合逐文件比对完全一致，fork 零新增失败**。baseline 多出的唯一失败是 `schedule-state.test.mjs`——上游 188 自家 `every emitted reason` 测试因缺 `thinking_incompatible` 行而失败，fork 补行后通过（见补丁裁决）。prep 多出的 1 个文件是 fork 专属 `container-name.test.mjs`（通过，不入失败表）。`api-channel-routing` 与 `scoped-intercept-session` 在双侧同为 Windows 挂起（看门狗按 >10 分钟 + CPU<2s 击杀，与 156 轮一致），记为上游测试的平台依赖。日志 `.claude-scratch/vm2api-v14188-{prep,baseline}-unit.log`、失败清单 `v14188-{prep,baseline}-fails.txt`。
- Go：VPS10 `golang:1.25-bookworm` 容器 `--network host` 下 `go test -race ./...` 全部通过（8 包 ok、0 FAIL、race 干净）。worker 源码 fork 零改动。
- 镜像：VPS10 独立 Docker 构建通过（0 ERROR），`vm2api:v1.4.188-fp1` = `sha256:5b8ecc83…021891b`，`VERSION=1.4.188`，5 个关键 payload 哈希与 `deploy/payload.json` 一致（见基线表）；构建期间 primary `/health` 保持 200。唯一警告为 Dockerfile 既有 `KIN_OAUTH_AUTH_BIN` ENV 提示，与 156 相同非阻断。

## 下次升级标准门槛（VPS10）

1. 默认选择 04:00–08:00 空窗，且最近 5 分钟业务请求为 0；用户明确要求立即部署时可跳过等待，但必须记录切换窗口在途请求结果。对外实例另需避开其使用方高峰（历史观测 09:00–12:00 SGT）。
2. rebase 后由用户审查并执行 `--force-with-lease` 推送；若只是追加热修提交，可普通 push。
3. 生产：脚本内 hold + `VACUUM INTO` 一致性备份 + 文件保护目录；对外：小表 dump + 文件备份（整库冷备受磁盘限制）。
4. 独立 Docker 从纯净 `git archive <commit>` 构建，必须 `--network host`；不得动 nerdctl 系统 containerd，确认成功前不得重启 Docker。
5. 切 unit 镜像 tag 后重启控制面：验收 health、启动日志、迁移到 **067**、`restart=no` 语义；本版 wrap 刷新实际换 `kin-kernel.bin`（`25cd83e3…08ca`），`KIN_AUTO_SYNC_WRAP=1` 触发启动槽位同步，必须等 `wrap-cli slot sync complete (N/N, failed=0)`；kin-egress helper 替换可能短暂断旧连接。
6. 验收 health、槽位状态、schema 067、公网 401/200、真实小请求、15 分钟观察；对外实例另验收 `test-kin-*` 前缀与封禁面板可见性。升级后观察 `native stdin write blocked` 应消失（v1.4.166 内核修复）。
7. 升级闭环后 `git worktree remove` 清理历史 baseline/prep，只保留最新；`git worktree prune` 复核。
8. 升级前确认 telemetry 全关、全部槽绑定出口不变；#817 已闭环，不重复官方 force 初装。

## 2026-11-24 v1.4.188 准备结论

1. 用户指令：两实例升级到上游最新 v1.4.188，完成部署前全部准备，等明确部署指令；对外实例带补丁 12（槽名前缀），生产不带。同一镜像两用（env 门控）。v1.4.156 准备（2026-11-19）被 188 取代，156 候选镜像保留在 VPS10 作备选。
2. 切换脚本已上传 VPS10 并通过 `bash -n`：`/var/tmp/vm2api-switch-v14188-primary.sh`（`CONFIRM=SWITCH-VPS10-PRIMARY-14188`，支持从 083/156 动态切换）与 `/var/tmp/vm2api-switch-v14188-test.sh`（`CONFIRM=SWITCH-VPS10-TEST-14188`，支持从 056/156，含前缀保命检查）。本地留档 `../vps/vm2api-switch-v14188-*.sh`。
3. 部署顺序建议与风险窗口（wrap sync 重启槽内核、kin-egress helper 首替断旧连接）随预案提交用户裁决。
4. 本版特别收益：v1.4.166 `kin-kernel` 的 stdin 看门狗只计实际写入时间——生产 11-20 起的 `native stdin write blocked for 10s` → `kernel_unavailable` 停顿对（CPU steal 下的误触发）预期在升级后消失；167 起 VPS10 高 steal 时的停顿成因被正面修复。

## 2026-11-19 v1.4.156 准备结论（未部署，被 188 取代）

1. 候选 `vm2api:v1.4.156-fp1` = `sha256:de99562f…88cba5`（966,990,337B）构建并验证；补丁裁决同为 4/9/12/13/14；两套切换脚本（`/var/tmp/vm2api-switch-v14156-*.sh`）就位但从未执行。
2. 生产/对外始终停留在 083/056（schema 054）。若走 156→188 两跳，188 脚本已兼容（OLD_TAGS_OK 含 156）。

## 2026-11-13 v1.4.083 准备与切换（历史）

1. 候选 `vm2api:v1.4.083-fp1` = `sha256:b9e6ad97…3b25a4`；15:51 SGT 经 `/var/tmp/vm2api-switch-v14083-primary.sh` 切换生产（保护目录 `pre-14083fp1-switch-20261113T075127Z`），schema 047→054，wrap sync 完成；对外实例未随切。
2. Windows 五文件专项 203/153/0/50；Docker golang:1.25 `go test -race ./...` 退出码 0。

## 2026-11-10 v1.4.056-fp1-test-prep 部署结论（历史）

1. 对外实例 14:25 切换，schema 至 054，`PRAGMA quick_check=ok`；公网 health 200、无 key 401；补丁 13 真实回归（入站 `temperature=0.2` → 出站 `temperature=1 + adaptive`）上游 200。14:25–14:41 观察 99 条请求全部 200。
2. 2026-11-18 起该实例定位为对外实例（外部团队使用），内置整库备份停用。

## 2026-11-09 v1.4.041-fp2-test 槽名前缀部署结论（历史）

1. 事故根因：共享 Docker daemon + 全局 `kin-*` 容器名，测试实例同名 VM 接管生产槽容器致生产 503。补丁 12 后测试槽以 `test-kin-*` 运行，生产恢复。
