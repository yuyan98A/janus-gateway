<div align="center">

# 🚪 Janus Gateway

**The Two-Faced Virtual Model Gateway for Autonomous AI Agents**

*Aggregate Google Antigravity & OpenAI Codex Subscription Compute into Standard Anthropic & OpenAI API Protocols with Zero-Downtime Hot-Reload and Self-Healing Streaming.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![High Availability](https://img.shields.io/badge/Cluster-Zero--Downtime%20Drain-purple.svg)](docs/knowledge/零停机热升级与长连接平滑排空设计.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS%20%7C%20Docker-lightgrey.svg)](#platform-support)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](CONTRIBUTING.md)

[English](README.md) | [简体中文](README_CN.md)

</div>

---

## ⚡ Overview

When developers run agentic coding CLI tools like **Claude Code CLI**, **Cursor**, **Aider**, or **Cline**, they face two critical dilemmas:
1. **Official Pay-Per-Token APIs**: Extremely expensive when handling deep agent loops (30k+ token system prompts, dozens of skills/tools, continuous self-iterations).
2. **Brittle Reverse Proxies**: Vulnerable to protocol mismatches, broken SSE streaming, tool-call crashes (`EnterPlanMode`, `Glob missing pattern`), 429 WAF bans from competitor fingerprint leakage, and abrupt connection drops during server reloads.

**Janus Gateway** solves this comprehensively. Named after the Roman deity of duality and transitions, Janus stands between agent clients and multi-cloud backends:
* **Downstream**: Exposes compliant **Anthropic Messages (`/v1/messages`)** and **OpenAI Chat (`/v1/chat/completions`)** APIs.
* **Upstream**: Taps directly into local Google Cloud Code / Antigravity OAuth and OpenAI Codex subscription backends without token costs.
* **Core Engine**: Equipped with **zero-downtime cluster hot-reloading with stream draining**, **7-stage JSON Schema sanitization**, **bidirectional tool-call auto-healing**, and **universal brand neutralization (anti-detection)**.

---

## 📊 Feature Comparison

| Capability | Official Commercial API | Traditional Reverse Proxy | **Janus Gateway** |
| :--- | :--- | :--- | :--- |
| **Pricing Model** | Pay-as-you-go per Token (Expensive) | Free (Fragile) | **Zero Token Cost (Uses Subscription)** |
| **Compute Sources** | Single Vendor API | Fragmented scripts | **Google Antigravity + OpenAI Codex** |
| **Downstream Protocols** | Proprietary to vendor | Partial OpenAI or Anthropic | **Full Dual: Anthropic + OpenAI** |
| **Agent Tool Healing** | Strict (crashes on schema quirks) | Fails on complex tool schemas | **7-Stage Sanitization + Auto-Healing** |
| **Gemini 3+ Thinking** | N/A | Drops `thoughtSignature` (400 Error) | **Auto LRU Cache & Signature Re-injection** |
| **Service Reloading** | Managed | `kill -9` (Kills active streams) | **Cluster Zero-Downtime Stream Draining** |
| **Anti-Detection** | N/A | Exposes competitor prompt signatures | **Universal Context Identity Neutralization** |
| **Background Service** | Cloud-only | Third-party PM2/NSSM needed | **Native Zero-Dependency Windows Daemon** |

---

## 🏛️ Architecture Topology

```
+-----------------------------------------------------------------------------------+
|                            Downstream Agent Clients                               |
|        (Claude Code CLI, Cursor, Cline, Aider, Chatbox, NextChat, etc.)           |
+-----------------------------------------------------------------------------------+
                                   │              │
                   Anthropic /v1/messages         OpenAI /v1/chat/completions
                                   ▼              ▼
+───────────────────────────────────────────────────────────────────────────────────+
|                               Janus Gateway Core                                  |
|                                                                                   |
|  [Ingress Adaptors] ──► [Canonical Protocol IR] ──► [Deterministic Dispatcher]    |
|                                 │                               │                 |
|             ┌───────────────────┴───────────────────┐           │                 |
|             ▼                                       ▼           │                 |
|   Universal Payload Scrubber               7-Stage Tool Sanitizer│                |
|   (Neutralize Brand Fingerprints)          & Parameter Self-Healer                 |
|             │                                       │           │                 |
|             └───────────────────┬───────────────────┘           │                 |
|                                 ▼                               ▼                 |
|                 [Node.js Cluster Master / In-Flight Drainer]                      |
+───────────────────────────────────────────────────────────────────────────────────+
                                   │              │
                Google Cloud Code  │              │  OpenAI Codex
                PA Protocol        │              │  Responses Protocol
                                   ▼              ▼
+──────────────────────────────────────+      +─────────────────────────────────────+
|           Google Pipeline            |      |            Codex Pipeline           |
| • OAuth2 Token Pool & Auto-Renewal   |      | • Local ~/.codex/auth.json Ingestion|
| • Gemini 3+ Thought Signature Cache  |      | • High-Performance Responses Stream |
| • Effort / Budget Auto-Mapping       |      | • Reasoning Effort Tuning (low/high)|
| • Real-Time Quota Telemetry Probing  |      | • Subscription Window Tracking      |
+──────────────────────────────────────+      +─────────────────────────────────────+
                                   │              │
                                   ▼              ▼
                 Google One AI Premium / Antigravity     ChatGPT Plus/Pro Codex Engine
                 (Claude Sonnet 4.6, Gemini 3.8)         (gpt-6.1-sol, gpt-6-astra, etc.)
```

---

## 🌟 Key Highlights

### 1. Zero-Downtime Cluster Hot-Reload & Stream Draining
* **In-Flight Stream Protection**: Active long-running SSE connections are isolated and protected. When upgrading configuration or code, the master process spawns a fresh worker, verifies health and port readiness, and only then switches traffic.
* **Zero Drop, Zero Port Conflict**: Old workers gracefully drain existing streams before self-terminating. Run `npm run reload` anytime without interrupting agent generations.

### 2. 7-Stage Schema Sanitization & Tool Self-Healing
* **Schema Sanitization**: Automatically transforms unsupported JSON Schema constraints (`anyOf`, `allOf`, multi-type arrays `["string", "null"]`, `exclusiveMinimum`) into natural language descriptions, preventing upstream Google Protobuf 400 rejections.
* **Claude Code Parameter Auto-Healing**:
  - `EnterPlanMode`: Automatically strips unexpected synthetic properties (e.g., `{ reason: "..." }`) down to `{}`.
  - `Glob`: Automatically extracts wildcards from `path` to `pattern` or injects default `"**/*"`.
  - Normalizes aliases for `WebSearch`, `WebFetch`, `Grep`, `FileRead`, and `Bash`.
* **Gemini 3+ Thought Signature Recovery**: Intercepts and caches `thoughtSignature` on outgoing tool calls; transparently restores them on the next round when clients reply with `tool_result`.

### 3. Google Antigravity & Codex Dual Subscription Pipelines
* **Google Pipeline**: Auto-manages Google OAuth accounts in `./data/google-accounts.json`, silently refreshes Access Tokens, and exposes active quota telemetry (`GET /v1/admin/google/quota`).
* **Codex Pipeline**: Reads local `~/.codex/auth.json` to stream responses directly from `chatgpt.com/backend-api/codex/responses` without any API billing.

### 4. Native Windows Background Service (Zero External Dependencies)
* Built-in PowerShell & VBScript daemon suite.
* Install as a silent background service with automatic autostart:
  ```bash
  npm run service:install
  ```
* No console windows, zero window flashes, and automatic crash recovery.

---

## 🚀 Quick Start

### Prerequisites
* **Node.js**: `>= 18.0.0` (Node.js v20+ or v24 recommended, supports `--experimental-strip-types`).
* **Authentication**:
  * **Google**: A Google account with Cloud Code / Antigravity access (can authenticate via Web UI).
  * **Codex**: Logged-in state in `~/.codex/auth.json` (from Codex CLI / extension).

### Installation & Launch

```bash
# 1. Clone the repository
git clone https://github.com/yuyan98A/janus-gateway.git
cd janus-gateway

# 2. Install dependencies
npm install

# 3. Create your configuration from the template
cp config.example.json config.json

# 4. Start the gateway
# Standard mode:
npm start

# OR Production zero-downtime cluster mode (Recommended):
npm run start:cluster
```

* **Gateway Endpoint**: `http://127.0.0.1:18763`
* **Web Dashboard**: Open `http://127.0.0.1:18763/` in your browser.
* **Default API Key**: `sk-gateway-local-token` (configurable in `config.json`).

---

## 💻 Client Setup Guides

### 1. Claude Code CLI

#### On Windows (PowerShell):
```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:18763"
$env:ANTHROPIC_API_KEY = "sk-gateway-local-token"
claude
```

#### On Linux / macOS (Bash / Zsh):
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:18763"
export ANTHROPIC_API_KEY="sk-gateway-local-token"
claude
```

> **Pro Tip**: Use models like `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-6.1-sol`, or `gemini-3.8-flash`.

---

### 2. Cursor IDE

1. Open **Settings** -> **Models** in Cursor.
2. Under **OpenAI API Key**, input: `sk-gateway-local-token`.
3. Check **Override OpenAI Base URL** and enter:
   ```text
   http://127.0.0.1:18763/v1
   ```
4. Add models such as `claude-sonnet-4-6`, `gpt-6.1-sol`, `gemini-3.8-flash`.

---

### 3. Aider

```bash
aider --openai-api-base http://127.0.0.1:18763/v1 --openai-api-key sk-gateway-local-token --model gpt-6.1-sol
```

---

## 🛠️ Management & Operations

### Hot-Reloading in Action
Whenever you modify `config.json` routes or update source code:
```bash
npm run reload
```
The Cluster Master spawns a new worker, tests it, switches incoming requests seamlessly, and drains active SSE streams without dropping tokens.

### Native Windows Background Service
```bash
# Install and enable silent autostart on Windows
npm run service:install

# Check service health and live PID
npm run service:status

# Stop or restart
npm run service:stop
npm run service:restart

# Uninstall autostart
npm run service:uninstall
```

### Checking Real-Time Google Quotas
```bash
npm run account:quota
```
Outputs live 5-hour and weekly compute-pool quotas and reset countdowns separately for each Google account. Queries follow CLIProxyAPI's Hub headers and daily → sandbox → production fallback order; results are never merged across accounts or endpoints, and missing quotas are never assumed to be 100%. See the [quota mechanism and verification notes](docs/knowledge/Google_Antigravity配额机制与多端点订阅层设计.md).

---

## 🧪 Automated Test Suite

Janus Gateway is verified with comprehensive automated test suites:

```bash
npm test
```

Tests include:
* Service script syntax and Windows backward-compatibility.
* Tool call healer and Claude Code parameter repair.
* Google PA Schema Sanitizer 7-phase assertions.
* Universal payload scrubber & anti-detection neutralizer.
* Canonical Protocol IR and EventSource SSE state machine tests.
* Active streaming zero-downtime drain tests under load.
* Google Account Pool validation and token refresh logic.
* Live end-to-end Anthropic `/v1/messages` and OpenAI `/v1/chat/completions` verification.

---

## 🛡️ Responsible Usage & Disclaimer

1. **Non-Affiliation**: This project is an independent open-source protocol gateway and is not affiliated with, sponsored by, or endorsed by Google, OpenAI, or Anthropic.
2. **Educational & Research Purpose**: Janus Gateway is developed for architectural exploration, local developer prototyping, and study of multi-provider protocol abstraction.
3. **Compliance with Terms**: Users are solely responsible for ensuring their usage complies with relevant upstream terms of service. Authors assume no responsibility for account actions or consequences resulting from the use of this software.

---

## 📄 License

Distributed under the [MIT License](LICENSE). Copyright © 2026 yuyan98A.
