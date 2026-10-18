# 项目指引与 Agent 入口 (AGENTS.md)

欢迎使用 **Janus Gateway（雅努斯网关）**。本项目专注于**新一代多云虚拟模型提供商网关（Virtual Model Gateway）**的研发与生态桥接。

---

## 正在进行的核心工程：Janus Gateway 多云虚拟模型提供商网关
* **核心定位**：对外作为统一的“虚拟模型提供商”，同时暴露标准的 **Anthropic Messages 接口 (`/v1/messages`)** 与 **OpenAI Chat 接口 (`/v1/chat/completions`)**，下游可无缝接入 Claude Code CLI、Cursor、Cline、Aider 等任何 Agent 客户端。
* **上游双基石**：
  * **Google 专线**：复用本地 `acc` (`antigravity-claude-proxy`) 的 OAuth 2.0 自动换票与 PA 信封，无缝消耗 Google One/Antigravity 配额（Claude Sonnet 4.6, Gemini 3.8）；
  * **Codex 算力专线**：参考 `ccr` (`claude-code-router`) 核心能力，自动捕获本地 `~/.codex/auth.json` 登录态，直连 OpenAI Codex 专属后端（`chatgpt.com/backend-api/codex/responses`），直接使用 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-5.5` 等前沿模型，无需按 Token 付费。
* **当前状态**：完成 Google Antigravity 与 Codex 订阅算力双专线；不接入 OpenAI 商业 API。OpenAI Chat Completions 仅作为下游兼容协议。底层完成规范中间表示 (IR)、SSE 流式状态机升级与 Node.js 原生 Cluster 零中断长连接优雅排空。Google 与 Codex 均已接入 effort 档位探测保存。全面落地**模型多维分类（替代过滤）、Codex 接口直连无别名、持久化缓存差量比对写盘与汇报、废除启发式推断的确定性路由**。管理页面支持分类展示筛选、手动差量刷新、全专线模型探测、本地账号状态、真实连接检查、订阅额度刷新及请求日志/使用统计。支持一键 `npm start` 启动服务与 `npm test` 执行回归测试。

---

## 知识库分层与导航入口
本项目所有技术方案与知识沉淀统一归档于 `docs/knowledge/`，按“**当前核心工程规范**”与“**上游前置参考资产**”严格分层维护：

* [**项目使用说明 (README - English)**](README.md)
* [**项目使用说明 (README - 简体中文)**](README_CN.md)

* [**知识库总索引与系统状态 (Knowledge Index)**](docs/knowledge/知识库总索引.md)

### 1. 当前核心工程主文档（必须优先阅读）
* [**多云反向代理网关架构设计方案 (Multi-Provider Agent Gateway Design)**](docs/knowledge/多云反向代理网关架构设计方案.md)  
  *新项目权威架构总纲，包含虚拟模型提供商规范、MVP 最小拓扑、双入口转换矩阵与后期 5 大扩展维度。*
* [**多云思考强度统一转换与协议对齐规范 (Unified Reasoning Effort Architecture)**](docs/knowledge/多云思考强度统一转换与协议对齐规范.md)  
  *全网关思考强度总规范：双入口优先级、Google Level/Budget 双模与输出约束联动、Codex 阈值分档换算与流式思考统一投影。*
* [**云厂商反代检测机制与网关防检规避规范 (Anti-Proxy Detection & Evasion Guide)**](docs/knowledge/云厂商反代检测机制与网关防检规避规范.md)  
  *全网关安全对抗总规范：云厂商六维检测网（IP/TLS/Header/载荷语义/凭据挑战/时序行为）深度剖析，网关六重防检规避与工程落地 Checklist。*
* [**多云提示词缓存机制与网关对齐规范 (Prompt Caching Architecture Guide)**](docs/knowledge/多云提示词缓存机制与网关对齐规范.md)  
  *全网关缓存架构总规范：三大缓存流派（显式断点/隐式前缀/持久化资产）机制差异、脱敏与 KV Cache 协同保障机制、前缀冷冻排版与多账号粘性路由。*
* [**Google专线工具协议净化与客户端自愈规范 (Tool Schema Sanitization & Client Self-Healing Guide)**](docs/knowledge/Google专线工具协议净化与客户端自愈规范.md)  
  *全网关工具协议总规范：入站 7 阶段 Schema 净化与业务字段隔离保护、出站工具入参自愈（空模式重置、Glob 通配符提取与补全、生态工具别名规范化）、Gemini 3+ 签名回填与跨轮自愈。*
* [**零停机热升级与长连接平滑排空设计 (Zero-Downtime Hot Reload & Stream Draining)**](docs/knowledge/零停机热升级与长连接平滑排空设计.md)  
  *全网关高可用运维总规范：Node.js 原生 Cluster Master-Worker 架构、长连接 In-Flight 追踪排空、零端口冲突滚动热重载。*

### 2. 上游前置技术参考（用于驱动开发时查阅，非核心架构）
* [**Google Antigravity 反向代理实现指南 (Proxy Architecture & Implementation)**](docs/knowledge/experience/Google_Antigravity反向代理实现指南.md)
  *旧版实现参考：记录 Google OAuth 2.0 换票机与 Cloud Code PA 内部接口协议细节，供移植 Google 驱动模块时参考。*
* [**重上下文 429 故障排查与深度复盘篇 (Heavy Context 429 Postmortem)**](docs/knowledge/experience/重上下文429故障排查与深度复盘.md)
  *风控避坑参考：记录 Google 云端对敏感竞品指纹（`Anthropic`）的 WAF 拦截机制与敏感词清洗验证证据。*

---

## 工程运行与服务热更新约定 (Service Hot Reloading & Daemon Convention)
* **启动标准**：长期运行推荐使用集群守护模式（`npm run start:cluster`）或 Windows 后台静默服务（`npm run service:install` / `npm run service:start`，基于原生 Cluster + Startup 目录 + VBScript 静默宿主）。
* **强制热更新约定**：由于网关承载着下游 Agent 客户端（Claude Code CLI、Cursor 等）的长时间流式 SSE 推理长连接（In-Flight Requests），**任何代码更新、路由调整或配置修改后，严禁直接杀进程强制重启**。
* **平滑重载操作**：无论在前台集群还是后台服务模式下，统一使用一键热重载指令：
  ```bash
  npm run reload
  ```
  *(或调用 `POST /v1/admin/gateway/upgrade`)*。Master 进程自动派生新 Worker 加载最新代码，握手就绪后平滑接管 `18763` 端口分发，通知旧 Worker 优雅排空现存长连接后安全退出，确保零连接中断、零丢包与零端口争抢（`EADDRINUSE`）。
* **后台服务管理**：
  * 查看运行状态：`npm run service:status`
  * 启停控制：`npm run service:stop`、`npm run service:start`、`npm run service:restart`
  * 开机自启：`npm run service:install`、`npm run service:uninstall`

---

## 各项目的知识库约定
- 每个项目都应使用并维护知识库；优先复用已有内容，没有则建立最小知识库。
- 项目 `AGENTS.md` 或者 `CLAUDE.md` 应链接知识库总索引与当前状态；开始任务先读这两个入口，再按需查阅。
- 任务中的重要变化应同步沉淀；具体文档组织、记录、验证及交接规则使用 `task-knowledge` 技能。
