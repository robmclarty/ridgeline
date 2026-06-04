# Web Search

How Ridgeline gives research specialists web access on non-Claude providers,
why search is **opt-in**, and how to turn it on with a self-hosted SearXNG
instance (recommended) or the keyless DuckDuckGo fallback.

For how research uses these tools, see [research.md](./research.md). For the
in-process tool surface and sandboxing, see
[sandboxing-and-access-control.md](./sandboxing-and-access-control.md).

---

## When search is used

Research specialists need to read documentation and discover sources. How that
happens depends on which provider runs the flow:

- **Claude CLI (`claude_cli`, the default subscription path)** — uses the Claude
  CLI's own built-in, Anthropic-hosted `WebSearch`/`WebFetch`. Nothing here
  applies; it works out of the box.
- **Any other provider** (`openai`, `google`, `anthropic` API key,
  `openrouter`, …) — runs through Ridgeline's in-process tool loop, which has no
  hosted search. It gets two in-process tools instead:
  - **`WebFetch`** — always available on the engine path. Fetches a URL and
    returns its text. Network access is enforced by the project network
    allowlist plus an SSRF guard (loopback/private addresses are always
    blocked, redirects and DNS results are re-validated).
  - **`WebSearch`** — **opt-in**. Discovers candidate URLs for a query. Off
    unless you configure a backend (below).

`WebSearch` returns title + URL + snippet lines; the model then retrieves the
URLs it wants through `WebFetch`. Discovery and retrieval are separate steps.

## Why opt-in

There is no free, robust, dependency-free general web search. The options each
carry a tradeoff (a self-hosted service, or scraping a search engine's HTML),
so Ridgeline never enables search implicitly. With nothing configured,
`WebSearch` is simply not offered to the model — research falls back to
`WebFetch` against URLs the model already knows (well suited to the curated
documentation domains in the research allowlist: arxiv, MDN, docs.python.org,
docs.rs, …).

## Backend chain

`WebSearch` tries the configured backends in order and returns the first that
yields results:

| Order | Backend | Key/service | Notes |
|---|---|---|---|
| 1 | **Provider-native** | — | The ideal backend (the provider's own hosted search). **Deferred**: fascicle 0.5 cannot pass a provider server-side tool through the in-process loop, so this slot is inert until that support lands. |
| 2 | **SearXNG** | self-hosted | Recommended. A metasearch instance you run; JSON API; aggregates Google/Bing/etc. without IP bans or ToS issues — it's *your* instance. |
| 3 | **DuckDuckGo** | none | Keyless fallback that scrapes DuckDuckGo's HTML endpoint. Best-effort: rate-limited, gray-area, and can break when their markup changes. |

## Enabling SearXNG with Docker (recommended)

[SearXNG](https://github.com/searxng/searxng) is a self-hosted metasearch
engine. Running your own instance means no third-party key, no paid service,
and no IP bans.

1. **Start SearXNG**, mapping a host port and a config volume:

   ```sh
   docker run --rm -d \
     --name searxng \
     -p 8888:8080 \
     -v "$(pwd)/searxng:/etc/searxng" \
     searxng/searxng:latest
   ```

   The first run generates `./searxng/settings.yml`.

2. **Enable the JSON API.** SearXNG ships with JSON output **disabled**. Edit
   `./searxng/settings.yml` and add `json` to the formats list:

   ```yaml
   search:
     formats:
       - html
       - json
   ```

   Then restart: `docker restart searxng`.

3. **Point Ridgeline at it** in `.ridgeline/settings.json`:

   ```json
   { "search": { "url": "http://localhost:8888" } }
   ```

4. **Verify** the JSON API responds:

   ```sh
   curl 'http://localhost:8888/search?q=rust+ownership&format=json' | head
   ```

That's the whole switch. On the next non-Claude `ridgeline research` run,
specialists get `WebSearch` backed by your instance.

> Ridgeline calls the SearXNG endpoint **directly** — it is a trusted,
> user-configured host, so it is exempt from the `WebFetch` allowlist/SSRF gate
> (which is what lets a `localhost` instance work). See [Security](#security).

## Enabling the DuckDuckGo fallback

Keyless, zero-setup, but best-effort — opt in explicitly:

```json
{ "search": { "duckduckgo": true } }
```

You can set both; SearXNG is tried first and DuckDuckGo is the fallback. Use
DuckDuckGo with the understanding that scraping its HTML endpoint is rate
limited and a ToS gray area, and may stop working without notice.

## Configuration reference

In `.ridgeline/settings.json`:

```json
{
  "search": {
    "url": "http://localhost:8888",
    "duckduckgo": true
  }
}
```

| Field | Type | Effect |
|---|---|---|
| `search.url` | string | SearXNG base URL (JSON API enabled). Enables the SearXNG backend. |
| `search.duckduckgo` | boolean | Opt in to the keyless DuckDuckGo HTML fallback. |

Omit `search` entirely (the default) to disable `WebSearch`.

## Search results and the network allowlist

`WebSearch` *discovers* URLs; `WebFetch` *retrieves* them — and `WebFetch` is
gated by the project network allowlist. Research runs with the allowlist plus a
set of documentation domains (arxiv, MDN, docs.python.org, docs.rs, …). A search
result on a domain outside that list will be **refused** by `WebFetch`.

To let research follow general results, widen the allowlist in
`.ridgeline/settings.json` — either add specific domains or open it fully:

```json
{ "network": { "allowlist": ["*"] } }
```

`"*"` makes `WebFetch` unrestricted *except* for the always-on SSRF block
(loopback/private addresses are still refused).

## Security

- The **search endpoint** (SearXNG URL or DuckDuckGo) is trusted and
  user-configured, so it is fetched directly, bypassing the `WebFetch`
  allowlist/SSRF gate. This is deliberate — it is a fixed host you chose (often
  `localhost`), not an attacker-influenced URL.
- The **result URLs** are attacker-influenceable (a page could list any URL), so
  they are retrieved through `WebFetch`, which enforces the allowlist, blocks
  loopback/private addresses, re-validates every redirect hop, and checks the
  resolved IPs (DNS-rebinding guard).
- This keeps the trust boundary clear: configured endpoints are trusted; the
  open web reached through them is not.

## Provider-native search (deferred)

The cleanest backend would be the provider's own hosted search (OpenAI
`web_search`, Anthropic web search, Google grounding) — "free-ish" within
existing API usage and high quality. fascicle 0.5 converts only in-process tools
(`{name, description, input_schema}`) to AI-SDK tools and owns the AI-SDK
`tools` parameter, so there is no way to inject a provider server-side tool
through it. When fascicle adds provider-tool passthrough, it slots in as the
first backend in the chain with no change to the research flow.
