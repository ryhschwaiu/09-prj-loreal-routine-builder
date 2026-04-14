# Project 9: L'Oréal Routine Builder

L’Oréal is expanding what’s possible with AI, and now your chatbot is getting smarter. This week, you’ll upgrade it into a product-aware routine builder.

Users will be able to browse real L’Oréal brand products, select the ones they want, and generate a personalized routine using AI. They can also ask follow-up questions about their routine—just like chatting with a real advisor.

## Cloudflare Worker setup

The front end sends all AI requests to a Cloudflare Worker endpoint. Set the URL in [secrets.js](secrets.js) by replacing `window.WORKER_ENDPOINT` with your deployed Worker URL.

The client sends a JSON body with:

- `messages`: the full conversation history, including the system instructions and the current user message.
- `products`: the selected product JSON objects used for routine generation.
- `webSearch`: a boolean flag. When `true`, the Worker should use a model/tooling path that can search the web.

The UI expects the Worker to return JSON with assistant text available at `data.choices[0].message.content`.

## Web Search requirement

To support the "Add Web Search" rubric item:

1. The Worker must use a search-capable model/tooling path when `webSearch` is `true`.
2. Responses should include current web-backed information when relevant to L'Oréal products or routines.
3. The Worker should return source links/citations so the frontend can render them.

Recommended Worker response shape:

```json
{
  "choices": [
    {
      "message": {
        "content": "Assistant response text"
      }
    }
  ],
  "citations": [
    {
      "title": "Source title",
      "url": "https://example.com"
    }
  ]
}
```

The frontend already checks multiple citation fields, but a top-level `citations` array is the simplest option.
