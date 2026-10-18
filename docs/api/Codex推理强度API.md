# Codex 专线的思考强度

本文说明两个下游兼容接口如何控制 Codex 模型的推理强度、如何查看每个模型已验证的能力，以及如何探测并登记新能力。

网关将请求发送到 ChatGPT/Codex 专属 Responses 后端。下游虽然可以使用 OpenAI Chat Completions 或 Anthropic Messages 格式，但最终都要转换成 Codex 上游请求中的 `reasoning.effort`。不同模型、账号或上游版本未必支持同一组档位，因此网关使用逐模型能力表，只有探测并登记过的档位才接受下游显式请求。

## Codex CLI 与 Claude Code 的 effort 会怎样发出

要区分 Agent 配置里的名字、Agent 实际调用的 API 协议，以及本项目提供的下游入口。CLI 配置名不会原样成为 HTTP 字段。

| Agent / 客户端 | Agent 设置 | Agent 发出的接口调用 | 当前网关能否直接接 |
|---|---|---|---|
| Codex CLI | `model_reasoning_effort = "high"` | Codex CLI 原生使用 Responses API：`POST /v1/responses`，请求体含 `"reasoning": {"effort": "high"}` | **不能直接接原生 Codex CLI**：本项目目前未提供下游 `/v1/responses` |
| 使用 OpenAI Chat Completions 的客户端 | 客户端自己的 effort 设置 | `POST /v1/chat/completions`，请求体含 `"reasoning_effort": "high"` | **可以**：这是本项目当前 OpenAI 下游入口 |
| Claude Code | `/effort high`、`CLAUDE_CODE_EFFORT_LEVEL=high` 或 `effortLevel` | Anthropic Messages 调用：`POST /v1/messages`，effort 对应 `output_config.effort` | **协议字段可接**：本项目支持该字段；尚未用 Claude Code CLI 本体做端到端验证 |

Codex CLI 的 `model_reasoning_effort` 是 CLI 配置项；它的原生请求协议是 Responses，线上字段为 `reasoning.effort`。OpenAI Chat Completions 兼容客户端使用的字段则叫 `reasoning_effort`。OpenAI 的 Codex app-server 文档展示了 `wire_api = "responses"` 配置，[Reasoning API 文档](https://developers.openai.com/api/docs/guides/reasoning?api-mode=chat)说明了 Responses 与 Chat Completions 的参数名称。

Claude Code 的 `/effort` 是 CLI 控制命令，`CLAUDE_CODE_EFFORT_LEVEL` 是环境变量；在支持 effort 的 Anthropic Messages 请求中，对应的请求体字段为 `output_config.effort`。Claude Code 文档说明了这些设置入口，[Anthropic API 文档](https://platform.claude.com/docs/en/build-with-claude/effort)定义了 Messages 请求中的字段。模型不支持某档位时，客户端或服务端还可能按其能力规则拒绝、回退或使用默认行为，不能只根据 CLI 菜单推断上游模型接受该档位。

**当前接入边界：**当前网关下游只暴露 Anthropic Messages (`/v1/messages`) 与 OpenAI Chat Completions (`/v1/chat/completions`)。Codex CLI 自己虽然能够调用 Codex Responses 服务，但其 `model_reasoning_effort` 配置不能让它自动改用 Chat Completions；要原生接入本项目，网关还需要实现下游 Responses API 的请求、工具调用与流式事件兼容。使用 Chat Completions 的其他 Agent 则可以传 `reasoning_effort` 使用现有 OpenAI 入口。

Claude Code 通过 Anthropic 入口使用 Codex 路由时，effort 档位随每次 Messages 请求发送。若客户端发送 `output_config.effort`，项目直接将档位用于 Codex 路由；若发送旧式 `thinking.budget_tokens`，项目按本页的预算阈值近似换算成档位。二者语义不同，预算数值不会作为 Codex 思考 token 数传递。

**端到端验证范围：**当前已用真实上游和临时本机网关验证 Chat Completions 的 `reasoning_effort: "high"`，以及 Anthropic Messages 的 `thinking.budget_tokens: 6000`（映射为 `medium`）。此外有本地回归覆盖 Anthropic `output_config.effort` 的直传优先级。尚未用 Codex CLI 或 Claude Code CLI 程序本身连接网关验证；Codex CLI 还受当前缺少 `/v1/responses` 限制。真实验证详情见本页“当前真实验证结果”。

## 先区分四种不同的参数

“思考强度”“思考预算”“回答长度”和“返回思考内容”经常被混为一谈，但它们控制的事情不同。

| 参数 | 谁提供 | 控制什么 | 不代表什么 |
|---|---|---|---|
| Codex `reasoning.effort` | Codex 上游 | 请求模型按某个推理强度档位处理 | 不指定精确的思考 token 数，也不保证回答质量一定提升 |
| OpenAI `reasoning_effort` | `/v1/chat/completions` 客户端 | 下游请求希望使用的推理强度档位 | 不保证该档位对所有模型都可用 |
| Anthropic `thinking.budget_tokens` | `/v1/messages` 客户端 | Anthropic 风格的思考预算 | 不是 Codex 的 effort 值，不能直接按数值传给上游 |
| `max_tokens` / `max_output_tokens` | 下游请求 | 限制最终生成内容的长度 | 不是思考强度或思考预算 |
| `thinking` / `reasoning_content` 响应块 | 上游响应 | 上游实际返回的思考相关内容 | 不代表已启用某一强度，也不保证一定返回 |

OpenAI 把 `reasoning.effort` 定义为推理投入程度，具体可用档位随模型而异。[Responses API 参数说明](https://platform.openai.com/docs/api-reference/responses)。Anthropic 的新版接口也区分 adaptive thinking、effort 和 token budget；预算与强度不是同一种控制方式。[Anthropic 思考配置说明](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-templates-and-variables)

所以，网关按两个原则处理：

1. **客户端没指定强度时，不覆盖上游默认值。** 网关不因为配置里登记了某个 `default` 就自动把该档位发给上游。
2. **客户端明确指定但能力未知或不支持时，返回错误。** 网关不猜测、不自动降级，也不把 `high` 悄悄改成 `medium`。

## 一次请求的完整处理流程

```text
下游请求
  │
  ├─ OpenAI: reasoning_effort ─────────────────┐
  │                                            │
  └─ Anthropic: thinking / output_config.effort│
                 │                            │
                 └─ budget_tokens 换算为档位 ─┤
                                              ▼
                                  解析为 Codex reasoning.effort
                                              │
                              查询该模型的已验证能力表
                                    ┌─────────┴─────────┐
                                    │                   │
                              未登记/不支持          已登记支持
                                    │                   │
                               HTTP 400          调用 Codex 上游
                                                        │
                                             返回下游协议对应的响应
```

参数校验在响应流开始前进行，因此 OpenAI 和 Anthropic 的流式、非流式请求遇到未支持的强度时都会收到普通 HTTP 400 JSON 错误，而不是已经开始的 SSE 流中的错误事件。

## 两个下游接口分别怎么传

### OpenAI Chat Completions

请求字段是 `reasoning_effort`。如果模型能力表登记了该值，网关会原样转成上游的 `reasoning.effort`。

```json
{
  "model": "gpt-6.1-sol",
  "reasoning_effort": "high",
  "messages": [
    {"role": "user", "content": "分析这个算法的时间复杂度和边界情况。"}
  ],
  "stream": true
}
```

假设配置表中 `gpt-6.1-sol` 支持 `high`，发给 Codex 上游的关键字段是：

```json
{
  "reasoning": {"effort": "high"}
}
```

如果没传 `reasoning_effort`，上游请求中省略 `reasoning`，由 Codex 模型使用自身默认值。

### Anthropic Messages

Anthropic 风格的手动思考预算使用 `thinking`。网关将其预算换算成 Codex 档位，而不是把预算数字直接传给上游。

```json
{
  "model": "gpt-6.1-sol",
  "max_tokens": 2048,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 6000
  },
  "messages": [
    {"role": "user", "content": "分析这个算法的时间复杂度和边界情况。"}
  ],
  "stream": true
}
```

按默认阈值，`6000` 会映射为 `medium`，因此 Codex 上游收到：

```json
{
  "reasoning": {"effort": "medium"}
}
```

换算完成后仍要查能力表。如果该模型没有登记 `medium`，网关返回 HTTP 400，不会把它换成该模型支持的其他档位。

网关也接受 Anthropic 请求中的 `output_config.effort` 作为 Codex 专线的强度参数，并直接映射到上游。若 `thinking` 与 `output_config.effort` 同时出现，当前实现优先使用 `output_config.effort`。这是本项目 Codex 适配器的行为；Google 专线不会应用这项 Codex 映射。

## 模型能力表是什么

`~/.codex/models_cache.json` 可以帮助网关发现账号下可用的模型 ID，但它没有经过验证的推理强度能力信息。**模型出现在 `/v1/models` 不等于该模型已验证支持任意强度。**

推理能力在项目根目录 `config.json` 的 `providers.codex.reasoning.models` 中登记。每个模型可以记录：

- `efforts`：已经探测并确认上游接受的档位；显式请求只允许这些值。
- `default`：可选的说明性字段，作为模型元数据返回。它不会被网关自动发送给上游。

示例：

```json
{
  "providers": {
    "codex": {
      "reasoning": {
        "models": {
          "gpt-6.1-sol": {
            "efforts": ["low", "medium", "high"],
            "default": "medium"
          }
        }
      }
    }
  }
}
```

这里的 `gpt-6.1-sol` 档位已在当前开发环境的 Codex 登录态下真实探测并调用，见[当前真实验证结果](#当前真实验证结果)。其他模型没有相应实测证据时，不要因为模型名称相似，就复制它的能力。

保存配置后（或网关启动时从 `config.json` 读取后），`GET /v1/models` 对已登记的 Codex 模型会附带能力信息：

```json
{
  "id": "gpt-6.1-sol",
  "object": "model",
  "owned_by": "openai-codex",
  "reasoning_efforts": ["low", "medium", "high"],
  "reasoning_default": "medium"
}
```

`reasoning_efforts` 是允许客户端显式请求的已登记档位。模型没有该字段时，表示尚无能力记录；不带强度参数仍可正常请求，但显式设置强度会收到 HTTP 400。

别名 `codex` 和 `gpt-5-codex` 会先解析为上游模型 `gpt-5.5` 再查能力表。因此建议按规范的上游模型 ID（如 `gpt-5.5`）登记能力，别名请求会复用该记录。

## 如何探测并登记档位

### 第一步：调用管理探测 API

`POST /v1/admin/models/reasoning-probe` 需要网关密钥。默认会对 `low`、`medium`、`high` 顺序各发起一次真实 Codex 请求：

```bash
curl http://127.0.0.1:18763/v1/admin/models/reasoning-probe \
  -H "Authorization: Bearer sk-gateway-local-token" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-6.1-sol"}'
```

也可以显式指定候选集合。可选值为 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`：

```json
{
  "model": "gpt-6.1-sol",
  "efforts": ["none", "minimal", "low", "medium", "high", "xhigh"]
}
```

每个候选档位会独立发起一次短请求，最大输出设为 16 tokens（Codex 上游当前要求至少 16），提示词为 `Reply with exactly: OK`。多档探测按顺序执行，不并发；请求会使用当前 Codex 登录态和真实配额。

### 第二步：阅读探测状态

响应中的 `results` 按档位给出探测结论：

- `accepted`：上游返回 HTTP 2xx，表示该请求被上游接受。
- `rejected`：上游返回 HTTP 400 或 422，且错误信息指向 `reasoning` 或 `effort` 参数，表示该推理档位被拒绝。
- `failed`：其他 HTTP 状态或网络异常，例如 401 认证失败、429 配额限制、连接错误。它不是“不支持该档位”的结论。

如果上游返回 400/422，但错误内容与 `reasoning` / `effort` 无关（例如 `max_output_tokens` 未达到下限），探测记为 `failed`，避免把探测请求本身的错误误判成档位不支持。

示意响应：

```json
{
  "object": "codex_reasoning_probe",
  "model": "gpt-6.1-sol",
  "results": [
    {"effort": "low", "status": "accepted", "httpStatus": 200},
    {"effort": "medium", "status": "accepted", "httpStatus": 200},
    {"effort": "high", "status": "rejected", "httpStatus": 400, "error": "Unsupported effort"}
  ],
  "suggestedConfig": {
    "model": "gpt-6.1-sol",
    "efforts": ["low", "medium"]
  }
}
```

上例说明应登记 `low` 和 `medium`，不登记 `high`。如果遇到 `failed`，先排查认证、配额或网络，再重新探测；不要把 `failed` 当成不支持。

### 第三步：在控制台审核并保存，或使用管理 API

管理页面 Models Hub 的 Codex 模型行会显示候选档位。探测后，只有上游明确接受的档位可以勾选；选择后点击“保存配置”。保存会更新项目根目录 `config.json`，并立即更新当前进程的能力表，无需重启。新档位必须在当前进程最近 30 分钟内探测成功后才能保存；已登记档位可保留。清空选择并保存会移除该模型的能力登记。

也可以直接调用管理 API。该 API 只接受当前已登记档位，或最近 30 分钟探测为 `accepted` 的档位：

```json
{
  "model": "gpt-6.1-sol",
  "efforts": ["low", "medium"]
}
```

```bash
curl -X PUT http://127.0.0.1:18763/v1/admin/models/reasoning-profile \
  -H "Authorization: Bearer sk-gateway-local-token" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-6.1-sol","efforts":["low","medium","high"]}'
```

返回 `saved: true` 后配置立即生效；`GET /v1/models` 会显示新的 `reasoning_efforts`。提交空数组可清除配置：`{"model":"gpt-6.1-sol","efforts":[]}`。如果选择了未探测或探测失败的档位，接口返回 HTTP 409；无效档位或非 Codex 路由模型返回 HTTP 400。

配置接口只写入推理能力子树，不会把访问令牌等账号凭据写入网页或响应。配置文件更新使用临时文件替换，运行中的网关同时更新内存能力表。

### 控制台的探测与保存行为

- 每个 Codex 模型都有单独的档位控制；点击“探测档位”会逐个请求 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`。
- 探测是实际 Codex 上游请求，按候选档位逐次消耗少量订阅配额；失败、限流和不支持会分别显示，不会把网络失败误判成不支持。
- 新档位只有探测返回 `accepted` 后才可勾选保存。保留当前已登记的档位不要求再次探测。
- 配置立即生效，不要求重启。若配置文件不可写或格式错误，控制台会显示保存失败并保留原配置。

### 一键探测并保存

Models Hub 顶部的“一键探测并保存全部 Codex 模型”会遍历当前 `/v1/models` 中所有 Codex 专线模型，按模型逐个、按档位逐个调用上游，并将每个模型的探测结果独立保存。批次按顺序执行，不会并发压满上游；界面持续显示当前进度、最终保存数和失败模型。每个模型最多发送 6 条短请求，因此最大请求数为“不同上游模型数 × 6”，会消耗订阅额度。开始前界面会显示模型数和最大请求数并要求确认。

`codex` 与 `gpt-5-codex` 都是 `gpt-5.5` 的别名。批量操作会按网关的别名映射先规范化并去重，避免同一个上游模型被重复探测；保存能力仍写到规范模型 ID。页面也保留单模型的“一键探测并保存”入口。

探测状态仍分为接受、明确拒绝和失败。失败通常表示认证、网络或额度问题，不能据此判定模型不支持：

- 没有任何档位被接受且存在失败项时，网关不保存配置，原有登记保持不变。
- 部分档位失败时，已有的这些档位会保留；明确被拒绝的档位会移除。
- 成功探测的档位与保留档位会自动保存，立即生效，无需重启。
- 一个模型失败不会中断其余模型；批次结束时会汇总成功保存、保留旧配置和处理失败的模型。

### Codex 订阅剩余额度

侧栏的“刷新额度”读取当前账号的 Codex 使用窗口，显示已用百分比、剩余百分比、窗口重置时间；若上游提供额度重置次数，也会一并显示。该比例是订阅窗口使用情况，不是 token 余额或货币金额。读取不会发起模型推理请求。

管理接口为需要网关密钥的 GET /v1/admin/codex/usage。它会即时向上游读取额度；GET /v1/admin/codex/status 返回最近一次的缓存结果，不会自动刷新。网关只在用户手动操作时查询，不会后台轮询。

Codex CLI 当前在 ChatGPT 后端使用 https://chatgpt.com/backend-api/wham/usage 获取用量。该路径由 [Codex CLI 上游实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)确认，但它是内部接口，不是稳定的公开 API；字段和窗口数量可能变化。网关只返回归一化后的窗口和状态，不会返回原始响应、访问令牌或完整账号 ID。读取失败或无法识别额度窗口时显示“暂不可用”，不会将失败伪装为 0%。

## Codex 账号状态面板

控制台侧栏的“Codex 账号状态”从管理接口读取本地 `auth.json` 的非敏感状态，包括登录文件能否读取、访问令牌是否存在/过期/临近过期、刷新令牌是否存在、遮蔽后的账号 ID 和最近刷新时间。不会显示或返回访问令牌、刷新令牌或完整账号 ID。

“检查上游连接”会使用 `gpt-6.1-sol` 发起一条短的真实 Responses 请求，并显示 HTTP 连接结果和最近检查时间。该动作可能触发 OAuth 刷新、更新本地 `auth.json`，并消耗少量订阅额度。对应接口如下：

```http
GET  /v1/admin/codex/status
POST /v1/admin/codex/status/check
```

两个接口都需要网关密钥。连接检查也可指定其他 Codex 路由模型，例如：

```json
{"model":"gpt-5.5"}
```

本地令牌状态不等于上游可用性证明；需要确认真实上游是否可用时，使用“检查上游连接”。

**探测的边界：**探测只检查上游是否接受请求，不比较回答质量、实际思考 token、速度或各档位行为差异。有些上游可能接受参数，但不保证不同值会产生可观测差异。若要判断效果，还需针对同一任务、同一模型单独做质量和延迟评测。

## Anthropic 预算如何换算

默认阈值配置如下：

```json
{
  "anthropicBudget": {
    "lowMaxTokens": 2000,
    "mediumMaxTokens": 8000
  }
}
```

换算规则是：

| `thinking.budget_tokens` | 目标 Codex 档位 | 例子 |
|---:|---|---|
| 1 到 `lowMaxTokens`（含） | `low` | 1、1024、2000 → `low` |
| 大于 `lowMaxTokens` 且不超过 `mediumMaxTokens` | `medium` | 2001、6000、8000 → `medium` |
| 大于 `mediumMaxTokens` | `high` | 8001、12000 → `high` |

边界值遵循“低档上限包含在低档、中档上限包含在中档”的规则。阈值必须是正整数，且 `mediumMaxTokens` 必须大于或等于 `lowMaxTokens`。修改阈值后，所有 Codex 路线 Anthropic 请求都会按新阈值换算；OpenAI 的 `reasoning_effort` 不受该设置影响。

该换算只是兼容策略：比如预算 `6000` 只表示网关把请求归入 `medium` 档，不表示 Codex 会使用 6000 个推理 token。

## 常见请求结果与排查

### 显式档位未登记

例如给未配置的模型传入 `"reasoning_effort":"high"`，网关返回 HTTP 400，错误说明该模型尚未配置能力，并提示先探测和登记。此时可以：

1. 调用 `/v1/admin/models/reasoning-probe`；
2. 检查 `results`，区分 `rejected` 与认证、配额、网络导致的 `failed`；
3. 将接受的档位写入模型的 `efforts`；
4. 在控制台保存接受的档位后立即重试；如果是手动编辑 `config.json`，则需重启网关加载新配置。

### 模型不支持请求的档位

如果模型能力表登记了 `low`、`medium`，客户端却传 `high`，请求会在调用上游前返回 HTTP 400，并列出该模型已登记的支持值。网关不会自动挑一个替代档位。

### 只想使用上游默认强度

省略 OpenAI 的 `reasoning_effort`，或在 Anthropic 请求中省略 `thinking` / `output_config.effort`。这时网关不会发送 `reasoning` 字段。即使模型配置包含 `default`，该字段也只作为 `/v1/models` 的说明元数据，不会覆盖上游默认。

### 请求成功但看不到思考内容

强度参数控制的是推理投入，不要求上游返回思考文本。思考内容是否返回由上游模型和响应事件决定；强度设置成功不代表客户端必然看到 `thinking` 或 `reasoning_content`。另外，当前非流式聚合主要保留最终文本；需要查看上游返回的思考事件时应使用流式响应。

## 适用边界

- 能力表是按模型 ID 维护的显式记录；不从模型名称推断，也不把一个模型的能力自动复制给相似名称的模型。
- 模型 ID 清单与推理能力清单是两件事：`models_cache.json` 用于发现模型，`providers.codex.reasoning.models` 用于记录已验证档位。
- OpenAI 参数直接映射；Anthropic 预算按本地阈值近似换算，两种入口的输入语义不完全相同。
- 上游为 ChatGPT/Codex 专属后端。公开 Responses API 文档只能帮助理解字段设计，不能保证该内部端点对所有模型接受相同档位。
- 模型、账号或上游行为变化后应重新探测。探测成功不等于质量、延迟和 token 用量已经验证。
- `reasoning.effort` 与是否返回思考摘要/思考文本是不同设置；网关不会仅因调高强度而自动要求暴露思考内容。

## 当前真实验证结果

**验证日期：2026-10-07；模型：`gpt-6.1-sol`；认证：当前开发环境已登录的 Codex 账号。** 本次没有在文档或日志中记录账号标识或凭据。

真实上游探测结果：

| 候选档位 | 上游结果 |
|---|---|
| `low` | HTTP 200，接受 |
| `medium` | HTTP 200，接受 |
| `high` | HTTP 200，接受 |

随后使用当前 `config.json` 启动了一个临时本机网关实例，并通过真实 HTTP API 对同一模型做了两次真实流式调用：

| 下游入口 | 请求设置 | 上游档位 | 结果 |
|---|---|---|---|
| OpenAI Chat Completions | `reasoning_effort: "high"` | `high` | Codex 返回文本，成功 |
| Anthropic Messages | `thinking.type: "enabled"`, `budget_tokens: 6000` | `medium` | Codex 返回文本，成功 |

HTTP 层也检查了 `GET /v1/models` 返回 `reasoning_efforts: ["low", "medium", "high"]`，并确认给该模型传未登记的 `xhigh` 会在 SSE 开始前返回 HTTP 400。临时服务使用独立 loopback 端口和临时网关密钥，测试结束后已停止。

因此当前 `config.json` 已登记 `gpt-6.1-sol` 的 `low`、`medium`、`high`。这一结果只证明该模型在本次账号和上游状态下接受这些设置，并证明两种公开 HTTP 接口都能完成流式调用；它不证明其他 Codex 模型、其他账号或未来上游状态也支持这些档位，也没有比较档位之间的推理质量、速度或 token 差异。`none`、`minimal`、`xhigh` 等其他候选值尚未实测。

## 本地隔离回归

运行以下命令可以检查参数映射、预算边界、能力校验、模型元数据、探测状态分类和流式请求开始前的参数错误：

```bash
npm run test:reasoning
```

该回归使用本地模拟上游，不会调用真实 Codex 模型或消耗订阅配额。它验证参数结构与网关分支，不验证真实 Codex 账号下各模型是否接受档位；真实支持情况仍需调用前述 `reasoning-probe` 管理接口探测。
