# Google 专线 effort 档位转换设计

状态：已实现请求转换、管理探测保存与模型元数据；三个代表模型已完成首批真实 PA 参数探测，见[实测记录](./Google_effort测试与PA探测_2026-10-09.md)。日期：2026-10-09。当前接口行为以 [Google 思考强度 API](../api/Google思考强度API.md) 为准。

用户已明确要求：Google 专线也应实现思考强度档位转换。本文件保留设计依据与候选映射；实现已采用其中的双入口转换、按模型能力、冲突校验和账号作用域规则。具体 PA 参数仍未实测。

## 1. 目标与现状

目标：使用 Anthropic Messages 的 `output_config.effort` 或 OpenAI Chat Completions 的 `reasoning_effort` 时，Google 路由生成明确的 PA 思考配置；保留旧式 Anthropic 预算请求，保证双入口的同一档位转换一致。

现状依据：

- `src/providers/google/request-builder.ts` 只把非零 `thinking.budget_tokens` 复制到 `request.generationConfig.thinkingConfig.thinkingBudget`，不读取 effort，也没有按 `thinking.type` 判断关闭/自适应。
- `src/providers/google/client.ts` 的 OpenAI 适配器只从内部 `options.thinkingBudget` 注入预算，未处理 `reasoning_effort`。
- `src/router/dispatcher.ts` 的 reasoning 校验仅作用于 Codex。Google 的模型测试可以内部传入最低预算，但这不是公开客户端的 effort 能力。
- 模型发现保留 `supports_thinking`、`thinking_budget`、`min_thinking_budget`，尚无已验证档位表、预算上限或 level 能力。

首个交付范围：请求解析、按模型转换、参数校验、双入口接入、模型能力呈现、PA 探测与诊断。工具签名往返、非流式内容块汇总等问题另行处理；思考强度设置不能作为这些功能已经正确的证据。

## 2. 协议依据与证据边界

本项目上游仍为 Cloud Code PA `v1internal:streamGenerateContent?alt=sse`。Google 公开 GenerateContent 定义了 `thinkingConfig.thinkingBudget` 和 `thinkingConfig.thinkingLevel`；这两种控制方式不能凭模型名直接认定在 PA 可用。

- [Google GenerateContent ThinkingConfig](https://ai.google.dev/api/generate-content#ThinkingConfig)：公开 REST 结构含 `includeThoughts`、`thinkingBudget`、`thinkingLevel`，level 枚举包含 MINIMAL / LOW / MEDIUM / HIGH。
- [Google GenerateContent 思考配置指南](https://ai.google.dev/gemini-api/docs/generate-content/thinking)：公开协议区分模型的 level 与预算能力；部分模型不能关闭思考，预算模式包含模型相关的 0 / -1 特殊值，输出上限可能同时包含思考与正文。
- [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort)：effort 是行为强度信号，不是精确 Token 预算；档位支持随模型变化，`adaptive` 是模式而不是档位。

上述资料于 2026-10-09 查阅，仅用于构造候选 PA 配置与校验思路。公开 Gemini 或 Claude 商业接口的参数支持，不能直接当作 PA 中 Gemini / Claude 模型的能力证据。PA 中大小写、关闭、动态预算及输出长度关系均需实际验证。

HTTP 200 或完成一次生成，只能证明请求被接受并成功生成；私有上游可能忽略未知字段，因此不宣称已经证明档位改变了推理行为。需要进一步对照实验，记录该边界。

## 3. 统一输入与优先级

网关采用共用的 `ReasoningEffort` 类型，候选值为 `none | minimal | low | medium | high | xhigh | max`。首批主要启用 low / medium / high，其他值仅在具体 Google 模型有映射和证据时开放。`max` 与 `xhigh` 保持独立，不自动视为别名；本次扩展 Google 输入类型不能自动改变 Codex 允许的值。

内部先解析成控制意图：

```ts
type ReasoningControl =
  | { kind: 'default' }
  | { kind: 'effort'; effort: ReasoningEffort; source: string }
  | { kind: 'budget'; tokens: number; source: string }
  | { kind: 'disabled'; source: string }
  | { kind: 'adaptive'; source: string };
```

### 3.1 Anthropic 入口

| 请求条件 | 选择与处理 |
|---|---|
| `output_config.effort` 存在 | 优先选择该档位，按模型映射；不从预算再反向猜档位 |
| `thinking.type: enabled`，没有 effort | 正整数预算直接进入预算分支，保留旧客户端行为 |
| `thinking.type: disabled`，没有 effort | 显式关闭，要求模型验证过关闭配置 |
| `thinking.type: adaptive`，没有 effort | 使用模型登记的自适应配置，可能为预算 -1 或已验证的上游默认 |
| 两者都没有 | 默认模式，省略思考控制参数，交由上游选择 |

结构与冲突先校验：

- effort 值必须为允许枚举；未知 `thinking.type` 返回 400。enabled 模式提供的预算必须为正整数；adaptive / disabled 模式不得附带预算。
- `disabled` 与非 none effort 冲突，返回 400；`enabled` / `adaptive` 与 none effort 冲突，返回 400。disabled 与 none 同时出现则合并为关闭意图。
- effort 与合法 enabled 预算同时出现：effort 优先，预算不作为额外上限；日志记录被覆盖的预算。enabled 仍要求提供合法预算，保持该输入结构的一致性。
- 模型不支持关闭时，none / disabled 返回 400，不能改为 minimal；没有已验证自适应配置的显式 adaptive 请求也返回 400。
- `between_tools`、每消息 `output_config` 等扩展暂未纳入本方案，显式传入需给出不支持说明，不能静默宣称已处理。

### 3.2 OpenAI 入口

`reasoning_effort` 直接形成 effort 意图，省略时为默认模式。关闭使用 `none`。不新增公开 `googleThinkingBudget` 参数；内部模型测试工具使用同一解析/转换结果，避免公开和内部两套实现。

## 4. 按模型转换：level 与 budget 两种方式

同一模型的 effort 使用能力档案选定的一种方式，最终一次请求最多发送 thinkingLevel 或 thinkingBudget 之一。若两者在该 PA 模型上都被验证，档案明确选择 effort 的首选方式，同时可保留旧预算分支。

### 4.1 Level 方式

当某个具体 PA 模型验证支持 level 时，配置例子为：

| 网关档位 | 候选 PA 配置 |
|---|---|
| minimal | `{ "thinkingLevel": "MINIMAL" }` |
| low | `{ "thinkingLevel": "LOW" }` |
| medium | `{ "thinkingLevel": "MEDIUM" }` |
| high | `{ "thinkingLevel": "HIGH" }` |

表中为候选 wire 值，实际以 PA 验证过的配置为准。只支持 LOW / HIGH 的模型不开放 medium；none、xhigh、max 不自动映射到已有级别。未提供独立控制能力的档位不出现在模型列表。

### 4.2 Budget 方式

当 PA 模型只验证了预算控制时，使用按模型配置的档位表。建议首轮候选预算：

| 网关档位 | 候选预算 Token |
|---|---:|
| minimal | 512 |
| low | 2048 |
| medium | 8192 |
| high | 16384 |
| xhigh | 24576 |
| max | 该模型验证过的预算上限 |
| none | 0，仅模型验证支持关闭时 |

数值是网关策略建议，不是 Google 官方 effort 对照表。每个模型覆盖自己的值，不能把这张表无条件应用到所有 Gemini 和 Google 承载的 Claude。

处理规则：

1. 候选预算超出该模型范围时，不将其静默夹到上下限；先修改候选表并重新探测，再发布映射。
2. 已启用档位应保持预算递增。若两档映射为同一预算，只公开其中一个，避免展示没有区别的额外档位。
3. 用户直接指定的正整数预算不转换成 low / medium / high；在已验证范围内原样传递。
4. level 模式模型若没有验证预算控制，旧预算请求返回 400，提示改用 effort；不应用 Codex 的预算阈值来猜 Google 档位。
5. 不根据 `-high`、`-medium`、`-thinking` 等模型 ID 后缀推断档位配置，也不自动切换到另一个模型 ID。后缀型号保持真实上游身份。

### 4.3 一次完整转换示例

假设某模型的 budget 档案已经验证 `high = 16384`，两个请求得到同一控制结果：

```json
{ "output_config": { "effort": "high" } }
```

```json
{ "reasoning_effort": "high" }
```

PA 请求中的相应片段为：

```json
{
  "request": {
    "generationConfig": {
      "thinkingConfig": { "thinkingBudget": 16384 }
    }
  }
}
```

若目标模型是已验证的 level 方式，同样的 high 请求生成 `{ "thinkingLevel": "HIGH" }`。两入口都只在请求准备阶段做一次解析；请求构建器不重复选择规则。

## 5. 输出上限、校验与错误

- `max_tokens` / `max_completion_tokens` 仍是调用者输出上限；Google OpenAI 路线建议使用 `max_completion_tokens ?? max_tokens`，两个值同时存在且不一致时返回 400。
- 档案记录该 PA 模型是否要求预算小于输出上限、验证过的输出上限与默认值。确认存在此约束时，显式 `budget >= maxOutputTokens` 返回 400，说明要求；不自动降低 effort 或扩大用户上限。
- 未传输出上限时，使用档案登记的默认 `maxOutputTokens`；预算方式必须为预算和正文预留空间，并处于该模型输出范围内，否则拒绝无效配置。不能无界提高输出长度。
- level 方式无法从档位推导精确思考 Token，尊重输出上限；响应达到限制时要传递长度结束原因，而不是伪装正常完成。
- Google `finishReason: MAX_TOKENS` 转为 Anthropic `max_tokens` / OpenAI `length`，这是本次长度约束的必要响应配套。
- 用户参数错误、缺少可用模型映射、未开放档位：HTTP 400，包含模型、请求档位、允许值、原因；配置结构错误是服务端错误，不能伪装用户输入错误。
- 在发送 SSE HTTP 200 之前完成请求准备与校验。实际生成开始后的上游错误通过当前协议的 error 事件输出；解析器必须识别 PA 流内错误及截断，不把 HTTP 200 当作必然成功。

## 6. 能力档案、发现与多账号

建议在 `providers.google.reasoning.models[canonicalModel]` 保存已启用的映射，单独保存 PA 验证记录。初始为空；候选配置不直接公开成支持能力。

示例为结构草案，数值待验证，不能直接当作当前运行配置：

```json
{
  "effortMode": "budget",
  "effortMap": {
    "low": { "thinkingBudget": 2048 },
    "medium": { "thinkingBudget": 8192 },
    "high": { "thinkingBudget": 16384 }
  },
  "budget": {
    "min": 512,
    "max": 24576,
    "canDisable": false,
    "canDynamic": true,
    "requiresBudgetBelowOutputLimit": true
  },
  "adaptive": { "thinkingBudget": -1 },
  "defaultMaxOutputTokens": 32768
}
```

档案须校验映射类型、范围、单调性、输出限额及验证证据。level 档案的 `effortMap` 对应字段为 `thinkingLevel`；预算能力和 adaptive 可以缺省，表示未支持该输入。

动态目录提供候选模型和预算线索，不能从 `supports_thinking: true` 自动生成档位表，也不能把 `thinking_budget` 假定为上限。现有发现仅保留配额较高账号的元数据，不能作为所有账号的一致能力。

验证作用域至少关联：canonical model、账号池内部账号 ID、project、端点、实际 thinkingConfig、输出配置、验证时间。凭据不进入配置/日志；持久证据放在本地忽略版本管理的 data 文件中。管理页展示汇总状态，不暴露账号标识。

请求选账号时必须选择拥有该映射证据的启用且有效账号；每次请求只使用该账号的一个已验证端点。上游网络异常、408、429、5xx 可在同一账号和端点有限重试；不换号、不降 effort、不更换模型。没有合格账号时返回可用性错误；无能力证据则在准备阶段返回 400。

别名解析必须与实际生成共用一份 canonical model 映射。配置持久化必须保持其他 provider 字段及现有路由。

`GET /v1/models` 建议复用 `reasoning_efforts` 并新增 Google 元数据：

```json
{
  "reasoning_efforts": ["low", "medium", "high"],
  "reasoning_control": "budget",
  "reasoning_verification": "pa-request-accepted",
  "supports_thinking_budget": true,
  "supports_thinking_disable": false
}
```

只列已启用且存在有效证据的档位。验证状态明确为“PA 接受请求”，不是效果保证。不配置网关默认 effort，未指定强度的请求继续走上游默认。

## 7. 代码接入位置

```text
双入口 JSON
  → await prepareRequest（固定路由、模型规范化、解析控制意图）
  → Google reasoning resolver（能力/预算/输出校验）
  → PreparedGoogleRequest（唯一解析结果）
  → 写下游响应头
  → 选择具备对应能力证据的账号
  → request-builder（写入 PA generationConfig）
  → 上游请求与流解析
```

建议改动位置：

| 模块 | 修改 |
|---|---|
| `src/types.ts` | 共用 effort 类型、Google 档案、控制意图和准备结果；保留 Codex 自身允许值校验 |
| `src/providers/google/reasoning.ts`（新增） | 解析双协议请求、冲突校验、按模型转换和输出上限校验 |
| `src/router/dispatcher.ts` | 异步准备阶段；避免验证和派发重新路由得到不同 provider；传递准备结果 |
| `src/ingress/messages.ts` / `chat.ts` | SSE 之前 await 准备；流式和非流式使用同一配置 |
| `src/providers/google/client.ts` | 双入口共用 resolver 结果；能力感知账号及端点回退 |
| `src/providers/google/request-builder.ts` | 接受明确 thinkingConfig，正确写入 0 / -1；移除真值判断预算逻辑 |
| `src/providers/google/sse-parser.ts` | 传递长度结束原因、识别流内错误；可记录原始思考 Token 统计 |
| `src/config.ts` | 合并并校验 Google reasoning 配置 |
| `reasoning-probe.ts` / `reasoning-profile.ts` | 扩展现有管理入口到 Google，探测记录与配置保存独立于 Codex |
| `model-test.ts` / Models Hub | 复用准备逻辑、支持 Google 分档探测，输出预算不再被固定 512 截断 |

强度与思考摘要返回分开：effort 不自动设置 `includeThoughts`。现有 thinking_delta / reasoning_content 转换继续处理上游实际返回的摘要；没有摘要不意味着配置未生效。Google 不据返回文本反推实际 effort。

建议诊断事件 `google.reasoning.resolved`：request ID、请求/规范模型、来源字段、请求档位、转换方式、实际 thinkingConfig、输出上限、配置版本、覆盖的预算和结果状态；只保存配置元数据，不增加私人正文记录。

## 8. 探测、验收与实施顺序

复用受网关密钥保护的管理接口：`POST /v1/admin/models/reasoning-probe`、`PUT /v1/admin/models/reasoning-profile`。按路由识别 provider，保留现有 Codex 请求兼容；Google 增加候选 thinkingConfig 和输出上限以支持预算数值验证。顺序执行候选，使用实际 PA 端点，避免一次发起大量昂贵高预算请求。

探测结果区分：

- accepted：HTTP 成功且 SSE 正常完成生成，没有流内错误；保存准确候选配置及作用域。不证明未被忽略或效果更强。
- rejected：400 / 422 等错误明确指向该候选 thinking 配置；不能将输出上限错误、无关参数错误记为该档不支持。
- failed：429、认证、网络、超时、截断流或其他不相关错误；不能据此删除已支持档位。

配置保存复用短期有效探测结果和原子更新模式。转换表修改后必须重新验证对应实际 payload，不能只按档位名称复用旧证据。真实调用中参数相关拒绝应使对应作用域证据失效，并提示重新探测。

后续实现的验收场景：

1. 同模型两入口传 high，生成相同已登记 thinkingConfig；默认请求省略控制参数。
2. effort 覆盖合法 enabled 预算；冲突关闭、不支持档位及非法预算在 SSE 前返回 400。
3. 直接预算在支持范围内原样保留；0 / -1 仅通过已验证的关闭/动态分支生成。
4. level / budget 同一请求不混发；未支持预算的 level 模型给出明确错误。
5. 显式输出上限不被扩大；预算/限额冲突拒绝；长度截断向双协议正确传播。
6. 模型后缀不触发虚构能力；别名与真实模型能力一致；模型发现不能覆盖已启用映射。
7. 账号/端点回退保留档位及配置，跳过无证据作用域；没有可用账号时报告可用性原因。
8. 探测区分参数拒绝与临时故障；HTTP 200 流内失败不记 accepted；改预算后旧证据不能用于保存。
9. `/v1/models`、管理保存、请求诊断展示一致的已启用映射；现有 Codex 能力规则不被放宽。

建议实施顺序：先完成 budget 方式和双入口闭环，再在 PA 实际验证后启用 level 方式；扩展管理探测与账号证据约束属于闭环所需。实际开发时再按用户授权执行本地验证和真实推理，设计阶段不运行测试或消耗订阅额度。

## 9. 当前交付与接续

已完成：现状核查、公开协议资料复核、候选映射、双入口代码接入、管理探测保存入口、多账号证据约束、模型元数据和 API 说明。存储实现将账号作用域与映射一并写入 Google reasoning 档案；探测候选值可由管理 API 覆盖。模型测试保留内部最低预算通道。

已执行：三个代表模型的真实 PA effort 探测、档位配置保存、双入口请求和测试套件；完整结果见[实测记录](./Google_effort测试与PA探测_2026-10-09.md)。静态语法检查已通过；仓库现有 TypeScript 类型检查环境缺少 Node 类型与 `.ts` import 选项，直接 `tsc --noEmit` 未能通过。待验证关键项为其他模型的控制方式、真实预算边界、多账号/端点一致性，以及参数是否真实影响推理行为。

本文件保留设计依据与候选规则；实际接口规则已写入 [`docs/api/Google思考强度API.md`](../api/Google思考强度API.md)。后续真实 PA 探测完成时，在接口文档和知识库状态中同步记录实际模型、参数和验证范围。
