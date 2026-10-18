# 请求日志与使用统计

管理页提供模型请求日志和历史使用统计。统计只包含 Anthropic Messages 与 OpenAI Chat Completions 推理请求，不把健康检查、管理接口或管理页自身的轮询计入模型调用量。

## 数据来源与保留

- 原始事件继续完整追加到 `logs/gateway-YYYY-MM-DD.jsonl`，按 UTC 日期分文件；控制台详情从原始文件读取，不复制请求/响应正文到统计索引。
- 每个完成或中断的推理请求另写一条轻量摘要到 `logs/index/requests-YYYY-MM-DD.jsonl`。摘要索引用于列表、筛选和聚合。
- 服务启动后会在后台扫描已有 `gateway-*.jsonl` 文件，回填可识别的请求。索引进度通过管理页显示；回填完成前，历史查询结果可能尚不完整。
- `logs/index/manifest.json` 记录已经扫描的原始文件大小和修改时间。文件变化时会重新扫描，已有请求 ID 用于去重。
- 原始日志和摘要索引都不会自动清理。

Token 用量仅累计上游明确返回的计数。Codex 从 Responses SSE 的完成事件读取；Google 从适配后的 usage 字段读取。没有上游用量的请求仍计入请求数量，但不计入 token 总量。该统计不推算费用；Codex 订阅额度窗口仍由现有用量接口单独提供。

## 管理接口

如已配置网关 API Key，请在请求中提供 `Authorization: Bearer <key>` 或 `x-api-key`。

### `GET /v1/admin/requests/summary`

按时间范围汇总请求总数、成功率、失败数、上游实报输入/输出 token，并按日期、模型和上游分组。

| 参数 | 说明 |
|---|---|
| `from` | 起始 UTC 日期，格式 `YYYY-MM-DD`，包含当天 |
| `to` | 结束 UTC 日期，格式 `YYYY-MM-DD`，包含当天 |

省略日期参数时查询全部已索引历史。

### `GET /v1/admin/requests`

分页列出推理请求摘要。

| 参数 | 说明 |
|---|---|
| `from`、`to` | UTC 日期范围，与汇总接口相同 |
| `requestId` | 请求 ID 子串匹配 |
| `model` | 模型 ID 子串匹配 |
| `provider` | `google` 或 `codex` |
| `result` | `success`、`error` 或 `interrupted` |
| `limit` | 每页条数，默认 50，最大 200 |
| `offset` | 分页偏移 |

### `GET /v1/admin/requests/:requestId`

返回该请求的摘要及关联原始 JSONL 事件，包括入站请求、路由、上游请求/响应、原始流、下游响应和错误详情。

## 管理页行为

- 统计区支持今天、近 7 天、近 30 天、全部历史及自定义 UTC 日期范围。
- 日志区支持请求 ID、模型、上游和结果筛选，每页 50 条；展开请求详情可查看完整原始事件。
- 历史索引正在构建时，现有已索引数据仍可查询，页面显示处理进度。
