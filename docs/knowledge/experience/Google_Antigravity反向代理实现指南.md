# Google Antigravity 到 Claude Code 反向代理实现指南

> [!NOTE] **文档定位说明**  
> 本文档为新网关项目启动前的**上游 Google 专线（Google Cloud Code PA / Antigravity）前置技术参考资产**，用于查阅底层 OAuth 2.0 自动换票与 PA 信封组包细节，**非新项目的主体架构**。  
> 正在进行的统一多云网关核心设计请参阅主文档：👉 [**全能多云反向代理网关架构设计方案**](../多云反向代理网关架构设计方案.md)。

---

## 1. 背景与核心价值（生态断层）

Anthropic 官方开发的 **Claude Code CLI** 与 Google 的 **Google One AI Premium / Antigravity** 处于两个完全互斥的技术生态中：

| 维度 | 下游客户端要求（Claude Code CLI） | 上游真实接口（Google Cloud Code / Antigravity） |
| :--- | :--- | :--- |
| **API 协议** | Anthropic Messages API (`/v1/messages`) | Google Generative AI PA 私有接口 (`v1internal:streamGenerateContent`) |
| **认证方式** | HTTP Header: `x-api-key` 或 `Bearer Token` | Google OAuth 2.0 Bearer Token（绑定 Google 内部 `aicode-consumers` 项目） |
| **数据模型** | Anthropic 格式（`content_blocks`, `tool_use`, `thinking`） | Google 格式（`contents[].parts[]`, `functionDeclarations`） |
| **流式事件** | Anthropic 专属 SSE（`content_block_delta`, `message_delta`） | Google 专属 SSE（`data: {"response": {"candidates": [...]}}`） |
| **客户端校验** | 强制注入 Anthropic 计费头与 Agent 身份特征 | 严格审查竞品指纹，命中即抛出伪装 429 |

### 核心定位
`antigravity-claude-proxy`（命令行简称 `acc`）充当**双向协议翻译官与身份代办处**：
* **对下（面对 Claude Code）**：完全伪装成 Anthropic 官方的 Messages API，响应标准的 Anthropic SSE 事件流。
* **对上（面对 Google）**：完全伪装成官方的 Antigravity 桌面 IDE 客户端，使用 Google OAuth Bearer Token 向上游索取推理结果。

> 💡 **系列导航与疑难排查**：  
> 本文是反向代理系统的**【架构与实现篇】**。如果你在接入重上下文（15+ Skills, 30+ Tools）时遇到启动即报 `400/429 RESOURCE_EXHAUSTED` 的问题，请参阅姊妹篇：  
> 👉 [《Claude Code 接入 Google Antigravity 重上下文 429 故障排查与深度复盘》](./重上下文429故障排查与深度复盘.md)。

---

## 2. 系统拓扑与模块分工

```text
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code CLI (客户端)                  │
│       发送: Anthropic 标准 Messages API (含 Tools/Skills)     │
│       接收: Anthropic 标准 SSE 流 (message_start, delta...)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP: http://localhost:8080/v1/messages
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             antigravity-claude-proxy (核心代理网关)          │
│                                                             │
│  [1. Server 服务入口 (src/server.js)]                       │
│      ├── Express HTTP Server (监听 8080 端口)                │
│      ├── 路由分发 (/v1/messages, /v1/models, /health)       │
│      └── 首包缓冲策略 (First-Chunk Buffering，防下游挂死)    │
│                                                             │
│  [2. 账号与凭据管理层 (src/account-manager/ & src/auth/)]   │
│      ├── OAuth 2.0 自动换 Token (Refresh Token -> Access)   │
│      ├── 项目发现 (loadCodeAssist -> aicode-consumers)      │
│      ├── 多账号调度 (Hybrid / Sticky / Round-Robin 算法)    │
│      └── 本地持久化 (~/.config/antigravity-proxy/accounts.json)
│                                                             │
│  [3. 双向协议格式转换引擎 (src/format/)]                     │
│      ├── Request Converter (Anthropic Schema -> Google)     │
│      ├── Schema Sanitizer (清洗 Google 不支持的 JSON Schema) │
│      ├── Cache Control 清除器 (剥离 Claude 私有缓存标记)     │
│      └── Thinking Utils (思维链签名保护与预算分配)           │
│                                                             │
│  [4. Cloud Code 组包与脱敏层 (src/cloudcode/)]               │
│      ├── Request Builder (封装 Google Cloud Code PA 信封)   │
│      ├── Identity Scrubber (中和 Anthropic 竞品指纹)         │
│      └── Session Manager (会话 ID 派生以保障多轮上下文一致)   │
│                                                             │
│  [5. 流式传输与事件映射层 (src/cloudcode/)]                 │
│      ├── SSE Parser (解析 Google 流式分块)                   │
│      └── SSE Streamer (组装 Anthropic 标准事件推送给下游)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS (带 Google OAuth Bearer Token + 官方防伪 Headers)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│      Google Cloud Code PA (daily-cloudcode-pa.googleapis.com)│
│               执行真实的 Claude 3.5 / Gemini 模型推理         │
└──────────────────────────────┘
```

### 源码模块索引
* `src/server.js`：Express 服务主入口、路由定义、首包缓冲。
* `src/account-manager/`：多账号管理、凭证刷新、策略调度。
* `src/auth/`：OAuth 认证流程与本地 SQLite 数据库扫描。
* `src/format/`：双向请求与响应转换、JSON Schema 深度清洗。
* `src/cloudcode/`：Google 载荷信封组包、SSE 流式解析与事件分发。

---

## 3. Google 身份鉴权与凭证机制

### 3.1 OAuth 2.0 授权机制
* **授权 Scope**：`https://www.googleapis.com/auth/cloud-platform`。
* **双 Token 体系**：
  * **Refresh Token**：长效凭据，存储在 `~/.config/antigravity-proxy/accounts.json` 中。
  * **Access Token**：每次向 Google 请求算力时使用的短期 Bearer Token（有效期 1 小时）。
* **自动静默续期**：在 `src/account-manager/credentials.js` 中，网关在 Access Token 过期前 5 分钟自动向 `https://oauth2.googleapis.com/token` 发送请求刷新 Access Token，用户无感。

### 3.2 账号绑定方式
代理支持两种登录方式：
* **方式 A：WebUI 一键授权（最常用）**：
  启动代理后，浏览器访问 `http://localhost:8080/`，点击 **Add Account**，直接在弹出的 Google 官方网页授权登录。代理内置的本地回调服务（8080/OAuth）自动截获授权码并换取 Token。
* **方式 B：直接复用本地 Antigravity IDE 数据库**：
  在 `src/auth/token-extractor.js` 中，网关可以扫描并读取本地已安装的 Antigravity IDE SQLite 数据库，免密提取当前活跃 Session。

### 3.3 内部项目自动绑定（`loadCodeAssist`）
Google One 订阅用户的免费算力挂载在托管项目 `aicode-consumers`。网关启动时自动向 Google 内部接口 `v1internal:loadCodeAssist` 报到，获取该项目 ID，之后所有请求的外层 JSON 都会自动附带 `project: "aicode-consumers"`。

---

## 4. 核心双向协议转换引擎设计

### 4.1 请求转换（Request Converter）
在 `src/format/request-converter.js` 中完成转换：

| Anthropic 概念 | Google Cloud Code PA 对应映射 | 处理细节与避坑点 |
| :--- | :--- | :--- |
| `system` (字符串或 TextBlocks) | `request.systemInstruction.parts` | 必须剥离 `cache_control`；必须经过 Identity Scrubbing 中和竞品特征。 |
| `messages[i].role` (`user`/`assistant`) | `contents[i].role` (`user`/`model`) | Anthropic 的 `assistant` 必须重命名为 `model`。 |
| `tools` (Anthropic Tool 规范) | `request.tools[0].functionDeclarations` | 格式重构为 Google Function Calling 规范；剔除 `$schema`、`default` 等非法字段。 |
| `tool_use` (Assistant 发起调用) | `parts: [{ functionCall: { name, args } }]` | 工具名称与参数转为 JSON 对象。 |
| `tool_result` (User 返回执行结果) | `parts: [{ functionResponse: { name, response } }]` | 针对 Claude 系列模型，保留部分原生 Anthropic 标识。 |
| `thinking.budget_tokens` | `generationConfig.thinkingConfig` | 映射为 Google 思考预算限制，防止死循环。 |

### 4.2 响应流式转换（SSE Streamer）
在 `src/cloudcode/sse-streamer.js` 中，网关通过 Node.js 异步生成器（`async function*`）逐行接收 Google 报文，并翻译为下游 Claude Code 需要的 5 阶段状态机：
1. **`message_start`**：下发包含消息 ID、模型名和初始元数据的事件。
2. **`content_block_start`**：标记文本块（`type: "text"`）或深度思考块（`type: "thinking"`）的开始。
3. **`content_block_delta`**：将 Google 的 `candidates[0].content.parts[0].text` 打包为 Anthropic 打字机增量推给终端。
4. **`content_block_stop`**：当前块结束；若模型发起工具调用，在此输出 `type: "tool_use"`。
5. **`message_delta` & `message_stop`**：附带 Token 消耗统计（`usage`），优雅断开连接。

### 4.3 官方客户端防伪请求头
在 `src/constants.js` 中，网关向 Google 发送请求时伪装了完整的 Antigravity 二进制特征：
```javascript
export const ANTIGRAVITY_HEADERS = {
    'User-Agent': 'Mozilla/5.0 ... Antigravity/1.110.0',
    'Content-Type': 'application/json',
    'X-Client-Name': 'antigravity',
    'X-Client-Version': '1.110.0',
    'x-goog-api-client': 'gl-node/18.18.2 fire/0.8.6 grpc/1.10.x'
};
```

### 4.4 竞品特征中和机制（Identity Scrubbing）
在 `src/cloudcode/request-builder.js` 中，自动中和敏感关键字：
```javascript
const DEFAULT_IDENTITY_SCRUB = [
    ['Nous Research', 'the assistant team'],
    ['Hermes Agent', 'the assistant'],
    ['Hermes', 'the assistant'],
    ['Anthropic', 'AssistantCorp'],
    ['anthropic', 'assistantcorp'],
    ['ANTHROPIC', 'ASSISTANTCORP']
];

function scrubClientIdentity(text) {
    if (typeof text !== 'string') return text;
    let out = text;
    for (const [term, replacement] of IDENTITY_SCRUB_RULES) {
        out = out.split(term).join(replacement);
    }
    out = out.replace(/Anthropic/gi, 'AssistantCorp');
    return out;
}
```

> 🔍 **关于竞品过滤与 429 报错的深度排查**：  
> 详见姊妹篇：[《Claude Code 接入 Google Antigravity 重上下文 429 故障排查与深度复盘》](./重上下文429故障排查与深度复盘.md)，内含单变量二分探针实验设计与 Google 云端 WAF 的黑名单过滤机制拆解。

### 4.5 首包缓冲策略（First-Chunk Buffering）
如果网关在收到上游第一个 Chunk 之前就提前执行了 `res.writeHead(200)`，一旦上游在首包报错（如 429/500），网关无法再改写 HTTP 状态码，导致客户端报协议解析崩溃。  
网关使用首包缓冲策略：**必须在内存中成功拉取到第一条有效业务 Chunk 之后，才执行 `res.flushHeaders()` 输出 200 OK**；若首包抛错，则直接返回标准 JSON 错误格式。

---

## 5. 账号调度与防限流策略（多账号池）

在 `src/account-manager/strategies/` 中支持多种调度策略：
* **Hybrid 策略（默认）**：基于账号健康分（Success Rate、延迟、连续失败次数）智能评分，优先选用综合素质最高的账号。
* **Sticky Session 策略**：同一个会话（根据首条 User 消息哈希派生 Session ID）尽量固定在同一个 Google 账号上，以便充分利用 Google 服务端的 Prompt Cache 降低延迟。
* **自动熔断与降级**：当某个账号在某个模型上真正用尽额度时，自动降级切换至备用账号或备用模型。

---

## 6. 从零部署、启动与运维实操

### 6.1 全局安装
```powershell
npm install -g antigravity-claude-proxy
```
安装后系统会全局注册 `acc` 命令。

### 6.2 启动与管理命令
| 操作 | 命令 | 说明 |
| :--- | :--- | :--- |
| **前台调试启动** | `acc start --log` | 实时打印彩色日志，观察请求与模型调用情况 |
| **后台静默启动** | `acc start` | 后台常驻守护运行 |
| **查看运行状态** | `acc status` | 查看监听端口、在线账号列表及配额健康度 |
| **停止服务** | `acc stop` | 杀掉后台运行的代理进程 |

### 6.3 网络代理设置（国内直连必备）
由于 Google 服务器在境外，启动前必须设置代理端口（例如本地代理 7890 端口）：
```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
acc start --log
```

### 6.4 账号登录与配额看板
启动后，直接在浏览器中打开：
* **Web 控制台**：`http://localhost:8080/`（可点击 Add Account 扫码/授权添加多账号）
* **配额查询接口**：`http://localhost:8080/account-limits?includeHistory=true`（可以看到 Sonnet 4.6、Gemini 3.8 各个模型的精确剩余百分比）

---

## 7. Claude Code 与 CC Switch 接入配置

打开 CC Switch，设置以下环境变量即可一键接通：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_AUTH_TOKEN": "test",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-6-thinking",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "claude-opus-4-6-thinking",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini-3.8-flash-medium",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "gemini-3.8-flash-medium",
    "CLAUDE_CODE_SUBAGENT_MODEL": "gemini-3.8-flash-high"
  }
}
```

* **主模型（Sonnet）**：`claude-sonnet-4-6` —— 响应在 3 秒左右，完美执行 Claude Code 所有工具和重型上下文。
* **思考模型（Opus）**：`claude-opus-4-6-thinking` —— 耗时 10~15 秒，提供超深度逻辑思维链。
* **轻量子代理（Haiku/Subagent）**：`gemini-3.8-flash-medium` 或 `gemini-3.8-flash-high`。

---

## 8. 延伸阅读与疑难排查

* 📖 **本系列故障排查专文**：  
  [《Claude Code 接入 Google Antigravity 重上下文 429 故障排查与深度复盘》](./重上下文429故障排查与深度复盘.md)  
  *深入记录了面对首句报错 429 时，如何通过单变量脱机探针排除容量假设、如何抓包比对发现 Google 云端黑名单过滤，以及如何解开网关本地 30 分钟自锁死锁的技术复盘与 5 条长效经验法则。*
