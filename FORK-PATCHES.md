# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `v1.3.218`（2026-10-23，`d7eef6a0`） |
| 线上前基线 | `v1.3.217-fp1`（运行时提交 `624dae97`；补丁 3/4/9；迁移至 042） |
| 本地准备分支 | `fork-patches-v1.3.218-prep`，保留补丁 3/4/9 |
| 保护点 | `pre-rebase-13209-fp3`；v1.3.218 纯净 worktree `../vm2api-v1.3.218-baseline` |
| 本地候选镜像 | `vm2api:v1.3.218-fp1-prep` = `sha256:71837f656d93afba4e713e999100eb5299ef145e22d64dcee3a8f6ec6c2c721a`（647,244,269 bytes）。纯净对照 = `sha256:4a7f18c120f42df128b4cf63a0aa0cd06d6ea46fface3dbd488692daf8c47122` |

## v1.3.217→218 变化

1. 上游移除官方 Claude/Codex passthrough，恢复 v1.3.209 式 cli-hop 重写与 kernel persona。
2. `officialMessageMarker` 恢复双 message 断点：最后一条 user 与上一条 user（4 条消息起），避免 messages 缓存读锁在 system+tools 前缀。
3. 只需更新 Node 控制面与 `web/dist` 后重启；无迁移、无新依赖、payload 不变、不必 wrap sync、不必重建槽。
4. 不覆盖 `routing.json`、`vms/`、`data/`、`.env`。

## Active patches

### 补丁 3：cli-hop 小 max_tokens 保底

- 保留显式小预算 1024 保底；显式 thinking 请求提升到 4096。
- v1.3.218 rebase 冲突位于官方 passthrough 移除区；已移除 passthrough，保留本补丁。

### 补丁 4：cli-hop 输出上限与超长上下文错误语义

- 保留。输出上限恢复逻辑合入 v1.3.218 `streamGoWorker`，保留 envelope 日志、thread beta 与 openBlocks 行为。
- Linux 专项通过，覆盖 Unix socket 流式行为。

### 补丁 9：硬正则否定/防御语境豁免

- 保留。上游仍无等价防御语境豁免；语义限定同一短句与近距离后缀。
- 专项通过，直接破限仍拦截。

## Retired patches

| 补丁 | 下线版本 | 结论 |
|---|---:|---|
| 1 egress 自回路 | v1.3.123 | 上游原生 self-destined guard 覆盖 |
| 2 quota retry-after | v1.3.123 | 上游原生 retry-after 覆盖 |
| 5 idle watchdog | v1.3.126 | 上游 `stream_idle_timeout_ms` / `JOB_IDLE_SECS` 覆盖 |
| 7 thinking-display token | v1.3.125 | 上游 beta/body 管线重写后失效 |
| 8 lift total_tokens 钉值 | v1.3.209 | 上游稳定官方 system/messages 前缀与 lift 模型，覆盖原目标 |

## 验证结论

- 专项：纯净 v1.3.218 `126 tests / 96 pass / 30 skip / 0 fail`；fork `140 tests / 105 pass / 35 skip / 0 fail`。
- Windows 全量：fork 与纯净 v1.3.218 均为 `36/283` 个失败文件，集合逐项一致，均为既有平台口径。
- Linux 镜像内全量：fork 与纯净均为 `10/283` 个失败文件，集合逐项一致，均为本机镜像无 Docker daemon/外网或 `wrap-cli-runtime` 超时口径。
- Go race 全部通过；Web Prettier/build 通过；Web Vitest `63 files / 489 tests` 全部通过。
- 候选镜像 `VERSION=1.3.218`；`kin-kernel=8f1347cc…`、`kin-computer=a6497083…`、`kin-worker=26b1acf8…`、`cli-node=b5054cb8…` 与 manifest 一致。
- `npm audit --omit=dev` 仍有上游 `socks-proxy-agent -> socks -> ip-address@10.5.0` moderate，未额外改依赖。

## 部署门槛

1. VPS 最近 5 分钟业务请求为 0；若非 0，等待短空窗。
2. 保留/备份 live routing、distill rules、`.env` 与 rollback compose；创建面板一致性备份。
3. `git fetch origin` 后用 `git reset --keep origin/fork-patches`，不得覆盖 live 配置。
4. 从纯净 `git archive origin/fork-patches` 构建 `vm2api:v1.3.218-fp1`，切换后 `up -d --no-build`。
5. 验收 health、双槽状态、迁移仍至 042、verify-fixes 默认用例、公网 401/200、真实小请求和 15 分钟观察。
