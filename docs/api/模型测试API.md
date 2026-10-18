# Model Test API

`POST /v1/admin/models/test` sends a small real inference request through the same dispatcher used by `/v1/chat/completions`. Google candidates come from the live `fetchAvailableModels` response; the registry is cached in memory for 24 hours. Models Hub can bypass this cache with its **刷新 Google 模型列表** button, backed by `POST /v1/admin/models/refresh`. The endpoint requires the configured gateway API key (`Authorization: Bearer ...` or `x-api-key`). See [Google model discovery](./模型发现API.md) for account merging, filtering, cache, and manual refresh behavior.

`GET /v1/models` uses that discovered registry, merges enabled Google accounts, and omits entries the upstream marks as internal, tab-only, image-generation, or audio-transcription models. Google entries include the upstream display name, remaining quota fraction, reset time, and minimum thinking budget when provided. Discovery does not run inference; use the per-model or batch test actions below to check text generation.

## Select models

An empty JSON object tests every model currently returned by `GET /v1/models`:

```http
POST /v1/admin/models/test
Authorization: Bearer sk-gateway-local-token
Content-Type: application/json

{}
```

Test one model with `model`:

```json
{ "model": "claude-sonnet-4-6" }
```

Test a selected group with `models`:

```json
{ "models": ["claude-sonnet-4-6", "gpt-6.1-sol"] }
```

`{ "all": true }` is an explicit alternative to an empty body. A request cannot combine `all` with `model` or `models`, or combine `model` with `models`.

## Optional fields

- `prompt`: test prompt; defaults to `Reply with exactly: OK`. The prompt must be non-empty and at most 500 characters.
- `maxTokens`: maximum output tokens; defaults to `32`, with an accepted range of `16` to `128`.

Selected models run sequentially to reduce burst rate limiting. Each check makes a real upstream request and may use provider quota. For Google models, the probe uses the discovered minimum thinking budget and raises the effective output limit enough to leave room for a short answer, up to 512 tokens; the result reports that effective `maxTokens`. A model passes when the request completes and returns non-empty text. Individual upstream failures do not stop the remaining batch.

## Response

The endpoint returns HTTP 200 after a valid test run, including when one or more models fail:

```json
{
  "object": "model_test_result",
  "total": 2,
  "passed": 1,
  "failed": 1,
  "results": [
    {
      "model": "claude-sonnet-4-6",
      "provider": "google",
      "status": "passed",
      "elapsedMs": 1200,
      "maxTokens": 32,
      "sample": "OK"
    },
    {
      "model": "gemini-2.5-pro",
      "provider": "google",
      "status": "failed",
      "elapsedMs": 230,
      "error": "Resource has been exhausted.",
      "errorCode": 429
    }
  ]
}
```

Errors from upstream are reduced to a short message; upstream URLs and bearer credentials are not returned. Invalid input returns HTTP 400, unknown model IDs return HTTP 404, and an empty model registry returns HTTP 503.

## Dashboard

The Models Hub provides **测试全部模型** and a per-model **测试** action. During a batch, all rows show a running state; results appear together when all requests finish. Failed rows show the error code and full sanitized reason in the table. The dashboard uses the same endpoint and default token limit.
