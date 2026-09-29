# Fork 二开补丁台账

> 本文件跟踪本 fork（31Yang/vm2api）相对上游（dofastted/vm2api）的全部自定义改动，供后续合并上游新版本时对照。
> 规则：每个补丁一节；合入上游新版本后逐条核对「状态」列，上游已修的补丁及时下线。

## 分支与基线

| 项 | 值 |
|---|---|
| 上游 | `upstream` = github.com/dofastted/vm2api |
| 补丁分支 | `fork-patches`（VPS `/opt/vm2api` 当前 checkout 的分支） |
| 当前基线 | `v1.3.79`（`fork-patches` = v1.3.79 + 下表补丁） |
| 本地对应分支 | `fix/egress-self-loop`（与本机工作区同步用） |

**升级上游新版本的流程：**
1. VPS：`cd /opt/vm2api && git fetch upstream --tags`
2. `git rebase v<X.Y.Z>`（在 `fork-patches` 分支上；冲突按下面各补丁节的「合并注意」处理）
3. 涉及 Go 二进制（`bin/kin-egress` 等）的补丁：按对应补丁节重编，替换 `bin/*.patched`，重启控制面
4. 控制面升级本身照上游 CHANGELOG 的「已部署机升级」段落走（`.env` 改 tag → `docker compose pull && up -d` → 必要时 `wrap-cli/sync`）

---

## 补丁 1：kin-egress 自回路守卫（active）

| 项 | 值 |
|---|---|
| commit | `fix/egress-self-loop` 分支 HEAD（VPS `fork-patches` 同名 commit） |
| 改动文件 | `worker/internal/egress/server.go`、`worker/internal/egress/server_test.go` |
| 引入日期 | 2026-09-22，基线 v1.3.21 |
| 状态 | **active**；2026-09-29 核对：v1.3.74→v1.3.79 上游未动 `worker/internal/egress`（`server.go` 零 diff）、`bin/kin-egress` 未随 tag 变化，无需重编，`bin/kin-egress.patched`（v1.3.74 基线产物）继续有效；上游仍无 `loopsToSelf` 同类防护（`sameHostPort` 旧守卫不覆盖本回路），补丁保留；建议提 issue/PR |

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
| 状态 | **active**；建议提 PR 回上游 |

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

**合并注意**：上游若给 pool_unavailable 原生带 retryAfterSec/reset_at（查 `handle-protocol.mjs` 的 retryAfterSec 放行条件、`errors.mjs` 的 `poolClientError`），本补丁整条下线；rebase 冲突集中在 `selectionSnapshot` / quota gate / `poolClientError` 三处。
