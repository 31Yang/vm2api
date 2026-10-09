# Fork 二开补丁台账

> 本文件跟踪本 fork（31Yang/vm2api）相对上游（dofastted/vm2api）的全部自定义改动，供后续合并上游新版本时对照。
> 规则：每个补丁一节；合入上游新版本后逐条核对「状态」列，上游已修的补丁及时下线。**补丁默认不提 issue/PR 回上游，长期自维护（2026-09-29 起生效）。**

## 分支与基线

| 项 | 值 |
|---|---|
| 上游 | `upstream` = github.com/dofastted/vm2api |
| 补丁分支 | `fork-patches`（VPS `/opt/vm2api` 当前 checkout 的分支） |
| 当前基线 | `v1.3.133`（`fork-patches` = v1.3.133 + 补丁 3（保底部分）/4/8；2026-10-09 升级：github.com:443 当时不通，经 api.github.com tarball 导入为合成提交 `30b647d6`（真实上游 commit 前缀 `e959e40`，父提交是真 tag v1.3.131，网络恢复后 fetch 到的真 v1.3.133 与之树相同、可无损对账）；1.3.132 控制台加「文档」链接 + README/RISK.md 写明拦截顺序，1.3.133 遥测开关派生化（`seed_policy.telemetry_disabled` 单源），均为控制面 + web/dist 改动、无迁移、二进制不变、不必 wrap-cli/sync；与补丁 3/4/8 零文件重叠，干净 rebase；补丁 8 新增单测 5 条随 `sanitize.test.mjs` 20/20 通过；全套 194 文件失败清单与纯净 v1.3.133 基线（17 个平台失败文件）逐项比对**完全一致、零回归**；保护 tag `pre-rebase-13133-fp1`）。历史基线：v1.3.131（2026-10-09 rebase 并部署 `vm2api:v1.3.131-fp1`：补丁 5（上游 v1.3.126 原生 `failover.stream_idle_timeout_ms` + 启动脚本导出 `JOB_IDLE_SECS`，且证实 `KIN_JOB_IDLE_SECS` 从未生效）与补丁 7（上游 v1.3.125 `withRequestProtocolBetas` 管线重写，本补丁 strip 被架空成空操作）随之下线；保护 tag `pre-rebase-13131-fp2`）、v1.3.124（2026-10-08，保护 tag `pre-rebase-13123-fp7` / `pre-rebase-13124-fp1`） |
| 本地对应分支 | `fork-patches`（本机 clone 跟踪 `origin/fork-patches`；旧的 `fix/egress-self-loop` 已停用） |
| 控制面镜像 | 自建，tag 形如 `vm2api:v<基线>-fp<N>`，由 `docker-compose.override.yml` 的 `image:` 固定（见下方流程第 4 步） |

**升级上游新版本的流程（2026-09-29 修订）：**
1. 本机：`git fetch upstream --tags && git fetch origin`，在 `fork-patches` 上 `git rebase v<X.Y.Z>`（冲突按下面各补丁节的「合并注意」处理）→ `npm ci && npm run test:unit` → `git push --force-with-lease origin fork-patches`。Windows 上有一批与平台相关的既有失败测试文件（tar 备份、`/opt/vm2api` 路径映射、软链接、文件权限、Unix socket 等；2026-10-08 实测干净 tag 基线：v1.3.123 为 18 个文件失败、v1.3.124 为 20 个（v1.3.124 失败集合与 fork 分支逐项比对持平），fork 分支不得比对应基线多），以 VPS 上 Linux 容器跑的结果为准
2. VPS：先备份 `src/config/routing.json`（线上配置但受 git 跟踪），再 `cd /opt/vm2api && git fetch origin && git reset --keep origin/fork-patches`。**不要用 `--hard`**：会把线上 routing.json（健康探针间隔等）打回仓库版本；`--keep` 只更新两个提交之间有差异的文件，遇到冲突会中止
3. 涉及 Go 二进制（`bin/kin-egress` 等）的补丁：按对应补丁节重编，替换 `bin/*.patched`
4. 控制面：`docker build -t vm2api:v<X.Y.Z>-fp<N> .` → 把 `docker-compose.override.yml` 里 `services.vm2api.image` 改成该 tag → `docker compose up -d`。`.env` 的 `VM2API_IMAGE_TAG` 同步改成上游基线 tag（仅作回退参考）。**不要 `docker compose pull`**（override 里的本地 tag 不在任何仓库，pull 会报错）；回退官方镜像 = 删掉 override 的 `image:` 行 → `docker pull ghcr.io/dofastted/vm2api:v<X.Y.Z>` → `docker compose up -d`
5. 照上游 CHANGELOG「已部署机升级」段落决定是否 `wrap-cli/sync`、是否重启槽；冒烟后在部署指南 §15 登记。**跨过的版本里只要 `share/wrap-cli/cli-node` / `cc-node` 字节变了，就必须手动 `wrap-cli/sync`**：这些文件受 git 跟踪、`share/` 是挂载目录，第 2 步的 `git reset` 已先把宿主文件换成新版，容器入口脚本比对「镜像 = 宿主」就不会自动同步，槽里还是旧 CLI

> 上游在 2026-09 底重写过一次 git 历史（新根提交 `74aa459`「Publish a clean vm2api monorepo snapshot」）：本机 `v1.3.74` 及更早的 tag 仍是旧哈希，`git fetch upstream --tags` 会对它们报 `would clobber existing tag`，无害（v1.3.75 起一致，`fork-patches` 已在新历史上）。想清掉报错可 `git fetch upstream --tags --force`。

---

## 补丁 1：kin-egress 自回路守卫（已下线，v1.3.123 上游已修）

| 项 | 值 |
|---|---|
| commit | `fix/egress-self-loop` 分支 HEAD（VPS `fork-patches` 同名 commit） |
| 改动文件 | `worker/internal/egress/server.go`、`worker/internal/egress/server_test.go` |
| 引入日期 | 2026-09-22，基线 v1.3.21 |
| 状态 | **已下线（2026-10-08，基线 v1.3.123）**：上游 `handleTCP` 已原生拒绝自回路连接——`OriginalDst` 结果等于 `conn.LocalAddr().String()` 时拒绝转发并打 `refuse self-destined conn` 日志（上游注释描述的场景与本补丁根因一致：探测直连没有 REDIRECT 目标，转发会经本地 SOCKS 回拨自身形成放大回路）。直连探测时 LocalAddr 即被拨地址，守卫覆盖 waitListen 探测回路；`loopsToSelf` 不再随分支携带，本区间上游对 `server.go` 的改动（DNS 覆写等）不再有合并负担。**VPS 配套操作（下次部署时执行）**：`.env` 的 `KIN_EGRESS_BIN` 改回官方 `bin/kin-egress`（或删该行用默认值），`bin/kin-egress.patched` 可删除；今后升级不再需要重编 egress。历史核对记录：2026-09-30 v1.3.80→v1.3.85 `worker/`、`bin/` 零 diff；2026-09-29 v1.3.79→v1.3.80 零 diff；v1.3.74→v1.3.79 上游未动 egress |

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

## 补丁 2：quota 熔断 503 带恢复时刻（quota-retry-after，已下线，v1.3.123 上游已原生覆盖）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支（src/ 控制面改动，见分支 git log） |
| 改动文件 | `src/lib/pool/pool-scheduler.mjs`、`src/lib/pool/failover-runner.mjs`、`src/lib/core/errors.mjs`、`src/lib/protocol/handle-protocol.mjs`；测试 `test/unit/fork-quota-retry-after.test.mjs`（fork 专用，2026-09-30 新增） |
| 引入日期 | 2026-09-29，基线 v1.3.79；2026-09-30 修正（见下方「已知问题与修正」） |
| 状态 | **已下线（2026-10-08，基线 v1.3.123）**：上游 pool 层已重写并原生覆盖本补丁目标——`pool-scheduler.mjs` 全链路 `retry_after_ms`（含 quota gate 的 `reset_at`、`planner.retryAfterMs`），`failover-runner.mjs` 的 503 原生带 `retryAfterSec`（planner 最早席位释放/最近恢复估计），`handle-protocol.mjs` 原生把 `retryAfterSec` 写成 `retry-after` 响应头，`errors.mjs` 原生解析上游 `Retry-After`；v1.3.94 起另有原生限额重置。本补丁四个源码文件改动与 fork 专用测试 `fork-quota-retry-after.test.mjs` 已随 rebase 移除。**注意**：上游 503 文案不含「预计北京时间 … 恢复」，`vm2api-deploy-*.sh verify` 对补丁 2 的该项预期需在下次部署前调整；上游真熔断（`no_eligible_accounts`）是否带精确窗口重置时刻，部署后实测确认。历史：2026-09-30 修正（`329af8c`）随 `vm2api:v1.3.85-fp7` 部署，真熔断 503 验证带 `retry-after: 7083` 与「预计北京时间 09-30 17:40 恢复」；详见下方记录 |

**动机**：quota_5h_safety 等额度熔断把账号摘出调度时，客户端只收到 503 `pool_unavailable`「号池当前没有可用账号」，无恢复时刻 → 客户端盲目重试刷日志。调度层其实已知恢复时刻（quota gate `detail.reset` / `temp_unschedulable_until`），但 quota 硬门早退（`return { ok:false }`）丢弃了它。

**改动（纯响应注解，不碰调度/熔断/重试决策）**：
- `checkEligibility` quota 硬门早退带 `availableAt`（新增 `wakeMsOf` 归一化 ISO/epoch s/epoch ms）；
- `eligibleCandidates` 收集被门排除账号的 wake 到 `candidates.excludedWakeAts`（数组附加属性，JSON 序列化自动丢弃，不进日志）；
- `selectionSnapshot` 在 waitPool 无 soonest 时兜底用 excludedWakeAts；
- `poolError`（503 路径，全库仅 selectionFailure 一个调用点）照 429 先例带 `retryAfterSec`；
- `poolClientError('unavailable')` 附加白名单 details `{reset_at, retry_after_sec}` 与消息后缀「（预计北京时间 MM-DD HH:MM 恢复）」（初版为 ISO UTC，2026-09-30 改为北京时间、向上取整到分钟；`details.reset_at` 仍是 ISO UTC）；
- `handle-protocol` 的 retry-after 头放行从 pool_overloaded 放宽到 pool_unavailable。

**不变量**：状态码 503、error code `pool_unavailable`、调度决策（哪些账号放行、排除、排队都不变，只改 503 带不带恢复时刻）、日志字段（logBag 记原始 code+message）均不变；e2e 约束保持（message 含「号池当前没有可用账号」前缀；body 不透出 eligible/account_pool_exhausted 字样——details 只白名单放行两个字段）。

**部署方式**：控制面改动随 fork 自建镜像发布（2026-09-29 起 tag 形如 `vm2api:v<基线>-fp<N>`，由 `docker-compose.override.yml` 的 `image:` 固定，见上方升级流程第 4 步）。

**验证**：
- 单测：`node --test test/unit/fork-quota-retry-after.test.mjs`（9 条）。这组测试用真实 `AccountQuota` / `evaluateAccount`，不 mock 额度闸。修正前的代码会挂 7 条，另 2 条是"放行结果不变""无恢复时刻时消息不变"的对照。
- 2026-09-30 修正时的全量结果：
  - Linux 容器（`node:22-bookworm-slim`）166 个测试文件（不含已知会挂起的 `wrap-cli-runtime`）共 1905 条：1894 通过、0 失败、9 跳过。
  - 另有 2 个文件整体超时被取消：`database.test.mjs`、`db-migration-sub2api.test.mjs`。修正前的代码在同一容器里也一样，属环境问题。
  - Windows 上号池 / 错误相关 22 个文件 449 条，只有 2 条失败，修正前同样失败，属平台差异。
- 线上：`bash ~/vm2api-deploy-v1.3.85-fp7.sh verify`。只在账号真熔断时发 1 条 haiku 小请求（在 VPS 上被拒、不耗额度），应得到 503、`retry-after` 约等于到窗口重置的秒数、消息带「预计北京时间 … 恢复」。
- 初版的验证只跑了既有单测（errors-map 21/21、pool 190/190，2026-09-29），线上熔断期从未满足"带恢复时刻"，见下方。

**已知问题与修正（2026-09-30）**：初版只在上游"在途保护"时生效，给出的恢复时刻还偏长几小时；真熔断反而不带恢复时刻。
- **真熔断走不到本补丁**：`checkEligibility` 先调 `evaluateAccount`（`src/lib/pool/availability.mjs`）。它发现 `u5 >= limit_5h` 就直接返回 `{ ok:false, reason }`，不带恢复时刻，轮不到后面挂了本补丁的 `accountQuota.canAccept`。上游已拒（`headerHardBlocked`）同理。
  - 证据：补丁 09-29 02:42 UTC 已上线，但 09-29 09:11–09:53 UTC 的 126 条熔断 503，以及 09-30 06:44 UTC 起的熔断 503，`error_message` 都只有 `no_eligible_accounts eligible=0`，没有 `soonest`。
  - 所以客户端既没收到 `retry-after`，也没看到"预计…恢复"。
- **能走到 `canAccept` 额度分支的，实际只剩"在途保护"**：上游 2e34da0（09-22）的 `safetyTripped`，在用量 ≥ 档位线 − 0.05、且账号有在途请求时拒绝，Max 档即 90% 起。
  - 这种拦截在在途请求结束后就解除，本补丁却给它带上 5h 重置时刻。
  - 例：09-30 06:31–06:33 UTC 的 6 条 503，`retry-after` 为 11,210–11,297 秒（约 3.1 小时），消息写"预计 09:40Z 恢复"，实际几分钟内就重新放行。
- **单测没覆盖**：初版只跑了既有单测，它们用 mock 的 quota gate 直接返回拒绝，没走 `evaluateAccount` 这条真实路径，所以当时没发现。
- **修正（2026-09-30，用户选择修正而非下线，随 `vm2api:v1.3.85-fp7` 部署）**：只改 `pool-scheduler.mjs` 和 `errors.mjs`，不改调度决策。
  1. `checkEligibility` 里 `evaluateAccount` 拒绝（`key === 'quota'`，即 5h/7d 的 safety 与 header 拒绝）时，带上它已算好的 `until`（窗口重置时刻）。这是上游代码里唯一新改的一行。
  2. 被排除账号的恢复时刻改由 `exclusionWakeOf` 统一读取：读 `availableAt`，没有则读 `until`。这样上游 429/529 冻结（`hardBlock`）和熔断器（`circuit_open`）原本就带的 `until` 也会生效。
  3. `canAccept` 的额度拒绝若是在途保护（`inflightGuardTrip`：`quota_*_safety` 且 `detail.utilization < limit`），标记 `transient`，不带恢复时刻。
  4. 被排除的账号里只要有一个是"随时可能恢复"的（在途保护、`worker_unhealthy`、`session_limit`），整个号池就不报恢复时刻（`excludedTransient`）。这避免多号时拿另一个号几小时后的重置时刻误导客户端。
  5. 客户端消息改为北京时间，见上方「改动」。
- 修正后的行为：
  - 真熔断：503 带 `retry-after`（到窗口重置的秒数），提示「预计北京时间 … 恢复」；
  - 在途保护：503 不带，客户端按自己的退避重试；
  - 上游 429/529 冻结：带冻结结束时刻；
  - 被在途保护拦下的请求仍是立即 503，不排队（上游行为，未改）。

**合并注意**：上游若给 pool_unavailable 原生带 retryAfterSec/reset_at（查 `handle-protocol.mjs` 的 retryAfterSec 放行条件、`errors.mjs` 的 `poolClientError`），本补丁整条下线（下线即删除本四文件改动与 fork 专用测试文件，回官方镜像）。rebase 冲突集中在以下几处：
- `selectionSnapshot`；
- `eligibleCandidates` 的排除分支；
- `checkEligibility` 的 `evaluateAccount` 拒绝行与 quota gate 分支；
- `poolClientError`。

上游若改了 `safetyTripped` 的在途规则（`account-quota.mjs`）或 `canAccept` 的 detail 字段（`utilization` / `limit_5h` / `limit_7d`），要同步核对 `inflightGuardTrip`。

---

## 补丁 3：cli-hop 请求整形——小 max_tokens 保底（active；型号判定部分已于 v1.3.123 下线）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支 `fix(protocol): cli-hop mid-system models and small max_tokens floor` |
| 改动文件 | `src/lib/protocol/outbound-attempt.mjs`（`prepareCliHopBody` 保底 + `raiseCliHopMaxTokensForThinking`）、`test/unit/cli-hop-body.test.mjs`、`test/unit/min-max-tokens.test.mjs`（上游用例按本补丁语义改预期） |
| 引入日期 | 2026-09-29，基线 v1.3.80 |
| 状态 | **active（仅保底部分）**；不提 PR，自维护。2026-10-08 核对 v1.3.123：① 型号判定上游已重写（仅 Claude 5 系接受对话中 system；opus-4.8、fable-5 也判不支持），覆盖 A 部分场景（sonnet-4-6 → lift），A 部分下线、取上游实现，fork 判定表测试按上游语义重写；② 上游删除了自己的 `<= 64` 保底，新增 `auto_mode_classifier` 专用路径（`request-purpose.mjs` 的 `prepareClassifierBody`，原生校验预算并给 always-on thinking 加 2048 headroom，覆盖原 83x502 分类器场景）；③ 小预算保底上游没有，C 部分保留并落到新 `prepareCliHopBody`（保底在分类器早退之后、lift 之前；`raiseCliHopMaxTokensForThinking` 在 thinking 补全之后）；上游新用例「disabling the floor preserves the caller budget through cli-hop preparation」与本补丁语义冲突，预期按本补丁改为 1024 并注释；rebase 后 `cli-hop-body.test.mjs` 24/24、`min-max-tokens.test.mjs` 7/7 通过。2026-10-08 核对 v1.3.124：上游未动 cli-hop 相关文件，干净 rebase，两测试文件仍全过。2026-10-09 核对 v1.3.131：上游改了同文件 `pinHaikuCliThinking`（haiku-5.5 豁免 thinking 禁用）与 `prepareOutboundEnvelope`（接入 `withRequestProtocolBetas`），与保底插入点相邻产生一处冲突，按「保底保留 + 取上游新版注释/函数」解决；`cli-hop-body` 24/24、`min-max-tokens` 7/7 通过。历史：2026-09-29 随 `vm2api:v1.3.80-fp5` 部署，A、C 验证通过；2026-09-30 随 `v1.3.85-fp6` 复测 PASS |

**动机（2026-09-29 复审，详见部署指南 §13 A/C 类）**：
- A：`anthropic-policy.mjs` 的 `modelSupportsMidConversationSystem()` 只排除 haiku，但 Sonnet 4.6 也不接受 messages 里的 role=system。调用方 system 中 CLI 吸收不了的剩余部分被放成对话中 system 消息后，sonnet-4-6 请求上游秒拒、被判空 hop → 502 `incomplete_response`（线上 154/154）。v1.3.33 引入。
- C：v1.3.70 新增的 `min_max_tokens`（默认 128）在入口先把 64 抬到 128，使 `prepareCliHopBody` 里「≤64 抬到 1024」的保护（v1.3.39）永远不触发；再叠加补上的 adaptive thinking + effort high，Claude Code auto 模式权限分类器（max_tokens=64）必撞 128 → CLI 致命错误 → 502（线上 83 条，客户端每次分类重试约 40 次）。

**改动**：
- A（`mid-system-models`，**2026-10-08 已下线**，v1.3.123 起取上游重写后的判定；以下为历史记录）：`modelSupportsMidConversationSystem()` 对 haiku、`claude-3*`、Claude 4.x（4.8 除外）返回 false，走既有的 lift 路径（与 haiku 相同：把对话中 system 文本并入顶层 `system[]`）。两个调用点（cli-hop 整形、`sanitizeAnthropicBodyForBetaTokens`）同时生效。**取舍**：若有人把 sonnet-4-6 当主力跑多轮会话，每轮变化的提醒被挪进 `system[]`，缓存前缀会失效（v1.3.33 之前所有型号都是这样）；目前 sonnet-4-6 流量主要是标题生成等单轮小请求，可接受。以后要优化可改为就地转成 user 消息末尾的 `<system-reminder>`（注意 API 要求 tool_result 块排在 user 消息最前）。
- C（`cli-hop-min-tokens`）：cli-hop 小预算保底——`max_tokens < 1024` 一律抬到 1024（取代原 `<= 64` 判断，后者会被入口 `min_max_tokens` 的 128 抢先抬过阈值而失效）；补全 thinking 之后，若 thinking 为 adaptive/enabled 且 `max_tokens < 4096`，抬到 4096（思考也消耗 max_tokens）。只抬不降，按实际输出计费；缺省 max_tokens 仍由上游补 128000；入口 `min_max_tokens`（128）保持不动。

**验证**：本机 `node --test test/unit/cli-hop-body.test.mjs` 22/22（新增 5 条：入口 128 地板 + cli-hop 串联、thinking 关闭与大预算不变、sonnet-4-6 lift、支持型号保留 role=system、型号判定表），相关协议单测 64/64。部署后：用 sonnet-4-6 发一条带非标准 system 的小请求应 200；用 sonnet-5 发 `max_tokens=64` 的请求，debug 日志 `outbound_body.max_tokens` 应为 4096 且 200。

**合并注意**：只剩保底部分。上游若恢复 `prepareCliHopBody` 的小预算保底（查 `min_max_tokens`、`CLI_HOP_`、`max_output_tokens` 相关处理）或给分类器以外的 cli-hop 请求官方预算下限，对照后下线本补丁；上游再改 `prepareCliHopBody` 结构时注意保底插入点（`auto_mode_classifier` 早退之后）与 `raiseCliHopMaxTokensForThinking` 调用点（thinking 补全之后），以及 `min-max-tokens.test.mjs` 里按本补丁改过预期的用例。

---

## 补丁 4：CLI 错误语义——撞 max_tokens 回 200、上游超长回 400（active）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支 `fix(transport): cli-hop output-cap stop and context-overflow 400` |
| 改动文件 | `src/lib/transport/go-worker-client.mjs`、`test/unit/go-worker-client.test.mjs` |
| 引入日期 | 2026-09-29，基线 v1.3.80 |
| 状态 | **active / 部分生效**（部署同上；09-29 验证：D 通过；B 未生效，见下方「09-29 验证结论」）；不提 PR，自维护。2026-09-30 核对 v1.3.85：上游未动 `go-worker-client.mjs`，也没处理撞上限 / 超长。随 `vm2api:v1.3.85-fp6` 部署后复测：D1、D2 PASS（用例需带一句 system，否则 v1.3.82 起无 system 的 haiku 会拒写长文、测不到上限），B 在新版 CLI 下仍是 502 `incomplete_response`。2026-10-08 核对 v1.3.123：上游仍无撞上限 / 超长处理（`CONTEXT_OVERFLOW` 类关键字 grep 为空），rebase 自动合并无冲突；Windows 单测 11 过 22 跳过（Unix socket 流式用例须 Linux 跑），Linux 验证随下次部署执行。2026-10-08 核对 v1.3.124：上游未动 `go-worker-client.mjs` / `outbound-attempt.mjs`，干净 rebase。2026-10-09 核对 v1.3.131：上游只改了 `finalizeWorkerPayload` 的 beta 处理（`downgradeUngatedThinkingDisplay` 调用替换为 `withRequestProtocolBetas` + body `betas` 通道），与本补丁的流式错误语义区域零重叠、干净合并；上游未自己处理撞上限 / 超长（`CONTEXT_OVERFLOW` 类关键字 grep 仍为空）；Windows 单测 11 过 22 跳过（Unix socket 流式用例须部署后 Linux 补跑） |

**动机（部署指南 §13 B/D 类）**：
- D：槽内 CLI 把 `stop_reason=max_tokens` 当致命错误（「Claude's response exceeded the N output token maximum」），vm2api 回 502 `upstream_error`；官方 API 语义是 200 + `stop_reason: max_tokens` + 已生成内容。客户端收到 502 只会原样重试、再烧一遍输出额度。
- B：上游因超出上下文窗口秒拒时，vm2api 当成空 hop、同号重试后回 502 `incomplete_response`（面板归「超时」），客户端拿不到 prompt too long 信号，Claude Code 的自动压缩不会触发（线上单会话被原样重试 168 次）。


**改动**：
- D（撞上限）：`streamGoWorker` **仅对 cli-hop** 生效——暂存每个 `event:` 行，等它的 `data:` 行决定去留；识别到「exceeded the N output token maximum」错误时吞掉该错误，按上游真实语义收尾：给仍打开的内容块补 `content_block_stop`，再补 `message_delta{stop_reason: max_tokens, usage.output_tokens: N}` 和 `message_stop`，之后丢弃内核可能跟来的 error / message_delta / message_stop。结果变成 200 成功（OpenAI 客户端得到 `finish_reason: length`），usage 记 N 个输出 token（原先只记 message_start 的 0–9 个）。被截断的 tool_use 其 input 退化为 `{}`（与上游截断语义一致，客户端应按 max_tokens 处理）。非 cli-hop 路径（Codex 内核等）与其他错误一律不变。
- B（超长）：`semanticStatusForStreamError` 识别上下文超长文本（prompt is too long / exceed context limit 等）→ 400；`restoreUncommittedHop`、`restoreKernelErrorStatus` 遇到这类错误改写为 `invalid_request_error`，并确保消息含小写 `prompt is too long`（Claude Code 据此触发自动压缩）。上游错误策略把 400 归为请求级 `invalid_request`：立即停止、不重试、不冷却账号。

**风险 / 未实证**：内核转发 CLI 错误时的实际 SSE 形态（是否先发 message_delta / message_stop、错误是否带 code）、以及超长时 CLI 输出的原文，都没有线上抓包。补丁对多种形态做了防御（内核已发 message_stop 时只吞错误、不重复收尾）；超长正则不匹配时退回原行为（无害）。

**验证**：本机 Docker Linux 容器（`node:22-bookworm-slim`）`node --test test/unit/go-worker-client.test.mjs` 30/30（新增 7 条：超长状态映射、未提交超长→400、cli-hop 撞上限→max_tokens、未闭合 tool_use 先补 stop、内核已发 message_stop 不重复、非 cli-hop 与其他错误行为不变、流式超长→400），errors-map 21、upstream-error-policy 44、failover-runner 38、error-class 4 全过。部署后受控验证：① haiku（thinking 关闭）`max_tokens=1100` 让它写长文 → 应 200 + `stop_reason: max_tokens`（OpenAI 渠道 `finish_reason: length`）；② sonnet-4-6 灌 >200K token 纯文本 → 应 400 且消息含 prompt is too long。若 ② 仍是 502 `incomplete_response`，说明 CLI 原文不在正则里，需要抓原文补正则。

**09-29 验证结论**：D 按预期（非流式 `finish_reason: length`、流式以 `stop_reason: max_tokens` 收尾、usage 记 1100 输出 token）。B 未生效：约 30 万 token 的 sonnet-4-6 请求仍是 502 `incomplete_response`，3 次同号尝试各约 0.5s、无 usage、日志无原文——槽内 CLI 碰到上游超长拒绝时没有吐出带文字的错误事件，而是无输出结束，所以 `CONTEXT_OVERFLOW_TEXT` 没有触发对象（代码无害，保留）。下一步：额度正常时直接向槽内核发一条超长诊断请求，抓原始 SSE / trailer（`X-Kin-Terminal-State` 等）和 `kin_job_done` 的内容，按实际信号改判定。

**09-30 定位（v1.3.85 下复测仍是 502）**：
- 槽内 `cli-node` 是 UPX 压缩的 Bun 可执行文件，`upx -d` 后能直接读 JS。源码显示，CLI 在原生任务循环里遇到 API 错误消息（`isApiErrorMessage`）时会向内核发 `kin_job_error`，并附 `extractErrorText` 取出的文字：
  - 超长时通常是 `Prompt is too long`；
  - 若先走了被动压缩又失败，则抛出 `Conversation too long. Press esc twice to go up a few messages and try again.`，同样经 `kin_job_error` 上报。
- Node 这边看到的却是：HTTP 200、有首字节（约 0.47s）、无内容、无 `error` 事件，3 次尝试各约 0.5s，内核日志也不记单次请求。所以文字丢在闭源 Rust 内核（`kin-kernel.bin`）转发给 Node 这一步，或者被改成了 Node 不处理的形式。内核字符串里能看到 `kin_job_error`、`X-Kin-Event-Count` 等，但转换逻辑读不出来。
- 修法分两步：
  1. 诊断：在 vm2api 容器里另起一个 Node 进程，给 `http.request` 包一层记录后调用 `streamGoWorker`（`workerRequest` 在调用时才取 `http.request`，所以不用改线上代码），抓一次超长请求的原始 SSE 和 trailer；
  2. 按结果修：文字能到达 Node，就把 `Conversation too long` 并入 `CONTEXT_OVERFLOW_TEXT`，并解析对应事件；到不了，就在 cli-hop"秒回空回复"时调 `countTokensViaWorker`（官方 token 计数接口，免费），实数超过模型窗口就回 400、不重试。

**合并注意**：上游若改了 `streamGoWorker` 的行循环、`semanticStatusForStreamError`，或自己开始处理撞上限 / 超长（查 `output token maximum`、`prompt is too long`、`handleLine`、`passLine`），对照后合并或下线；Windows 上这组流式测试会被跳过（依赖 Unix socket），必须在 Linux 上跑。

---

## 补丁 5：空闲看门狗 180s → 600s（已下线，v1.3.126 上游原生覆盖）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支 `fix(vm): configurable slot kernel job idle timeout` |
| 改动文件 | `src/lib/vm/wrap-cli-runtime.mjs`（`wrapKernelWrapperScript` + `kernelEnvExports`）、`test/unit/wrap-cli-runtime.test.mjs`；运行配置 `.env`（不入库） |
| 引入日期 | 2026-09-29，基线 v1.3.80 |
| 状态 | **已下线（2026-10-09，基线 v1.3.131）**：上游 v1.3.126 原生实现且更完善——面板「重试与切号 → 流空闲超时」可配（`failover.stream_idle_timeout_ms`，默认 180s，范围 30s–60min，未配置时用 `KIN_STREAM_IDLE_TIMEOUT` 兜底），网关、`kernel.json`/`worker.json` 的 `idle_timeout_seconds` 与内核 job 看门狗共用同一值；保存后热写各槽 `kernel.json`，运行中的内核空闲时自动重启读取新看门狗值。**重要更正**：上游确认内核看门狗读的是不带前缀的 `JOB_IDLE_SECS`，本补丁导出的 `KIN_JOB_IDLE_SECS` 从未被内核读取——线上实际只有控制面 `KIN_STREAM_IDLE_TIMEOUT=660000` 那一半在生效，槽内核看门狗一直是 180s。rebase 时整个补丁 commit 丢弃，`wrapKernelWrapperScript` 取上游版（启动脚本从 `kernel.json` 读出并导出 `JOB_IDLE_SECS`），fork 测试改动同步移除。**VPS 配套操作（随 v1.3.131 部署执行）**：部署后 `PUT /api/panel/routing` 设 `{"failover":{"stream_idle_timeout_ms":660000}}` 显式接替补丁语义（热写各槽 kernel.json + 空闲内核自动重启；不设则由 `.env` 的 `KIN_STREAM_IDLE_TIMEOUT=660000` 兜底，数值效果相同）；`.env` 的 `KIN_JOB_IDLE_SECS=600` 行可删（上游不读，留着无害）；本次必须 `wrap-cli/sync`（v1.3.125 cli-node 与 v1.3.126 kin-kernel 启动脚本均变）。部署后验证改为：`docker exec kin-02 sh -c 'tr "\0" "\n" < /proc/1/environ | grep JOB_IDLE_SECS'` 应输出 660。可选：上游新增 `failover.eager_tool_streaming`（默认关）治长 Write 整段缓冲导致的静默段，先保持默认，504 复发再开 |

**动机（部署指南 §13 E 类）**：控制面 `KIN_STREAM_IDLE_TIMEOUT` 与槽内核 job 看门狗默认都是 180s 无帧即杀。超大单轮输出（43K–48K token、6–9 分钟）中出现 >180s 的静默段（最可能是 `display: omitted` 的思考）就被杀成 504 `worker_timeout`；09-29 同一请求 14 次尝试里 12 次失败。

**改动**：控制面环境变量 `KIN_JOB_IDLE_SECS`（正整数）存在时，槽内核包装脚本多一行 `export KIN_JOB_IDLE_SECS=<n>`；不设置时脚本与上游逐字节相同，不会触发重写。原因：槽内核是 kin-XX 容器的 1 号进程，只从自身环境变量读这个看门狗；`kernel.json` 是硬编码模板（`idle_timeout_seconds: 180` 且会被反复重写），建槽 `docker run` 的环境变量是固定列表——改包装脚本是不重建槽容器就能生效的唯一途径。

**配套运行配置**（写进 VPS `/opt/vm2api/.env`，不入库）：`KIN_JOB_IDLE_SECS=600`、`KIN_STREAM_IDLE_TIMEOUT=660000`。控制面的空闲超时必须**大于**内核的，让内核先发 `kin_cancel` 干净收尾，避免控制面的隐藏重发和回收槽内核。

**生效步骤**：改 `.env` → `docker compose up -d`（控制面读到新环境变量）→ `POST /api/panel/wrap-cli/sync`（重写各槽包装脚本）→ 重启槽内核（`POST /api/panel/vms/vm-02/reload` 或 `docker restart kin-02`，**会中断该槽在途请求**）。

**验证**：`docker exec kin-02 cat /home/kincli/.kin/kin-kernel` 第二行应为 `export KIN_JOB_IDLE_SECS=600`；`docker exec kin-02 sh -c 'tr "\0" "\n" < /proc/1/environ | grep KIN_JOB_IDLE_SECS'` 应输出 600。单测 `wrap-cli-runtime.test.mjs` 新增 1 条（未配置时逐字节不变、配置后仅多一行、非法值忽略）。

**取舍**：真正卡死的请求要等最多 10 分钟才失败（原 3 分钟），期间占着一个并发席位。

**合并注意（已触发下线）**：上游 v1.3.126 已提供官方开关（`failover.stream_idle_timeout_ms` + 启动脚本导出 `JOB_IDLE_SECS`），本补丁已按本条下线；上方动机/改动/生效步骤/验证段落为历史留档。

---

## 补丁 7：official UA 重放剥掉 thinking-display-updates 门禁 token（已下线，v1.3.125 上游管线重写后失效）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支 `fix(protocol): strip thinking-display-updates beta on official replay` |
| 改动文件 | `src/lib/protocol/model-policy.mjs`（`applyBetaPolicyToHeader` 的 isOfficial 分支）；测试 `test/unit/fork-thinking-display-updates.test.mjs`（fork 专用，2026-10-08 新增） |
| 引入日期 | 2026-10-08，基线 v1.3.124 |
| 部署核销 | **2026-10-08 09:20 UTC 随 `vm2api:v1.3.124-fp2` 部署**：带门禁 token + `display=updates` 的复现 curl 由 400 变 200（opus-5-5）；verify-fixes A/C/D1/D2/K2/S PASS（B 维持已知 429 形态；K1/K2 各一次 529 为直连 SDK 高峰并发占满，非回归）。回滚：override `image:` 改回 `vm2api:v1.3.124-fp1` + `git reset --keep f9edab0d` + `up -d` |
| 状态 | **已下线（2026-10-09，基线 v1.3.131）**：上游 v1.3.125 重写 beta 管线（#296/#297）——`withRequestProtocolBetas` 在 body 带 `display=updates` 时**无条件加回门禁 token**，门控经 body `betas` 通道交给槽内 CLI 构造真实请求头，且明确「不删除合法字段或换成 summarized」。所有降级判定点（`finalizeWorkerPayload` 两个分支、`prepareOutboundEnvelope`）读的都是已被重新加 token 的头，本补丁的 strip 成为空操作，rebase 时随 commit 一并丢弃（fork 测试文件 `fork-thinking-display-updates.test.mjs` 同步删除）。**根因重述**：v1.3.124 时代的 400 是槽内 CLI 用存储指纹的固定 beta 表（不含门禁 token）发 `display=updates` 所致；现在门禁 token 随请求下发、SDK 出站指纹对齐 0.128.0，订阅上游是否已接受 gated updates 源码无法证明，**须部署后实测**（带 `anthropic-beta: …,thinking-display-updates-2026-08-18` + `thinking.display=updates` 的 curl 应为 200）。若仍 400，需新补丁：cli-hop body 无条件把 `updates` 降级为 `omitted`（在 `finalizeWorkerPayload` 的 cliHop 分支重新引入 `downgradeUngatedThinkingDisplay`），并复跑本节验证 |

**动机**：上游 v1.3.111 `dc670ba1` 修 `display=updates` 100% 502 的逻辑是「出站 anthropic-beta 没有 `thinking-display-updates-2026-08-18` 门禁 token 时把 display 降级为 omitted」（`thinking.mjs` `downgradeUngatedThinkingDisplay`）。但官方 UA 客户端（Claude Code 2.1.294+）的 beta 头经 `applyBetaPolicyToHeader` 的 isOfficial 分支原样透传（`ensureOauthBeta` 保留全部客户端 token），门禁 token 在 → 降级不生效；而订阅上游（OAuth）的 schema 只认 `summarized`/`omitted`，`updates` 必被 400 `thinking.adaptive.display: Input should be 'summarized', 'omitted'` 拒。即 v1.3.111 只覆盖了"不带 token 的客户端"（curl 冒烟路径），真实 CC 仍挂。2026-10-08 08:46 UTC 线上实证：直连 claude-cli 2.1.294 两条请求（opus-4-8 / opus-5-5）均 400 `upstream_invalid_request`；同期经 NewAPI 的流量不带该 display，不受影响。

**改动**：`applyBetaPolicyToHeader` 的 isOfficial 分支在现有 context-1m 处理之前，无条件 `stripTokens(beta, [BETA_THINKING_DISPLAY_UPDATES])`。token 不在出站头里 → `downgradeUngatedThinkingDisplay` 自然把 body 的 `updates` 降级为 `omitted`，两处调用路径（cli-hop 与 sanitize 全清洗）同时受益；也避免槽内 CLI 看到门禁 token 后自行补 `display=updates`。只影响 OAuth 官方重放路径（API-key / setup-token 用固定表，本就不含该 token；非官方 mimicry 固定表也不含）。

**验证**：`node --test test/unit/fork-thinking-display-updates.test.mjs`（6 条：剥 token 且保留其余客户端 token 与 oauth 补位、默认头不含、!pass 分支同剥、非官方 mimicry 不受影响、剥后降级生效、resolveCrsHeaders 端到端）。部署后复现验证：带 `anthropic-beta: …,thinking-display-updates-2026-08-18` + `thinking.display=updates` 的 curl 应由 400 变 200。

**合并注意（历史留档）**：本节动机/改动/验证三段为 v1.3.124 基线时的记录。补丁已随 v1.3.131 rebase 下线（原因见状态行）；若部署后实测订阅上游仍拒 gated `updates`，按状态行末尾的方案另立新补丁，不要复活本补丁（strip 头在新管线里无效）。

---

## 补丁 8：lift 路径 total_tokens 提醒钉常量 + 去重（lift-budget-stabilize，active）

| 项 | 值 |
|---|---|
| commit | `fork-patches` 分支 `fix(protocol): stabilize lifted total_tokens budget blocks (fork patch 8)` |
| 改动文件 | `src/lib/protocol/sanitize.mjs`（`STABILIZED_CONTEXT_BUDGET` 导出 + `stabilizeLiftedBudgetBlocks` + `liftMidConversationSystemMessages` 后处理）、`src/lib/protocol/outbound-attempt.mjs`（`OFFICIAL_CONTEXT_BUDGET` 改引用同一常量，行为不变）、`test/unit/sanitize.test.mjs`（新增 5 条） |
| 引入日期 | 2026-10-09，基线 v1.3.133 |
| 状态 | **active**；不提 PR/issue，自维护 |

**根因（2026-10-09 线上排查，只读取证）**：Claude Code 2.1.294+ 对 opus-4-8 启用 `mid-conversation-system` beta，每轮往 `messages[]` 末尾追加一条 `role:"system"` 的 `<total_tokens>N tokens left</total_tokens>` 实时额度提醒，历史提醒全保留。opus-4-8 不匹配 `modelSupportsMidConversationSystem()` 的 5 系正则（上游有意：4.x 对话内 system 被 Anthropic 秒拒 400）→ `sanitizeAnthropicBodyForBetaTokens` 走 `liftMidConversationSystemMessages`，把所有提醒搬进顶层 `system[]`。搬移后 `system[]` 每轮多一块、最新块带实时数值，其后的缓存断点每轮落在不同前缀上 → 缓存读坍缩回 lift 前的系统头（实测钉在 ~52k），全部 messages 每轮以 1h TTL 全量重写。实测 opus-4-8 直连（rust-kernel 路径）250 条命中率 45.9%、1h 写 21.3M token（$212.61），同期 sonnet-5 134 条命中 95.2%（$5.78）。5 系不受影响：提醒原样留在 messages 尾部，前缀只增不减。cli-hop 路径有 `stabilizeSystemBudget`/`stabilizeMessageBudgets` 钉值（`prepareCliHopBody`），但 rust-kernel HTTP 直连路径（`prepareOutboundAttempt` → `prepareOutboundEnvelope` 末尾的 `sanitizeAnthropicBodyForBetaTokens`）没有这一步骤，用户直连走的正是后者。

**改动**：`liftMidConversationSystemMessages`  lift 之后对 `system` 跑 `stabilizeLiftedBudgetBlocks`：
1. 所有文本里的 `<total_tokens>\d+ tokens left</total_tokens>` 替换为官方常量 `<total_tokens>15000000 tokens left</total_tokens>`（与 cli-hop `stabilizeOfficialContextBudget` 同一值，常量化后历史块逐字节稳定）；
2. 整块（去空白后）等于该常量的块只保留第一块，其余丢弃——每轮新增的最新提醒被折叠掉，`system[]` 跨轮不变（仅钉值不去重不够：数组每轮多一块，末尾断点照样每轮移位）。
两条路径同时受益：rust-kernel HTTP（`anthropic-policy.mjs` 的 lift 调用点）与 cli-hop（`outbound-attempt.mjs`，其 stabilize 已钉值，这里再折叠重复块）。语义代价：模型看到的额度提醒恒为常量——与 cli-hop 既有行为一致，且 5 系模型上该提醒本就不影响缓存命中。

**验证**：`node --test test/unit/sanitize.test.mjs` 20/20（新增 5 条：钉值+去重、历史增长时 system 逐字节不变、非纯提醒包裹文本钉值但保留、字符串 system 钉值、无提醒体不变）。部署后验证：opus-4-8 直连多轮会话，usage_logs 的 `cache_read_tokens` 应随会话增长（不再钉在 ~52k）、`cache_creation_1h_tokens` 每轮增量应回落到接近新增内容量；对照指标 = 同会话相邻请求的读/写比。

**合并注意**：上游若把 `modelSupportsMidConversationSystem()` 放宽到 4.x（需上游 API 同步接受，否则回到 400 老问题），或在 lift 路径自带同类稳定化（查 `total_tokens`、`stabilize`、`lift` 相关改动），对照后下线本补丁。rebase 冲突点：`sanitize.mjs` 的 `liftMidConversationSystemMessages` 本体与 `outbound-attempt.mjs` 的常量定义行。
