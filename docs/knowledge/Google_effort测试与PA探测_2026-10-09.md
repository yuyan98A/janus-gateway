# Google effort 档位测试与 PA 探测（2026-10-09）

## 范围与环境

使用本地网关 `127.0.0.1:18764` 运行当前工作树代码；Google 模型目录发现 22 个聊天候选。当前仅 1 个 Google 账号启用，因此本次证据只覆盖该账号与 `daily-cloudcode-pa.googleapis.com` 端点。探测请求是短文本生成，`accepted` 表示 PA 接受该精确参数并完成输出，不证明推理质量或实际内部计算量随档位变化。

## PA 参数探测

以下 9 个组合均返回 HTTP 200、完整模型输出与 `verifiedAccountCount=1`；结果已通过管理 API 保存到 `config.json`，并在 `/v1/models` 显示为 `low`、`medium`、`high`。

| 模型 | 控制方式 | low | medium | high |
|---|---|---|---|---|
| `gemini-2.5-flash` | `thinkingBudget` | 2048 | 8192 | 16384 |
| `gemini-3.8-flash-tiered` | `thinkingLevel` | `LOW` | `MEDIUM` | `HIGH` |
| `claude-sonnet-4-6` | `thinkingBudget` | 2048 | 8192 | 16384 |

预算候选的 `maxOutputTokens` 分别为 4096、9216、17408；level 候选均为 4096。PA 允许这些请求完成，尚未测得模型真实预算上限、最低值或关闭思考能力。其他 19 个 Google 聊天候选未做 effort 探测，也未启用档位。

## 网关验收

- `npm test`：账号池 14/14，通过；网关 15/15，通过，包含真实 Google 和 Codex 双协议基础请求。修正了仪表盘测试中的旧英文标记断言，当前页面实际使用“Google 账号池”。
- `npm run test:reasoning`：通过；新增 Google 转换测试，覆盖双入口同档映射、PA payload、默认行为、元数据、冲突和预算边界；保留既有 Codex 回归。
- 已保存三个 Google 档案后，低档位在 Anthropic Messages 与 OpenAI Chat Completions 两个入口均对三个模型实际生成 `OK`；高档位对 `gemini-2.5-flash` 的 Anthropic 入口、`gemini-3.8-flash-tiered` 和 `claude-sonnet-4-6` 的 OpenAI 入口实际生成成功。
- `gemini-2.5-flash` 的 Anthropic 直接预算 3000 成功。未登记 `none`、`high` 预算大于输出上限、`disabled` 与 `high` 冲突均在入口返回 HTTP 400。
- `gemini-3.8-flash-tiered` 的 OpenAI `high` 流式请求返回 HTTP 200、`chat.completion.chunk` 和 `[DONE]`，没有错误事件。

## 边界与接续

本次仅抽测三个代表模型，单账号、单 PA 端点；没有比较相同提示词在不同档位下的统计差异。探测实例 18764 已停止。用户随后要求重启正式服务：原 18763 进程已停止，新进程 PID 58588 已启动；`/health` 返回 `ok`，`/v1/models` 显示三个模型的低、中、高档及正确控制方式。后续新增模型或账号应单独探测并保存其作用域。
