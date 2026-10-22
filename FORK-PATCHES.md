# Fork 二开补丁台账

> 本文件只保留当前有效结论与下一次升级必需信息；完整历史动机、部署过程和旧测试数据看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `upstream` = github.com/dofastted/vm2api，最新核对 tag `v1.3.209`（2026-10-22，`f65fb98e`） |
| 线上基线 | `v1.3.199-fp3`（2026-10-20 02:07 UTC 起；运行时提交 `8780ee14`，后补文档到 `f90d4b25`；补丁 3/4/8/9） |
| 本地准备分支 | `fork-patches-v1.3.209-prep`：已 rebase 到 v1.3.209，仅保留补丁 3/4/9；补丁 8 由上游 v1.3.203-209 覆盖下线。**未强推、未部署** |
| 保护点 | `pre-rebase-13209-fp3` = rebase 前 `fork-patches`（`f90d4b25`）；纯净基线 worktree `../vm2api-v1.3.209-baseline` |
| 补丁策略 | 默认不提 issue/PR，长期自维护；上游已覆盖时随 rebase 下线 |
| 本地候选镜像 | `vm2api:v1.3.209-fp1-prep` = `sha256:6f5d2dc209f1560dd1dcd4a7f57c34f99d454f283887b76242d0c51a3de27ea2`（647,164,617 bytes；`VERSION=1.3.209`）。纯净对照镜像 `vm2api:v1.3.209-baseline-local` = `sha256:3be59db88dd50017a9611ee6083967d4b05dbd617653812d54a1f5664ba091f7`。两者均仅在本机 Docker，未推送/未加载 VPS |

## 升级要点（未部署）

1. v1.3.199→209 跨过 `039_cluster_node_direct_links`、`040_cluster_node_platform`、`041_usage_logs_inbound_device` 三个迁移。迁移会改 SQLite 结构，回滚旧镜像前必须恢复备份，不能只退镜像。
2. v1.3.200 更新 `deploy/payload.json` 到 `payload-2026.10.19-kernel-cli`：`kin-kernel` 与 `cli-node` 哈希变化，部署后必须确认自动 wrap sync 成功（当前应显示 2/2），并核对两个槽内 payload 哈希。
3. v1.3.209 需要更新控制面、`web/dist` 与 `bin/kin-worker`；遥测默认上传间隔变为可配置（默认 10 分钟），旧 worker 仍按 10 秒上传，换 worker 或重写 `worker.json` 后才生效。
4. 本实例未使用扩展集群节点；`039/040` 迁移与 `kin-slot-gate` 新二进制默认不改变本机槽行为。不要启用 direct-link。
5. 官方 OAuth 登录、遥测页、种子配置、thinking/cache 规则在上游大幅重构；部署后需用 verify-fixes 与真实直连会话复核，不能只看 health。
6. 旧 git 历史导致 `git fetch upstream --tags` 对 v1.3.74 前本地 tag 报 `would clobber existing tag`。不要强制覆盖旧 tag；新版本可读 `upstream/main` 与新 tag。

## Active patches

### 补丁 3：cli-hop 小 max_tokens 保底

- 动机：小预算探测/分类请求在 wrap CLI 撞 `max_tokens` 后被变成致命错误，导致 502 与原样重试。
- 文件：`src/lib/protocol/outbound-attempt.mjs`、`test/unit/cli-hop-body.test.mjs`、`test/unit/min-max-tokens.test.mjs`。
- v1.3.209 裁决：保留显式小预算 1024 保底；thinking 请求提升到 4096。上游 v1.3.209 不再给普通请求自动填 thinking，因此无 thinking 的 64/128 请求只保到 1024，测试已按新语义更新。
- 验证：`min-max-tokens` 与 fork 新增 `cli-hop-body` 用例通过；`cli-hop-body` 余下 6 个失败与 v1.3.209 纯净基线完全一致（上游 TTL 测试预期未跟上实现）。

### 补丁 4：cli-hop 输出上限与超长上下文错误语义

- 动机：wrap CLI 将上游 `stop_reason=max_tokens` 变成 fatal error；上下文超长也被折叠成空 hop，客户端无法触发压缩。
- 文件：`src/lib/protocol/stream-error-status.mjs`、`src/lib/transport/go-worker-client.mjs`、对应测试。
- v1.3.209 裁决：保留。超长上下文识别放进上游新的 `stream-error-status.mjs`；流式输出上限恢复逻辑合入新 `streamGoWorker`，同时保留上游 envelope 日志回调、thread beta 记录与 openBlocks 观测。
- 验证：Windows 下 Unix socket 流式用例按既有口径 skip；Linux 全量或镜像内测试仍待跑，不能只用 Windows 结果结案。

### 补丁 9：硬正则否定/防御语境豁免

- 动机：安全/权限文档中的“不能绕过、禁止绕过”被低语境硬正则只按“绕过”命中。
- 文件：`src/lib/protocol/jev-intercept.mjs`、`test/unit/jev-intercept.test.mjs`。
- v1.3.209 裁决：上游仍无等价防御语境豁免，完整保留；语义仍限定同一短句与近距离后缀，不能跨句全局放行。
- 验证：专项用例通过；直接破限样本仍拦截。

## Retired patches

| 补丁 | 下线版本/时间 | 结论 |
|---|---:|---|
| 1 kin-egress 自回路守卫 | v1.3.123 / 2026-10-08 | 上游原生拒绝 self-destined connection，源码与测试随 rebase 移除 |
| 2 quota 503 retry-after | v1.3.123 / 2026-10-08 | 上游原生 retry-after 与限额重置覆盖 |
| 5 空闲看门狗 600s | v1.3.126 / 2026-10-09 | 上游 `failover.stream_idle_timeout_ms` 与 `JOB_IDLE_SECS` 链路覆盖；线上为 660s |
| 7 thinking-display-updates 剥 token | v1.3.125 / 2026-10-09 | 上游 beta/body 管线重写后补丁失效；后续已实测 gated updates 可用 |
| 8 lift total_tokens 钉值/去重 | v1.3.209 / 2026-10-22 | 上游 v1.3.203-209 已稳定官方 system/messages 前缀、钉值动态预算并覆盖 lift 模型；纯净 v1.3.209 相关用例覆盖原目标，fork 源码与专用测试随本次 rebase 移除 |

## 当前验证状态

Windows / Node 22 专项：

```text
node --test test/unit/min-max-tokens.test.mjs test/unit/cli-hop-body.test.mjs test/unit/sanitize.test.mjs test/unit/jev-intercept.test.mjs test/unit/go-worker-client.test.mjs
```

- 准备分支：139 tests，98 pass / 6 fail / 35 skip。
- 纯净 v1.3.209：125 tests，89 pass / 6 fail / 30 skip。
- 两边 6 个失败用例名称完全一致，均为上游 v1.3.209 TTL 断言与实现不一致；fork 新增 14 个测试全部通过或按 Unix 平台口径跳过。

全量与构建：

- Windows 全量 unit：准备分支与纯净 v1.3.209 均为 **37/273 个失败文件，且文件集合逐项完全一致**；无 fork 回归。失败集合仍以 Windows 平台权限/路径/Unix socket/Docker 环境为主，另含上游 TTL 断言问题。
- Linux 镜像内全量：准备分支与纯净 v1.3.209 均为 **13/273 个失败文件，且文件集合逐项完全一致**（`api-backend`、`cli-hop-body`、`convert-cache-shape`、`docker-control-image`、`egress`、`fleet-update`、`oauth-binary`、`official-cc-bootstrap`、`proxy-agent`、`proxy-ipv6`、`release`、`session-oauth-seam`、`wrap-cli-runtime`）。`wrap-cli-runtime` 在两边均 120 秒超时；其余多为镜像内无 Docker daemon/外网或上游 TTL 断言问题。无 fork 回归。
- Linux 补丁专项：`go-worker-client + min-max-tokens + jev-intercept` 共 92/92 通过，覆盖补丁 4 的 Unix socket 流式行为、超长上下文语义、补丁 3 与补丁 9。
- Go：`golang:1.25` 容器 `go test -race ./...` 全部通过；`gofmt -l /src/worker` 无输出。宿主机未安装 Go，`npm run test:go` / 组合 `format:check` 不能原生执行。
- 格式与前端：Biome 通过；Web Prettier 通过；Web build 通过；Web Vitest 60 files / 473 tests 全部通过。必须按上游文档用 pnpm 10（本次 pnpm 10.34.7）；误用 pnpm 12 会忽略/删除 package.json 的 `pnpm.overrides`。
- Payload：本机 `fetch:payload` 直连超时；经 `curl --proxy http://10.10.250.250:10250` 下载后 `npm run fetch:payload -- --check` 通过（`payload-2026.10.19-kernel-cli`，12 files）。Docker build 的 payload stage 亦通过。镜像内 `kin-kernel=8f1347cc…`、`cli-node=b5054cb8…` 与 manifest 一致。
- 依赖：`npm audit --omit=dev` 报 1 个 moderate（`socks-proxy-agent -> socks -> ip-address@10.5.0`）。上游 v1.3.209 未处理；本次不额外引入依赖补丁，部署评审时单独确认。

## 部署前剩余门槛

1. v1.3.209 纯净基线自带 `cli-hop-body` TTL 断言错误，Linux/Windows 两端均复现。可选择等待上游修正后重评，或在本 fork 增加纯测试修正；当前准备分支未替上游修测试。
2. Linux 镜像内 `wrap-cli-runtime` 在纯净与 fork 基线均超时。虽然集合一致，部署前应在具备完整测试环境的 Linux 主机或后续上游修复后复跑一次。
3. 用户审阅 `fork-patches-v1.3.209-prep` 后，由用户按 lease 强推；代理不得推送。
4. 获得明确部署指令后，才按 VPS 备份 → 停写/低峰 → 更新镜像 → 迁移 039/040/041 → wrap sync 2/2 → verify-fixes → 真实流量复核 → 回写文档执行。**当前未部署。**
