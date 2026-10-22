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

已执行 Windows / Node 22 专项：

```text
node --test test/unit/min-max-tokens.test.mjs test/unit/cli-hop-body.test.mjs test/unit/sanitize.test.mjs test/unit/jev-intercept.test.mjs test/unit/go-worker-client.test.mjs
```

- 准备分支：139 tests，98 pass / 6 fail / 35 skip。
- 纯净 v1.3.209：125 tests，89 pass / 6 fail / 30 skip。
- 两边 6 个失败用例名称完全一致，均为上游 v1.3.209 TTL 断言与实现不一致；fork 新增 14 个测试全部通过或按 Unix 平台口径跳过。

待执行：全量 Windows unit 与纯净基线逐文件比对、Linux/镜像内 unit、Go race、gofmt、Web build、格式检查、payload fetch 校验。上述完成并复核后才可请求用户执行强推与部署。
