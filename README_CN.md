<div align="center">

# 🚪 Janus Gateway (雅努斯网关)

**专为自主 AI Agent 打造的新一代多云虚拟模型提供商网关**

*聚合 Google Antigravity 与 OpenAI Codex 订阅算力，对外暴露标准 Anthropic 与 OpenAI 接口，支持零停机热升级与长连接自愈。*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![High Availability](https://img.shields.io/badge/Cluster-Zero--Downtime%20Drain-purple.svg)](docs/knowledge/零停机热升级与长连接平滑排空设计.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS%20%7C%20Docker-lightgrey.svg)](#-支持平台与运行环境)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](CONTRIBUTING.md)

[English](README.md) | [简体中文](README_CN.md)

</div>

---

## ⚡ 诞生背景与核心破局

当开发者在日常工作中使用 **Claude Code CLI**、**Cursor**、**Aider** 或 **Cline** 等重度自主 Agent 客户端时，普遍面临两大痛点：
1. **官方商业 API 成本高昂**：Agent 单次迭代往往携带 3 万到 10 万 tokens 的沉重系统上下文（包含大量 Skills、Subagents、Tools、项目规则），按 Token 计费如同高速燃烧资金；
2. **传统开源逆向网关极度脆弱**：经常因工具参数格式不兼容直接闪退报错（如 `EnterPlanMode unexpected parameter`、`Glob missing pattern`）、缺失 Gemini 3+ 的 `thoughtSignature` 导致 400 阻断、因携带竞品指纹触发 Google WAF 429 假限流，或在更新重启网关时粗暴杀进程导致在途长连接被强制切断。

**Janus Gateway**（取名自罗马神话中的双面门神与通道之神“雅努斯”）专为彻底解决上述问题而生：
* **下游双面合规**：对外作为统一的虚拟模型提供商，同时暴露标准的 **Anthropic Messages 接口 (`/v1/messages`)** 与 **OpenAI Chat 接口 (`/v1/chat/completions`)**；
* **上游双专线聚合**：无缝消耗本地 Google One/Antigravity（Claude Sonnet 4.6, Gemini 3.8）与 OpenAI Codex 订阅算力（`gpt-6.1-sol`、`gpt-6-astra`），无需按 Token 计费；
* **工程底座硬核加固**：原生集成 **Node.js Cluster 零停机长连接平滑排空**、**7 阶段 JSON Schema 净化**、**出站工具参数自愈**、**Gemini 3+ 签名回填**及**上下文全域防检中和**。

---

## 📊 三维能力特性对比

| 核心维度 | 官方商业 API | 常见普通逆向网关 | **Janus Gateway** |
| :--- | :--- | :--- | :--- |
| **计费方式** | 按 Token 阶梯消耗（昂贵） | 免费但极易中断 | **使用订阅算力，零 Token 账单** |
| **算力来源** | 单一厂商商业后端 | 单一来源，缺乏聚合 | **Google Antigravity + OpenAI Codex 双专线** |
| **下游协议兼容** | 仅限单一厂商规范 | 部分支持 OpenAI | **Anthropic Messages + OpenAI Chat 双协议** |
| **Agent 工具容错** | 严格模式（格式微瑕即崩） | 缺乏容错，频繁报错闪退 | **7 阶段 Schema 净化 + 双向参数智能自愈** |
| **Gemini 3+ 思考** | 不支持跨厂商模型思考 | 丢失签名触发 400 报错 | **内置 LRU 签名缓存，多轮自动回填** |
| **服务运维重载** | 云端黑盒管理 | 暴力杀进程（丢包断流） | **Cluster 优雅排空，长连接零中断** |
| **云端风控防检** | 无防检需求 | 暴露真实竞品指纹易被限流 | **上下文全域敏感特征清洗与中和** |
| **后台守护支持** | 无 | 需繁琐配置第三方 PM2/NSSM | **原生免提权 Windows 静默后台服务** |

---

## 🏛️ 架构拓扑全景图

```
+-----------------------------------------------------------------------------------+
|                              下游 Agent 客户端生态                                |
|        (Claude Code CLI, Cursor, Cline, Aider, Chatbox, NextChat, etc.)           |
+-----------------------------------------------------------------------------------+
                                   │              │
                   Anthropic /v1/messages         OpenAI /v1/chat/completions
                                   ▼              ▼
+───────────────────────────────────────────────────────────────────────────────────+
|                               Janus Gateway 核心网关                              |
|                                                                                   |
|  [入站协议适配器] ──► [统一规范中间表示 (IR)] ──► [确定性路由分发总控]             |
|                                 │                               │                 |
|             ┌───────────────────┴───────────────────┐           │                 |
|             ▼                                       ▼           │                 |
|    上下文敏感特征中和清洗器                7 阶段 JSON Schema 净化器│              |
|    (中和竞品敏感指纹，防云端拦截)           与工具入参智能自愈状态机              |
|             │                                       │           │                 |
|             └───────────────────┬───────────────────┘           │                 |
|                                 ▼                               ▼                 |
|                 [Node.js 原生 Cluster Master / 在途连接追踪排空]                  |
+───────────────────────────────────────────────────────────────────────────────────+
                                   │              │
                Google Cloud Code  │              │  OpenAI Codex
                PA 内部协议        │              │  Responses 专属协议
                                   ▼              ▼
+──────────────────────────────────────+      +─────────────────────────────────────+
|           Google 驱动专线            |      |            Codex 驱动专线           |
| • OAuth 2.0 账号池与自动静默续期     |      | • 本地 ~/.codex/auth.json 凭据捕获  |
| • Gemini 3+ Thought 签名自动缓存回填 |      | • 原生 Responses 流式高效解析转换   |
| • 思考强度 (Effort / Budget) 自动对齐|      | • 推理强度多档换算 (low/medium/high)|
| • 上游 PA 接口实时额度主动探测       |      | • 订阅时间窗口追踪与连通性检查      |
+──────────────────────────────────────+      +─────────────────────────────────────+
                                   │              │
                                   ▼              ▼
                 Google One AI Premium / Antigravity     ChatGPT Plus/Pro Codex 后端
                 (Claude Sonnet 4.6, Gemini 3.8)         (gpt-6.1-sol, gpt-6-astra, etc.)
```

---

## 🌟 六大核心技术亮点

### 1. 零停机滚动热重载与长连接平滑排空 (Zero-Downtime Hot Reload)
* **长连接 In-Flight 追踪**：实时追踪每一条正在传输的 SSE 推理长连接；
* **双进程无感交接**：修改配置或更新代码后，运行 `npm run reload`（或调用 `POST /v1/admin/gateway/upgrade`）。Master 进程派生新 Worker 并完成健康握手后平滑接管 `18763` 端口分发，通知旧 Worker 优雅排空现存连接后退出，**彻底告别 `EADDRINUSE` 端口冲突、连接中断与客户端闪退**。

### 2. Google PA 协议 7 阶段工业级 Schema 净化流水线
针对 Claude Code CLI 传入的复杂高级 JSON Schema，执行 7 个刚性处理阶段：
1. **约束降维**：将 `$ref`、`enum` 列表、`additionalProperties`、`exclusiveMinimum` 等关键字转化为自然语言说明，注入 `description`；
2. **联合类型扁平化**：解构 `anyOf` / `oneOf`，展开 `type: ["string", "null"]` 数组；
3. **非标字段强力剥除**：剔除 `$schema`、`$defs`、`definitions`、`default` 等上游拒绝的非标字段；
4. **业务字段隔离保护**：保护 `Glob` 的 `pattern`、`TaskCreate` 的 `title` 等业务属性不被误杀；
5. **Protobuf 大写映射**：统一映射为 Google 要求的全大写类型枚举；
6. **数组项刚性规范**：强制数组节点具备合法的单数 `items`；
7. **空对象占位合成**：针对空结构注入合成属性，规避 Protobuf 空结构校验 400 报错。

### 3. Agent 工具调用双向自愈与 Gemini 3+ 签名闭环
* **`EnterPlanMode` 空参数自愈**：Gemini 生成的合成参数（如 `{ reason: "..." }`）在出站前被强制重置为干净的 `{}`，根除 Claude Code CLI 的 `unexpected parameter reason` 报错；
* **`Glob` 通配符智能提取**：模型未传 `pattern` 时，自动从 `path` 提取通配符，或对目录路径自动补全 `**/*`；
* **生态工具别名规范化**：自动归一化 `WebSearch`、`WebFetch`、`Grep`、`FileRead`、`Bash` 等常见参数混淆；
* **Gemini 3+ 跨轮签名回填 (`SignatureCache`)**：出站时自动截获并缓存 `thoughtSignature`；下一轮客户端返回 `tool_result` 时精准重贴回 `functionCall`，根除签名丢失报错。

### 4. 首包缓冲与流式全链路加固 (First-Chunk Buffering)
* **拒绝虚假 200**：首包有效数据到达前不下发 200 响应头。上游报错时回退标准 JSON 错误，防止客户端出现半流断裂；
* **客户端断连主动取消**：当下游用户按 `Ctrl+C` 中止输出时，网关立即向 Google / Codex 上游发送取消信号，阻断无谓算力浪费。

### 5. Google 实时额度主动探测 (Quota Telemetry)
* 反向解析 Google Cloud Code PA 内部接口，不仅支持在控制台直观查看，还提供一键 CLI 指令：
  ```bash
  npm run account:quota
  ```
  按账号输出 Gemini、Claude/GPT 算力池的 5 小时与周额度汇总窗口、剩余百分比及重置倒计时；各账号独立展示。

### 6. 原生 Windows 后台静默服务套件 (Zero-Dependency Daemon)
* 纯原生 PowerShell 5.1 与 VBScript 静默宿主驱动，完全无需配置第三方进程守护程序（如 NSSM/PM2）；
* **一键安装自启**：写入 Windows 当前用户 Startup 目录，普通用户权限即可 100% 成功生效，开机无黑框弹窗静默运行；
* **崩溃自愈**：配合系统任务计划程序，异常崩溃 1 分钟内自动复活。

---

## 🚀 极速上手 (Quick Start)

### 运行环境准备
* **Node.js**：`>= 18.0.0`（推荐 Node.js v20 或 v24，原生支持 `--experimental-strip-types`）；
* **凭据准备**：
  * **Google 专线**：准备一个具备 Google Cloud Code / Antigravity 权限的 Google 账号（支持在 Web 控制台一键浏览器授权）；
  * **Codex 专线**：本地登录过 Codex 环境（存在 `~/.codex/auth.json` 文件）。

### 安装与启动

```bash
# 1. 克隆代码仓库
git clone https://github.com/yuyan98A/janus-gateway.git
cd janus-gateway

# 2. 安装项目依赖
npm install

# 3. 从模板生成配置文件
cp config.example.json config.json

# 4. 启动网关服务
# 常规前台模式：
npm start

# 或生产级零停机集群模式（推荐）：
npm run start:cluster
```

* **网关默认地址**：`http://127.0.0.1:18763`
* **Web 管理控制台**：浏览器访问 `http://127.0.0.1:18763/`
* **默认 API Key**：`sk-gateway-local-token`（可在 `config.json` 中自定义）

---

## 💻 客户端接入配置指南

### 1. Claude Code CLI 接入

#### Windows 环境 (PowerShell)：
```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:18763"
$env:ANTHROPIC_API_KEY = "sk-gateway-local-token"
claude
```

#### Linux / macOS 环境 (Bash / Zsh)：
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:18763"
export ANTHROPIC_API_KEY="sk-gateway-local-token"
claude
```

> 💡 **模型选择建议**：在 Claude Code 中可自由切换 `claude-sonnet-4-6`、`claude-opus-4-6-thinking`、`gpt-6.1-sol`、`gemini-3.8-flash` 等。

---

### 2. Cursor IDE 接入

1. 打开 Cursor 的 **Settings** -> **Models**；
2. 在 **OpenAI API Key** 中填写：`sk-gateway-local-token`；
3. 勾选 **Override OpenAI Base URL** 并填写：
   ```text
   http://127.0.0.1:18763/v1
   ```
4. 在模型列表中添加需要使用的模型，例如 `claude-sonnet-4-6`、`gpt-6.1-sol`、`gemini-3.8-flash` 等。

---

### 3. Aider 终端编程助手

```bash
aider --openai-api-base http://127.0.0.1:18763/v1 --openai-api-key sk-gateway-local-token --model gpt-6.1-sol
```

---

## 🛠️ 生产运维与后台服务

### 无痛零停机平滑升级
修改了 `config.json` 中的路由规则或更新了项目代码后，直接执行：
```bash
npm run reload
```
Master 进程会自动 Fork 新 Worker 并完成握手验证，平滑接管新请求，同时保障现存的所有流式会话输出完整，绝不中断。

### Windows 后台静默服务控制
```bash
# 一键安装开机静默自启并立即在后台启动
npm run service:install

# 查看后台服务运行状态（PID、内存占用、自启状态）
npm run service:status

# 启停与重启
npm run service:stop
npm run service:restart

# 卸载开机自启
npm run service:uninstall
```

### 实时探测 Google 账号池配额
```bash
npm run account:quota
```
控制台按账号打印算力池的 5 小时与周额度剩余百分比、重置时间和可用状态。

查询对齐 CLIProxyAPI：使用 Hub 请求头，按 daily → sandbox → production 顺序读取汇总窗口；各账号独立展示，不合并跨端点数据，缺失额度不补成 100%。详见[配额查询机制与验证](docs/knowledge/Google_Antigravity配额机制与多端点订阅层设计.md)。

---

## 🧪 自动化回归测试套件

网关内置了严格的测试验证矩阵，确保全链路稳定性：

```bash
npm test
```

覆盖测试项包含：
* Windows 后台守护脚本与 PowerShell 5.1 兼容性测试；
* Agent 工具入参自愈器（EnterPlanMode / Glob 等参数自愈）；
* Google PA Schema Sanitizer 7 阶段流水线断言；
* 全域敏感特征中和与防检清洗验证；
* 规范中间表示 (IR) 与 EventSource 流式状态机解析测试；
* 模拟长时间流式响应下的零停机排空平滑升级验证；
* Google 账号池静默续期与项目发现流程测试；
* 真实端到端 Anthropic `/v1/messages` 与 OpenAI `/v1/chat/completions` 全量回归。

---

## 📚 知识库与设计文档

系统底层完整设计思想与演进复盘已整理至 `docs/knowledge/`：

* [**知识库总索引与系统状态**](docs/knowledge/知识库总索引.md)
* [**多云反向代理网关架构设计方案**](docs/knowledge/多云反向代理网关架构设计方案.md)
* [**多云思考强度统一转换与协议对齐规范**](docs/knowledge/多云思考强度统一转换与协议对齐规范.md)
* [**零停机热升级与长连接平滑排空设计**](docs/knowledge/零停机热升级与长连接平滑排空设计.md)
* [**Google 专线工具协议净化与客户端自愈规范**](docs/knowledge/Google专线工具协议净化与客户端自愈规范.md)
* [**云厂商反代检测机制与网关防检规避规范**](docs/knowledge/云厂商反代检测机制与网关防检规避规范.md)

---

## 🛡️ 免责声明 (Disclaimer)

1. **非官方声明**：本项目为独立研发的第三方协议转换网关，与 Google、OpenAI 或 Anthropic 均无任何官方关联、赞助或背书；
2. **学术与研究用途**：本项目仅供技术架构研究、协议转换探索与个人本地开发调试之用；
3. **服务条款遵守**：使用者需自行负责并遵守相关云服务提供商的使用条款（ToS）。开发者不对使用者因使用本软件造成的任何账号限制、配额变动或衍生后果承担任何责任。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。Copyright © 2026 yuyan98A.
