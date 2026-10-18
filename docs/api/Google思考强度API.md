# Google 专线思考强度

更新：2026-10-09。状态：代码与真实 Cloud Code PA 探测已完成首批验证；当前项目配置为 `gemini-2.5-flash`、`gemini-3.8-flash-tiered`、`claude-sonnet-4-6` 启用低、中、高档。实际启用范围以 `/v1/models` 为准。

## 请求入口

| 下游协议 | 显式强度字段 | 请求示例 |
|---|---|---|
| Anthropic Messages `POST /v1/messages` | `output_config.effort` | `"output_config":{"effort":"high"}` |
| OpenAI Chat Completions `POST /v1/chat/completions` | `reasoning_effort` | `"reasoning_effort":"high"` |

Google 路由识别 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；只有在该模型档案中探测、保存过的档位才能实际调用。没有传强度参数时省略上游 `thinkingConfig`，继续使用上游默认。

上游 payload 位于 PA 信封的 `request.generationConfig.thinkingConfig`。每个已保存模型指定 `budget` 或 `level` 方式：前者传 `thinkingBudget` 数值，后者传 `thinkingLevel` 枚举。两个下游入口使用同一档案；一次请求只传一种方式。档位之间没有跨模型的固定等价关系，预算候选值是网关策略建议，需逐模型探测。

Anthropic `thinking.type: enabled` 且有正整数 `budget_tokens` 时，可以直接走预算通道。存在 `output_config.effort` 时由 effort 优先；合法预算不会作为第二个上限发送。`thinking.type: disabled` 或 effort `none` 需要模型验证支持关闭。显式 `adaptive` 需要配置自适应能力。冲突或未登记参数在发送 SSE 响应头前返回 HTTP 400；Google 账号均未满足已登记能力时返回 503。没有已保存能力档案的模型仍可按上游默认方式请求，不接受显式 effort。

预算模型的配置包含经探测的档位、直接预算范围、关闭/自适应能力和默认输出上限。直接预算必须落在档案范围内。启用 `requiresBudgetBelowOutputLimit` 后，预算必须小于请求的输出上限；不会替客户端放大输出或降低档位。OpenAI 同时给出 `max_tokens` 与 `max_completion_tokens` 时，两值必须相同；以 `max_completion_tokens` 为准。

Google 返回的 `finishReason: MAX_TOKENS` 转换为 Anthropic `stop_reason: max_tokens` 或 OpenAI `finish_reason: length`；工具调用对应 `tool_use` / `tool_calls`。思考强度配置与思考文本是否返回分别处理，缺少思考文本不能用来判断档位参数是否生效。

## 模型能力与探测

Models Hub 的 Google 模型行可选择“思考预算”或“原生档位”，逐个探测低、中、高档并保存。它调用与 Codex 共用的鉴权管理入口，依据模型路由选择 Google 或 Codex 处理。Google 单模型探测按档位顺序、对每个已启用账号发送短提示词；会消耗 Google 配额。只记录完成模型输出的账号及 PA 端点作为该档位的可用作用域。不同账号探测结果不互相冒充；正常推理只选择该档位存在记录的账号及端点。

`POST /v1/admin/models/reasoning-probe` 的 Google 请求示例：

```json
{
  "model": "gemini-2.5-flash",
  "mode": "budget",
  "efforts": ["low", "medium", "high"],
  "budgets": { "low": 2048, "medium": 8192, "high": 16384 },
  "maxOutputTokens": 17408
}
```

`mode` 缺省为 `budget`。候选预算缺省分别为 `none=0`、`minimal=512`、`low=2048`、`medium=8192`、`high=16384`、`xhigh=24576`；`max` 需要显式指定预算。`level` 模式有 MINIMAL、LOW、MEDIUM、HIGH 四个候选。`maxOutputTokens` 缺省取 4096 和“候选预算 + 1024”中的较大者，可显式调整。候选不代表模型已经支持。

探测结果为 `accepted`、`rejected` 或 `failed`。`accepted` 表示至少一个账号在主 PA 端点以该精确参数完成生成，响应含 `verifiedAccountCount`；它仍不能证明强度对输出有可测影响。若 400/422 错误内容明确涉及思考配置，分类为 `rejected`；限额、认证、网络、输出长度、流内错误等归为 `failed`。

探测成功后 30 分钟内调用 `PUT /v1/admin/models/reasoning-profile`：

```json
{
  "model": "gemini-2.5-flash",
  "efforts": ["low", "medium", "high"]
}
```

保存按模型写入 `config.json` 的 `providers.google.reasoning.models`，并热更新当前进程。空数组清除档案。已有档位可保留；新增档位必须有当前进程内近期通过的探测记录。不同控制方式不能混进同一档案。账号 ID、project、PA 端点、探测时间与档位实际参数写入档案以约束推理账号与端点选择，不写凭据。

`GET /v1/models` 对已启用 Google 档案增加 `reasoning_efforts`、`reasoning_control`、`reasoning_verification: "pa-request-accepted"`、`supports_thinking_budget` 和 `supports_thinking_disable`。模型发现中的 `supports_thinking` 和 `min_thinking_budget` 仍只是上游目录元数据，不自动启用档位。

## 当前验证边界

2026-10-09 在 1 个启用账号的主 PA 端点上，三个代表模型各自的低、中、高配置均完成生成；保存后通过双下游入口实际请求，并验证未登记档位、冲突配置和预算上限错误返回 HTTP 400。`npm test` 与 `npm run test:reasoning` 均通过。探测只能证明精确参数被 PA 接受并完成输出，不证明强度对推理质量有可测影响；其他 Google 模型、账号和备用 PA 端点尚未验证。项目现有 TypeScript 工具链缺少 Node 类型定义及 `.ts` import 配置，直接执行 `tsc --noEmit` 仍存在既有环境错误。[详细实测记录](../knowledge/Google_effort测试与PA探测_2026-10-09.md)。

详细设计、候选规则与后续验证范围见[Google effort 设计记录](../knowledge/Google专线effort档位转换设计.md)与[多云思考强度统一转换与协议对齐规范](../knowledge/多云思考强度统一转换与协议对齐规范.md)。
