# Fork 二开补丁台账

> 本文件跟踪本 fork（31Yang/vm2api）相对上游（dofastted/vm2api）的全部自定义改动，供后续合并上游新版本时对照。
> 规则：每个补丁一节；合入上游新版本后逐条核对「状态」列，上游已修的补丁及时下线。**补丁默认不提 issue/PR 回上游，长期自维护（2026-09-29 起生效）。**

## 分支与基线

| 项 | 值 |
|---|---|
| 上游 | `upstream` = github.com/dofastted/vm2api |
| 补丁分支 | `fork-patches`（VPS `/opt/vm2api` 当前 checkout 的分支） |
| 当前基线 | `v1.3.80`（`fork-patches` = v1.3.80 + 下表补丁；2026-09-29 由 v1.3.79 rebase，无冲突） |
| 本地对应分支 | `fork-patches`（本机 clone 跟踪 `origin/fork-patches`；旧的 `fix/egress-self-loop` 已停用） |
| 控制面镜像 | 自建，tag 形如 `vm2api:v<基线>-fp<N>`，由 `docker-compose.override.yml` 的 `image:` 固定（见下方流程第 4 步） |

**升级上游新版本的流程（2026-09-29 修订）：**
1. 本机：`git fetch upstream --tags && git fetch origin`，在 `fork-patches` 上 `git rebase v<X.Y.Z>`（冲突按下面各补丁节的「合并注意」处理）→ `npm ci && npm run test:unit` → `git push --force-with-lease origin fork-patches`。Windows 上有约 11 个与平台相关的既有失败测试文件（tar 备份、`/opt/vm2api` 路径映射、软链接、文件权限），以 VPS 上 Linux 容器跑的结果为准
2. VPS：先备份 `src/config/routing.json`（线上配置但受 git 跟踪），再 `cd /opt/vm2api && git fetch origin && git reset --keep origin/fork-patches`。**不要用 `--hard`**：会把线上 routing.json（健康探针间隔等）打回仓库版本；`--keep` 只更新两个提交之间有差异的文件，遇到冲突会中止
3. 涉及 Go 二进制（`bin/kin-egress` 等）的补丁：按对应补丁节重编，替换 `bin/*.patched`
4. 控制面：`docker build -t vm2api:v<X.Y.Z>-fp<N> .` → 把 `docker-compose.override.yml` 里 `services.vm2api.image` 改成该 tag → `docker compose up -d`。`.env` 的 `VM2API_IMAGE_TAG` 同步改成上游基线 tag（仅作回退参考）。**不要 `docker compose pull`**（override 里的本地 tag 不在任何仓库，pull 会报错）；回退官方镜像 = 删掉 override 的 `image:` 行 → `docker pull ghcr.io/dofastted/vm2api:v<X.Y.Z>` → `docker compose up -d`
5. 照上游 CHANGELOG「已部署机升级」段落决定是否 `wrap-cli/sync`、是否重启槽；冒烟后在部署指南 §15 登记

---

## 补丁 1：kin-egress 自回路守卫（active）

| 项 | 值 |
|---|---|
| commit | `fix/egress-self-loop` 分支 HEAD（VPS `fork-patches` 同名 commit） |
| 改动文件 | `worker/internal/egress/server.go`、`worker/internal/egress/server_test.go` |
| 引入日期 | 2026-09-22，基线 v1.3.21 |
| 状态 | **active**；2026-09-29 再核对 v1.3.79→v1.3.80：`worker/`、`bin/`、`share/` 零 diff，`bin/kin-egress.patched` 继续有效、无需重编。此前核对：v1.3.74→v1.3.79 上游未动 `worker/internal/egress`（`server.go` 零 diff）、`bin/kin-egress` 未随 tag 变化，无需重编，`bin/kin-egress.patched`（v1.3.74 基线产物）继续有效；上游仍无 `loopsToSelf` 同类防护（`sameHostPort` 旧守卫不覆盖本回路），补丁保留；不提 PR，自维护 |

**根因**：控制面代理池每 10 分钟探测一次（`src/lib/vm/proxy-pool.mjs` 的 `probe_interval_min: 10`），`egressListening` 的 `waitListen` 会向 kin-egress 监听地址（如 `172.19.0.1:34722`）发起真实 TCP 连接探测存活性。kin-egress 的透明转发对"每个接受的连接"按其 OriginalDst 经 SOCKS5 转发——探测连接的 OriginalDst 就是监听地址本身，于是向 SOCKS 代理（vps-socks）发起 `CONNECT 172.19.0.1:34722`；代理回拨该地址再次被 kin-egress 接受并转发，形成自持放大回路：一条种子连接约 22 秒放大到 7500+ 次 SOCKS 拨号，约 30–60 秒内耗尽代理进程 65535 个 FD（`accept4: too many open files`），vps-socks 崩溃重启；回路随崩溃熄灭，10 分钟后下一次探测重新点燃——表现为 vps-socks 每 ~10 分钟崩溃一次的稳定周期。

**修法**：`handleTCP` 在转发前调 `loopsToSelf(dest)`，目标是自身 `ListenTCP`/`ListenDNS`（含通配监听情形）直接拒绝关闭。探测的 TCP connect 在握手层仍成功（`connect_ex` 返回 0），面板探测显示不受影响。

**部署方式（不动 git 跟踪文件）**：
- 重编产物放 `bin/kin-egress.patched`（untracked）
- `docker-compose.override.yml`（compose 自动合并，untracked）覆盖：
  ```yaml
  services:
    vm2api:
      environment:
        KIN_EGRESS_BIN: /opt/vm2api/bin/kin-egress.patched
  ```

**重编命令**（VPS 上，无需装 Go）：
```bash
docker run --rm -v /opt/vm2api:/src:ro -v /tmp/kinbuild:/out \
  -e GOCACHE=/tmp/goc -e GOMODCACHE=/tmp/gom golang:1.25 \
  sh -c 'cd /src/worker && gofmt -l . && go test ./... && CGO_ENABLED=0 go build -buildvcs=false -trimpath -o /out/kin-egress ./cmd/kin-egress'
sudo install -m 755 -o root -g root /tmp/kinbuild/kin-egress /opt/vm2api/bin/kin-egress.patched
cd /opt/vm2api && docker compose restart
```

**验证**：`python3 -c "socket.connect_ex(('172.19.0.1',34722))"` 打一条种子连接，同时 `strace -f -e connect -p $(pgrep -f kin-egress.patched)` 观察：补丁前 22 秒约 7600 次对 127.0.0.1:1080 拨号，补丁后 0 次。间接验证：连续 2 个探测周期（20 分钟）`vps-socks` 的 RestartCount 不再增长。

**合并注意**：上游若改了 `server.go` 的 `handleTCP`/`ForwardTCP` 或新增了同类防护（查 `loopsToSelf` / `sameHostPort` / "self-loop" 字样），本补丁整条下线，并删除 `docker-compose.override.yml` 与 `bin/kin-egress.patched` 后 `docker compose up -d` 复原。

注意区分：v1.3.30 #91「px-local 本地出口 direct 化」是控制面 src/ 改动（local 探测短路返回 mode: direct、不再为本地出口启动 kin-egress），与本补丁作用路径互斥，**不构成同类修复**；远程 SOCKS5 路径的 waitListen 真实 TCP 探测与自回路放大风险在 v1.3.44 依然存在（gressListening 对非 local 代理仍走 inspectEgressProcess + waitListen），本补丁继续兜底。

---

## 补丁 2：quota 熔断 503 带恢复时刻（quota-retry-after，active）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支（src/ 控制面改动，见分支 git log） |
| 改动文件 | `src/lib/pool/pool-scheduler.mjs`、`src/lib/pool/failover-runner.mjs`、`src/lib/core/errors.mjs`、`src/lib/protocol/handle-protocol.mjs` |
| 引入日期 | 2026-09-29，基线 v1.3.79 |
| 状态 | **active**；不提 PR，自维护 |

**动机**：quota_5h_safety 等额度熔断把账号摘出调度时，客户端只收到 503 `pool_unavailable`「号池当前没有可用账号」，无恢复时刻 → 客户端盲目重试刷日志。调度层其实已知恢复时刻（quota gate `detail.reset` / `temp_unschedulable_until`），但 quota 硬门早退（`return { ok:false }`）丢弃了它。

**改动（纯响应注解，不碰调度/熔断/重试决策）**：
- `checkEligibility` quota 硬门早退带 `availableAt`（新增 `wakeMsOf` 归一化 ISO/epoch s/epoch ms）；
- `eligibleCandidates` 收集被门排除账号的 wake 到 `candidates.excludedWakeAts`（数组附加属性，JSON 序列化自动丢弃，不进日志）；
- `selectionSnapshot` 在 waitPool 无 soonest 时兜底用 excludedWakeAts；
- `poolError`（503 路径，全库仅 selectionFailure 一个调用点）照 429 先例带 `retryAfterSec`；
- `poolClientError('unavailable')` 附加白名单 details `{reset_at, retry_after_sec}` 与消息后缀「（预计 <ISO> 恢复）」；
- `handle-protocol` 的 retry-after 头放行从 pool_overloaded 放宽到 pool_unavailable。

**不变量**：状态码 503、error code `pool_unavailable`、调度决策、日志字段（logBag 记原始 code+message）均不变；e2e 约束保持（message 含「号池当前没有可用账号」前缀；body 不透出 eligible/account_pool_exhausted 字样——details 只白名单放行两个字段）。

**部署方式**：控制面改动走 dev 镜像：`docker build -t vm2api:dev .` → `VM2API_IMAGE=vm2api VM2API_IMAGE_TAG=dev docker compose up -d`（`.env` 仍固定官方 tag，回退直接 `docker compose up -d` 即回官方镜像）。

**验证**：`node --test test/unit/errors-map.test.mjs`（21/21）+ pool 相关单测（190/190，2026-09-29 通过）；熔断期实测 503 应带 `retry-after` 头与 `details.reset_at`。

**合并注意**：上游若给 pool_unavailable 原生带 retryAfterSec/reset_at（查 `handle-protocol.mjs` 的 retryAfterSec 放行条件、`errors.mjs` 的 `poolClientError`），本补丁整条下线（下线即删除本四文件改动，回官方镜像）；rebase 冲突集中在 `selectionSnapshot` / quota gate / `poolClientError` 三处。

---

## 补丁 3：cli-hop 请求整形——对话中 system 的型号判定 + 小 max_tokens 保底（待部署）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支 `fix(protocol): cli-hop mid-system models and small max_tokens floor` |
| 改动文件 | `src/lib/protocol/anthropic-policy.mjs`（`modelSupportsMidConversationSystem`）、`src/lib/protocol/outbound-attempt.mjs`（`prepareCliHopBody` 保底 + `raiseCliHopMaxTokensForThinking`）、`test/unit/cli-hop-body.test.mjs` |
| 引入日期 | 2026-09-29，基线 v1.3.80 |
| 状态 | **待部署**（本机单测通过）；不提 PR，自维护 |

**动机（2026-09-29 复审，详见部署指南 §13 A/C 类）**：
- A：`anthropic-policy.mjs` 的 `modelSupportsMidConversationSystem()` 只排除 haiku，但 Sonnet 4.6 也不接受 messages 里的 role=system。调用方 system 中 CLI 吸收不了的剩余部分被放成对话中 system 消息后，sonnet-4-6 请求上游秒拒、被判空 hop → 502 `incomplete_response`（线上 154/154）。v1.3.33 引入。
- C：v1.3.70 新增的 `min_max_tokens`（默认 128）在入口先把 64 抬到 128，使 `prepareCliHopBody` 里「≤64 抬到 1024」的保护（v1.3.39）永远不触发；再叠加补上的 adaptive thinking + effort high，Claude Code auto 模式权限分类器（max_tokens=64）必撞 128 → CLI 致命错误 → 502（线上 83 条，客户端每次分类重试约 40 次）。

**改动**：
- A（`mid-system-models`）：`modelSupportsMidConversationSystem()` 对 haiku、`claude-3*`、Claude 4.x（4.8 除外）返回 false，走既有的 lift 路径（与 haiku 相同：把对话中 system 文本并入顶层 `system[]`）。两个调用点（cli-hop 整形、`sanitizeAnthropicBodyForBetaTokens`）同时生效。**取舍**：若有人把 sonnet-4-6 当主力跑多轮会话，每轮变化的提醒被挪进 `system[]`，缓存前缀会失效（v1.3.33 之前所有型号都是这样）；目前 sonnet-4-6 流量主要是标题生成等单轮小请求，可接受。以后要优化可改为就地转成 user 消息末尾的 `<system-reminder>`（注意 API 要求 tool_result 块排在 user 消息最前）。
- C（`cli-hop-min-tokens`）：cli-hop 小预算保底——`max_tokens < 1024` 一律抬到 1024（取代原 `<= 64` 判断，后者会被入口 `min_max_tokens` 的 128 抢先抬过阈值而失效）；补全 thinking 之后，若 thinking 为 adaptive/enabled 且 `max_tokens < 4096`，抬到 4096（思考也消耗 max_tokens）。只抬不降，按实际输出计费；缺省 max_tokens 仍由上游补 128000；入口 `min_max_tokens`（128）保持不动。

**验证**：本机 `node --test test/unit/cli-hop-body.test.mjs` 22/22（新增 5 条：入口 128 地板 + cli-hop 串联、thinking 关闭与大预算不变、sonnet-4-6 lift、支持型号保留 role=system、型号判定表），相关协议单测 64/64。部署后：用 sonnet-4-6 发一条带非标准 system 的小请求应 200；用 sonnet-5 发 `max_tokens=64` 的请求，debug 日志 `outbound_body.max_tokens` 应为 4096 且 200。

**合并注意**：上游若改了 `modelSupportsMidConversationSystem` 的判定（例如改成按 capability 表）或 `prepareCliHopBody` 的小预算保底（查 `<= 64`、`min_max_tokens`、`CLI_HOP_`），逐条对照后合并或下线；上游修掉任一问题即删除对应部分与测试。

---

## 补丁 4：CLI 错误语义——撞 max_tokens 回 200、上游超长回 400（开发中）

| 项 | 值 |
|---|---|
| 引入日期 | 2026-09-29，基线 v1.3.80 |
| 状态 | **开发中** |

**动机（部署指南 §13 B/D 类）**：
- D：槽内 CLI 把 `stop_reason=max_tokens` 当致命错误（「Claude's response exceeded the N output token maximum」），vm2api 回 502 `upstream_error`；官方 API 语义是 200 + `stop_reason: max_tokens` + 已生成内容。客户端收到 502 只会原样重试、再烧一遍输出额度。
- B：上游因超出上下文窗口秒拒时，vm2api 当成空 hop、同号重试后回 502 `incomplete_response`（面板归「超时」），客户端拿不到 prompt too long 信号，Claude Code 的自动压缩不会触发（线上单会话被原样重试 168 次）。

---

## 补丁 5：空闲看门狗 180s → 600s（开发中）

| 项 | 值 |
|---|---|
| 引入日期 | 2026-09-29，基线 v1.3.80 |
| 状态 | **开发中** |

**动机（部署指南 §13 E 类）**：控制面 `KIN_STREAM_IDLE_TIMEOUT` 与槽内核 job 看门狗默认都是 180s 无帧即杀。超大单轮输出（43K–48K token、6–9 分钟）中出现 >180s 的静默段（最可能是 `display: omitted` 的思考）就被杀成 504 `worker_timeout`；09-29 同一请求 14 次尝试里 12 次失败。
