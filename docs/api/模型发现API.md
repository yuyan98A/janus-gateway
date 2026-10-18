# 模型发现与分类管理 API

## 数据来源与无别名直连

网关汇聚两大专线算力的全量模型，以标准化格式呈现并严格分类：

1. **Google 专线**：
   * 发现请求发往 `https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`。
   * 使用 Google 账号池有效账号并发查询并取并集；若同一模型跨账号出现，保留剩余配额比例较高的条目。
   * **不过滤任何模型**：上游返回的所有条目（包括代码补全、生图、语音转录及内部条目）全部保留，通过 `category` 进行分类标识。

2. **Codex 算力专线**：
   * 通过直连上游接口 `GET https://chatgpt.com/backend-api/codex/models?client_version=0.162.1` 动态获取。
   * 若网络不可用或处于离线测试状态，优雅降级读取本地缓存。
   * **不做别名与归一化**：上游模型 ID 是什么就暴露什么（如 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-reserve`、`codex-auto-review`），不人为注入 `codex`、`gpt-5-codex` 等别名。

---

## 模型分类规范 (Model Categories)

所有模型条目均挂载 `category` 属性：

| 类别 (`category`) | 标识说明 | 来源规则 |
|---|---|---|
| `chat` | 通用对话与推理 | Google 通用大模型；Codex 绝大部分编程/通用模型 |
| `code_completion` | 代码补全 | Google 上游 `tabModelIds` 或以 `tab_` 开头的补全模型 |
| `image` | 图像生成 | Google 上游 `imageGenerationModelIds` |
| `audio` | 语音转录 | Google 上游 `audioTranscriptionModelIds` |
| `internal` | 内部测试 | Google 标记为 `isInternal` 或以 `chat_` 开头的模型 |
| `command` | 指令模型 | Google 上游 `commandModelIds` |
| `review` | 代码审核 | Codex 专线中以 `review` 结尾的模型（如 `codex-auto-review`） |

在 Web 管理页 (`/models`)，支持按分类筛选，并使用清晰的状态徽标展示不同分类模型。

---

## 缓存持久化与手动刷新机制

1. **无自动过期（Persistent Cache）**：
   * 模型目录持久化保存在 `./data/models-cache.json` 中，包含 `updatedAt`、`google`、`codex` 列表。
   * 缓存**永不自动过期**，网关启动或常规请求均直接复用缓存，不会产生额外后台轮询或自动刷新上游。
2. **纯手动刷新 (`POST /v1/admin/models/refresh`)**：
   * 只在运维人员点击 Web 页面“🔄 手动刷新全部模型”或调用刷新接口时触发。
   * 接口接收可选参数 `{ "provider": "all" | "google" | "codex" }`（默认为 `"all"`）。
3. **差量检测与增量持久化（Diff Reporting）**：
   * 刷新时，网关将最新探测结果与当前缓存进行对比，计算 `added`（新增）、`removed`（下线）、`modified`（属性变更）。
   * **仅在检测到有条目更新时，才更新 `updatedAt` 并写回 `./data/models-cache.json`**。
   * 若无任何变更，不修改更新时间，原样保留缓存，并返回明确提示。
   * 响应示例：
     ```json
     {
       "object": "model_discovery_refresh",
       "provider": "all",
       "updated": true,
       "updatedAt": "2026-10-16T14:38:03.317Z",
       "changes": {
         "google": { "added": [], "removed": [], "modified": ["claude-sonnet-4-6"] },
         "codex": { "added": [], "removed": [], "modified": [] }
       },
       "summary": "已检测到模型更新并保存至缓存：Google: 变更 1 个 (claude-sonnet-4-6)；Codex: 无更新条目",
       "counts": { "total": 28, "google": 19, "codex": 9 },
       "data": [ ... ]
     }
     ```

---

## 路由判定规范 (Deterministic Routing)

网关分流调度中枢 (`Dispatcher.resolveProvider`) **严格废除前缀与关键词启发匹配**（不再依赖 `includes('claude')`、`includes('gpt')` 等模糊推测）：

1. **配置显式路由优先**：匹配 `config.json` 的 `routes` 显式声明；
2. **已发现 Google 模型精准匹配**：若模型存在于当前 Google 模型集合，路由到 `google`；
3. **已发现 Codex 模型精准匹配**：若模型存在于当前 Codex 模型集合，路由到 `codex`；
4. **未识别直接拦截**：未在路由表且未在任何专线模型目录中的请求，直接报错拒绝（提示在 `routes` 中配置或刷新模型列表）。
