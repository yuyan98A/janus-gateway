# Google Antigravity 算力池汇总窗口查询

更新：2026-10-19。用户在对比模型配额与算力池窗口两种口径后，明确要求切换为算力池汇总窗口。此前“取消跨账号合并”的要求继续有效。当前实现以本文与 `src/providers/google/client.ts` 为准。

**当前结论**：已按 CPA 官方管理页的固定源码快照对齐查询策略：daily 优先、Hub User-Agent、按有效分组顺序回退。旧实现硬编码 production，且旧 User-Agent 在 daily 下会漏掉 Gemini 组；两者共同导致错误的满额展示。历史诊断与 production 透传验证保留在后文，不代表当前实现。

## 当前机制

默认逐个查询已启用、未失效且具有 refresh token 的账号；支持按账号 ID 或邮箱只查询单账号。账号池、OAuth 换票与项目发现沿用现有实现。

每个账号并行读取：

- daily `loadCodeAssist`：查询该账号套餐，优先 paidTier.id，回退 currentTier；失败不影响额度读取。
- `retrieveUserQuotaSummary`：请求体 `{ project: projectId }`，读取账号自己的 `groups[].buckets[]`。

汇总端点依次为 `https://daily-cloudcode-pa.googleapis.com` → `https://daily-cloudcode-pa.sandbox.googleapis.com` → `https://cloudcode-pa.googleapis.com`，RPC 均为 `/v1internal:retrieveUserQuotaSummary`。HTTP/网络失败、缺少 groups 或解析后没有有效分组时才继续；第一个非空有效分组集合立即返回，即使只有 Claude 组也不再补查其他环境。不合并跨端点数据，不用模型目录 quotaInfo 填充窗口。响应 endpoint 记录实际采用的环境；production 只是 CPA 兼容回退，不保证与 daily 推理余额一致。

配额与套餐请求都使用独立的精简头：Authorization Bearer、Content-Type application/json、`User-Agent: antigravity/hub/2.23.0 darwin/arm64`。此固定身份来自 CPA，并非按本机平台生成；不改变推理请求头。实现常量与解析位于 `src/providers/google/quota.ts`，查询编排位于 `client.ts`。每次上游请求各有 15 秒超时，最坏情况下汇总顺序回退约 45 秒。管理响应 `Cache-Control: no-store`，每次查询直读上游。

常见组为 `Gemini Models`、`Claude and GPT models`，窗口为 `5h` 和 `weekly`。仅展示上游实际返回的组和窗口；不补造缺失组、模型名或重置时间。

## 接口和数据

入口保持：

- `GET /v1/admin/google/quota`
- `GET /v1/admin/google/quota?accountId=<id-or-email>`（兼容 account 参数）
- `GET /v1/admin/google/accounts/<id-or-email>/quota`
- `npm run account:quota`，单账号查询追加 `-- <id-or-email>`

响应为 `{ object: 'google_quota_report', checkedAt, accounts: [...] }`。每个账号携带：

- id、email、label、projectId、status、checkedAt，及可选套餐 subscription。
- `source: 'retrieveUserQuotaSummary'`、`endpoint`（实际采用的 daily、sandbox 或 production 源站）。
- 可选上游 description、serverTimeOffsetMs。
- `groups: [{ displayName, description?, buckets: [...] }]`。
- 每个 bucket 含 bucketId、displayName、window、remainingFraction、remainingPercent、available、可选 resetTime。

不返回跨账号 summary、bestSubscription 或各窗口最大值；界面、CLI 均按账号独立展示算力池与窗口，详情保留上游说明。

比例规则：

- 支持 camelCase/snake_case 字段、JSON body 包装、数值/非空数字字符串/百分数字符串；保留 fraction，百分比保留两位小数。
- 缺失、null、空字符串、布尔值、非数字和越界值的桶被过滤；没有有效桶的组被过滤，绝不补成 100%。本项目额外严格要求比例在 0～1 内；CPA 原解析器不在此阶段做范围校验。
- 0% 保持 0，available=false；正值可用。无效窗口不参与可用性推断。
- 同组 weekly 为 0 时，正余额的 5h 窗口 available=false，但保留其上游百分比，并提示“周额度已耗尽”。5h 有余额不要求等于 100%；该字段仅为展示提示，不参与推理调度。
- 三个端点都没有有效分组，但至少一次 HTTP 成功时，按 CPA 返回 status=ok、groups=[]，界面/CLI 明确提示“上游未提供有效算力池窗口，配额未知”。所有端点都 HTTP/网络失败才返回 status=error；单账号错误不影响其他账号，错误脱敏且不返回凭据。
- resetTime 只保留有效上游时间；倒计时使用 HTTP Date 计算的时钟差，不因重置时间已到就自行恢复成满额。

配额查询不发起模型推理，也不改变粘性账号调度。算力池订阅窗口与模型级配额是不同查询口径，不能互相推导。

## 当前实现验证（2026-10-19）

- 定向回归已通过：Hub 请求头、daily 优先、HTTP/网络/空数据的三级回退、部分分组立即返回、不跨环境补组、零值与非法值过滤、snake_case/百分比/包装解析、套餐失败隔离、逐账号展示及首页/账号表/详情脚本。
- `npm test` 全部通过，包含窗口定向回归、账号池和真实网关 22/22；`npm run test:reasoning` 的 Google/Codex 两套回归通过。零停机排空测试中的在途流正常完成。
- `npm run account:quota` 真实读取两个账号，两者均有 Gemini、Claude/GPT 的周/5h 窗口。账号 A 的 Gemini 周额度 19.18%、5h 87.07%；账号 B 为 84.36%、99.89%。均为查询时快照，不是固定余额。
- `npm run reload` 平滑热更新成功，交接时存在 1 个在途请求；随后 `/health` 返回新 Worker PID 79736、cluster-worker、status=ok，未执行强制停止或重启。
- 2026-10-19T13:41:52Z 运行中管理 API 复核：两个账号 endpoint 均为 daily，source=retrieveUserQuotaSummary；Gemini 百分比与 CLI 一致，各自返回两组两个窗口，没有跨账号 summary，Cache-Control=no-store。
- 首页、账号表与详情使用真实前端脚本的 VM 回归覆盖，包括非满额、0%、周额度阻断、空分组未知态、倒计时偏差和离线清除旧读数。本轮未另行执行浏览器交互验收；下文浏览器记录属于旧版历史验证。
- `git diff --check` 通过。未运行完整 CPA 服务；对齐依据是下文固定源码与同 token/项目的直接上游对照。本轮只改额度/套餐查询，不更换推理请求身份。

## 历史口径与证据

2026-10-19 早先对同账号、同项目实测：production 汇总接口返回 Gemini 100%，daily 模型接口返回 Gemini 约 22.68%，另一个账号为 100%。此前按用户“配额不符”反馈切换到 daily 模型配额，并取消跨账号取最大值；当时 API/CLI/浏览器及 22 项网关回归已验证，随后模型值约 22.46%。

本轮用户明确选择算力池汇总窗口，因此以上模型配额方案及其显示方式已被当前方案替代。保留端点差异证据，不宣称汇总窗口百分比等于模型百分比；用户并未要求恢复多账号合并。

## 历史：production 汇总切换验证（2026-10-19）

- 定向 `tests/test-google-quota.ts` 已通过：production 汇总请求、双账号独立数据、5h/weekly、周额度阻断、未知/零/非法字段、刷新、单账号筛选、部分缺组、错误隔离和脱敏，以及首页/账号表/详情的实际脚本执行。
- CLI 真实查询成功：两个启用账号均返回 Gemini 和 Claude/GPT 两组，各含 weekly/5h；账号 A 的 Claude/GPT 周窗口约 99.65%、5h 约 99.92%，账号 B 相应窗口为 100%；Gemini 汇总窗口为 100%。数值随查询时间变化。
- `npm test` 全部通过，包含更新后的窗口定向回归及真实网关 22/22；`npm run test:reasoning` 两套回归通过，`git diff --check` 通过。
- `npm run reload` 平滑热重载完成，新 Worker PID 51544，健康检查正常。运行中 API 已返回 source=retrieveUserQuotaSummary、各账号两组各两个窗口且没有跨账号 summary；代表值与 CLI 一致。
- Edge 实际验证账号表与算力池详情弹窗，Gemini、Claude/GPT 的周/5h 窗口及重置时间均显示正常，浏览器错误日志为空。首页渲染由定向脚本执行回归覆盖。

## 100% 异常诊断（2026-10-19，同日后续）

本次只做诊断，不修改已部署查询逻辑，不发起推理或服务热重载。对同一启用账号使用同一 access token、同一 project，直接访问上游绕过网关；两端 loadCodeAssist 返回的项目均与网关项目一致。

| 查询 | cloudcode-pa | daily-cloudcode-pa |
|---|---|---|
| retrieveUserQuotaSummary 的 Gemini 组 | weekly=1、5h=1 | 没有返回该组 |
| fetchAvailableModels 的代表 Gemini 模型 | fraction=1 | 首次 fraction=0.20860223（20.86%） |
| retrieveUserQuota 的同一 Gemini 模型 | fraction=1 | fraction=0.20860223，与同端模型目录一致 |

第二轮读取 daily 的两个模型接口均返回 0.21210073（21.21%）；不同时刻存在上游读数变化，但每轮两个接口一致，production 仍为 1。这里不把某次百分比当作恒定余额。

关键排除与观察：

- 100% 是上游明确返回的 remainingFraction=1，不是前端舍入或本地补值。
- 同一 host 下模型接口和汇总接口的读数相符；跨 host 才出现显著差异。网关实际推理默认使用 daily，而现有汇总查询硬编码 cloudcode-pa，是当前展示与推理余额错配的直接原因。
- 连续两次读取间隔约 6～7 秒，production Gemini 的 resetTime 也相应后移 6～7 秒，始终约等于当前时刻+5h/+168h；Claude/GPT 已消耗窗口的 resetTime 保持固定。这是未消耗/默认窗口的表现，不能证明 Google 内部具体计量表的实现或最终一致性机制。
- 使用原网关请求头及精简、IDE、CLI 三种旧 User-Agent 对照，均未改变 production Gemini 满额、daily 汇总缺少 Gemini 组的结果。该组实验没有覆盖 Hub User-Agent；后续 CPA 对照已发现其能消除 daily 缺组，不能据此断言请求头无影响。
- 加 no-cache 直接读上游、读取每次新的 Date、绕过网关后仍复现；因此清空网关模型缓存无法解决这一不一致。

当次结论：上一轮“为拿到完整两组就用 production 汇总”的选择不成立，不能仅以“汇总与模型口径不同”解释。汇总查询应对齐推理环境；若仍缺组，应显示未提供，不能跨环境借用 100% 或把模型比例编造成窗口。后续已找到 daily 返回完整组所需的 Hub 请求头，见下节。

外部交叉证据：OmniRoute 作者的 [同类端点错配调查 #8965](https://github.com/diegosouzapw/OmniRoute/issues/8965) 对同 token、同项目、同 RPC 更换 host 观察到不同额度，且 IDE/CLI profile 未改变结论；该项目已通过 [修复提交 a76bee9](https://github.com/diegosouzapw/OmniRoute/commit/a76bee9f3ebf3c93aa83faaa1ef85b6a0c0d76d3) 将额度查询切换到运行时端点队列。本地缺失 Gemini 组的现象仍以本次直接查询为准。

## CLIProxyAPI 官方实现核查与 Hub 对照（2026-10-19）

核查对象为官方仓库 main 的固定快照：后端 CLIProxyAPI `e7d4c7316fca3fe0e852866f4e611cb4f2fa0764`；管理页 Cli-Proxy-API-Management-Center `fe2963330f32a933f562282165f62ae52cf57145`。源码副本放在忽略版本管理的 `_temp/cpa-reference-*-20261019/`，未运行完整 CPA 服务。

### 实际职责和调用链

- 管理页的 `src/features/quota/providers/antigravity/data.ts` 组织按凭据的额度请求，解析 groups；后端 `internal/api/handlers/management/api_tools.go` 提供通用 APICall，解析 auth_index、按需刷新 OAuth、把 `$TOKEN$` 换成 access token 后转发，返回上游 status/header/body。当前 v8 管理路由为 `/v8/management/requests/api-call`，后端也保留 v0 `/v0/management/api-call`。
- 项目编号优先取凭据顶层 project_id/projectId，再取 metadata、attributes，最后尝试下载该凭据 JSON 的顶层/installed/web 项目字段；找不到则报错，不用空项目查询。
- `src/utils/quota/constants.ts` 指定汇总请求顺序：daily → daily sandbox → production，均调用 `retrieveUserQuotaSummary`，请求体 `{ project: projectId }`。
- 请求头是 `Authorization: Bearer $TOKEN$`、`Content-Type: application/json`、`User-Agent: antigravity/hub/2.23.0 darwin/arm64`。此值来自代码，不是按运行机器自动选择 Windows UA。
- 对 HTTP 非 2xx、缺少 groups 或解析后零有效分组继续下一端点；一旦有非空有效分组就返回，不要求 Gemini 和 Claude 两组齐全，也不把不同端点的组进行合并。
- `buildAntigravityQuotaGroups` 支持 camelCase/snake_case 字段、数值/数字字符串/百分数字符串；比例无法解析的桶被过滤，零值保留；组内桶按 window 排序，periodHours 从明确的 window 映射。没有有效桶的组被过滤。
- 套餐信息并行调用 daily `loadCodeAssist`，paidTier.id 优先于 currentTier；失败时 subscription=null。响应 Date 用于前端时钟偏差与倒计时。
- `labels.ts` 中 `remainingFraction===1` 只决定是否显示“额度可用”文案，`AntigravityQuotaBody.tsx` 对其他值仍展示百分比；它不是判定“99% 的窗口不能调用”的准入条件。
- `antigravity_executor_credits.go` 查询的是 `loadCodeAssist` 的 paidTier.availableCredits，用于积分余额和耗尽重试；不是管理页的订阅百分比查询实现。当前管理页这条汇总调用链也没有用 fetchAvailableModels 补全缺组。

### 本地真实对照（同 token、同项目）

直接从所核查的 CPA 管理页 constants.ts 导入请求头和端点常量，访问 Google（没有经过 CPA 服务）。第一账号得到：

| 端点与请求头 | Gemini weekly | Gemini 5h |
|---|---|---|
| daily + 当前网关旧 UA | 无 Gemini 组 | 无 Gemini 组 |
| production + 当前网关旧 UA | 1 | 1 |
| daily + CPA Hub UA | 0.19694549（19.69%） | 0.89862764（89.86%） |
| production + CPA Hub UA | 1 | 1 |

daily Hub 返回的 Gemini 周窗口 resetTime=2026-10-24T10:19:57Z，5h resetTime=2026-10-19T17:27:10Z；其 Claude/GPT 周/5h 分别为 0.996328 和 0.9988728。均为本次查询快照，不是恒定余额。

进一步单变量验证：保留全部网关原有头，只将 User-Agent 换成 Hub 值，即返回完整 Gemini 组和相同比例；保留 CPA 精简头但将 UA 换回网关旧值，则 Gemini 组消失。由此确认 UA 差异直接影响本账号 daily 汇总的字段集合，不是其他额外头的影响；未进一步拆分 Hub 产品名、版本和平台各子串的独立作用。

**已确认应对齐的两项是 daily 运行端点与 Hub User-Agent**。仅换接口名、仅换端点或清空缓存均不足以复现 CPA 在本账号上的完整汇总查询。该核查阶段当时只查询和记录；用户随后要求“按照他的改”，现已落实为本文开头的当前实现。

固定源码入口：[端点与请求头常量](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/fe2963330f32a933f562282165f62ae52cf57145/src/utils/quota/constants.ts)、[按凭据查询与回退](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/fe2963330f32a933f562282165f62ae52cf57145/src/features/quota/providers/antigravity/data.ts)、[分组解析](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/fe2963330f32a933f562282165f62ae52cf57145/src/utils/quota/builders.ts)、[后端 APICall](https://github.com/router-for-me/CLIProxyAPI/blob/e7d4c7316fca3fe0e852866f4e611cb4f2fa0764/internal/api/handlers/management/api_tools.go)。
