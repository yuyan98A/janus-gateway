# Contributing to Janus Gateway

Thank you for your interest in contributing to **Janus Gateway**! We welcome bug reports, feature proposals, documentation improvements, and pull requests from the community.

---

## Code of Conduct & Responsible Usage

Janus Gateway is an experimental protocol gateway designed for developers, researchers, and educational exploration. When contributing:
1. **No Destructive/Malicious Tooling**: Submissions targeting DDoS, credential harvesting, or abuse of upstream services are strictly prohibited.
2. **Respect Upstream ToS**: Contributions should focus on protocol normalization, streaming resilience, fault-tolerant proxying, and client self-healing.
3. **Zero Secrets in Code**: Never commit real refresh tokens, API keys, session tokens, or private paths.

---

## Development Setup

### Prerequisites
* **Node.js**: `v18.0.0` or higher (Node.js v20+ or v24 recommended)
* **Package Manager**: `npm` (bundled with Node.js)
* **Git**: Installed and configured

### Clone & Install
```bash
git clone https://github.com/yuyan98A/janus-gateway.git
cd janus-gateway
npm install
```

### Configuration
Copy the configuration template:
```bash
cp config.example.json config.json
```
Edit `config.json` or `.env` as needed.

---

## Running & Testing

### Development Mode
To start the gateway directly:
```bash
npm start
```
Or start in the zero-downtime cluster mode:
```bash
npm run start:cluster
```

### Running Test Suites
Before submitting any Pull Request, ensure all automated tests pass:
```bash
npm test
```
The test suite covers:
* Native Windows daemon and background service scripts compatibility
* Tool schema sanitization & Claude Code parameter self-healing
* Universal payload scrubbing and anti-detection mechanisms
* Canonical Protocol IR and EventSource SSE parser robustness
* Zero-downtime rolling upgrades and graceful stream draining
* Google account pool, project discovery, and token management
* End-to-end Anthropic `/v1/messages` and OpenAI `/v1/chat/completions` regressions

---

## Hot Reloading Convention

Janus Gateway serves live agent streaming inference (SSE). When developing or deploying updates:
* **Avoid Killing Processes Abruptly**: Use the built-in graceful reload command:
  ```bash
  npm run reload
  ```
  *(or invoke `POST /v1/admin/gateway/upgrade`)*.
* The master process will fork a new worker to validate code compilation and bind to the port before draining existing in-flight client streams.

---

## Commit Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
* `feat`: A new feature (e.g., `feat(google): add multi-account quota polling`)
* `fix`: A bug fix (e.g., `fix(streaming): resolve chunk boundary encoding`)
* `docs`: Documentation changes (e.g., `docs: update client setup guides`)
* `refactor`: Code refactoring without behavioral changes
* `test`: Adding or updating test cases
* `chore`: Maintenance, dependencies, or configuration updates

---

## Pull Request Checklist

- [ ] My code adheres to the existing TypeScript / Node.js style in this project.
- [ ] I have verified that `npm test` passes 100% locally.
- [ ] No personal tokens, account IDs, or private paths are hardcoded.
- [ ] Relevant documentation or knowledge base specs have been updated if behavior changed.
