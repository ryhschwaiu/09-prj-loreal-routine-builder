# Project 9: L'Oréal Routine Builder
L’Oréal is expanding what’s possible with AI, and now your chatbot is getting smarter. This week, you’ll upgrade it into a product-aware routine builder. 

Users will be able to browse real L’Oréal brand products, select the ones they want, and generate a personalized routine using AI. They can also ask follow-up questions about their routine—just like chatting with a real advisor.

## Cloudflare Worker setup

The front end sends all AI requests to a Cloudflare Worker endpoint. Set the URL in [secrets.js](secrets.js) by replacing `window.WORKER_ENDPOINT` with your deployed Worker URL.

The client sends a JSON body with:
- `messages`: the full conversation history, including the system instructions and the current user message.
- `products`: the selected product JSON objects used for routine generation.

The UI expects the Worker to return JSON with assistant text available at `data.choices[0].message.content`.