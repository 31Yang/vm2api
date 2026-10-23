# Fork 二开补丁台账

> 只保留当前有效结论与下一次升级必需信息；完整历史看 git history 与 `../vps/vm2api-部署指南.md`。

## 基线

| 项 | 值 |
|---|---|
| 上游 | `v1.3.218`（2026-10-23，`d7eef6a0`） |
| 线上基线 | `v1.3.218-fp1`（2026-10-23 01:33:45 UTC 起；运行源码/远端 `7013c520`；补丁 3/4/9；迁移至 042） |
| 准备分支 | `fork-patches-v1.3.218-prep`，保留补丁 3/4/9 |
| 保护点 | `pre-rebase-13209-fp3`；v1.3.218 纯净 worktree `../vm2api-v1.3.218-baseline` |
| 镜像 | 本机候选 `vm2api:v1.3.218-fp1-prep` = `sha256:71837f65…21a`；VPS 运行 `vm2api:v1.3.218-fp1` = `sha256:119df3deb26abfde75991fc0a2dfc31dbaababc0a8df42d4e069ed81532d02d5`（854,694,197 bytes）。纯净对照 = `sha256:4a7f18c1…122` |
| 备份/回滚 | 面板备份 `bak_d36e06b608e8`（10,471,304 bytes，SHA256 `97efb6d2…8808`）；保护目录 `/home/ayang/pre13217-to-13218fp1.20261023T012705Z/`；旧镜像 tag `vm2api:v1.3.217-fp1-rollback-13218fp1` |

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

## 2026-10-23 部署结论

1. 用户明确要求立即部署，未等待业务空窗；切换窗口既有业务请求均 200，无 5xx。
2. 01:33:45 UTC 切换 `vm2api:v1.3.218-fp1`；槽容器未重启，无迁移/wrap sync/payload 变化。启动后自动移除废弃 `codex.official_passthrough` 键，routing SHA256 `4197add1…c06d`，distill 保持 `97a1b693…e2b0`。
3. health OK，迁移最高 042；vm-01/vm-02 native kernel healthy，ready_slots 20/19，credential fresh。
4. verify-fixes A/C/D1/D2/K1/K2/S 全 PASS；K1/K2 出站均为 system 2 点 + user 2 点，共 4 个 1h 断点。
5. 公网 models 无 key 401、带 key 200 且 23 个模型。控制面启动期仅 bridge-heal 重建两个 egress helper，无 kernel restart/OOM。
6. 01:33:45–01:48:45 UTC 观察 15 分钟无 OOM/fatal/panic/kernel restart/5xx；97 条 200、46 条 429（37 条为 `ysg` key 并发 4 本地限流），`HPE_INVALID_EOF_STATE` 为客户端提前断开/重试。清理 4.453GB build cache 后根分区可用 8.7G。
