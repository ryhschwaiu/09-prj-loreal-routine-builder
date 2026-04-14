addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // In service-worker format, Cloudflare bindings are available as globals.
  const env = typeof OPENAI_API_KEY === "string" ? { OPENAI_API_KEY } : {};

  if (request.method === "OPTIONS") {
    return jsonResponse({}, 204);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const products = Array.isArray(body.products) ? body.products : [];
  const webSearch = Boolean(body.webSearch);

  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: "Missing OPENAI_API_KEY" }, 500);
  }

  if (messages.length === 0) {
    return jsonResponse({ error: "messages is required" }, 400);
  }

  try {
    const searchHint = webSearch
      ? "Use web search when needed for current info. Include source links when available."
      : "Answer using provided context and conversation only.";

    const responseInput = [
      ...messages,
      {
        role: "system",
        content: `Selected products JSON: ${JSON.stringify(products)}\n${searchHint}`,
      },
    ];

    const openAiPayload = {
      model: "gpt-4.1",
      input: responseInput,
    };

    // Turn on built-in web search only when the client asks for it.
    if (webSearch) {
      openAiPayload.tools = [{ type: "web_search_preview" }];
    }

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openAiPayload),
    });

    const openAiData = await openAiResponse.json();

    if (!openAiResponse.ok) {
      return jsonResponse(
        {
          error: "OpenAI request failed",
          details: openAiData,
        },
        openAiResponse.status,
      );
    }

    const assistantText = extractAssistantText(openAiData);
    const citations = extractCitations(openAiData);

    // Keep frontend-compatible shape: choices[0].message.content + citations.
    return jsonResponse({
      choices: [
        {
          message: {
            content: assistantText,
          },
          finish_reason: "stop",
        },
      ],
      citations,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Worker failed",
        details: String(error?.message || error),
      },
      500,
    );
  }
}

function extractAssistantText(openAiData) {
  if (
    typeof openAiData.output_text === "string" &&
    openAiData.output_text.trim()
  ) {
    return openAiData.output_text.trim();
  }

  if (Array.isArray(openAiData.output)) {
    for (const item of openAiData.output) {
      if (item.type !== "message" || !Array.isArray(item.content)) {
        continue;
      }

      for (const part of item.content) {
        if (part.type === "output_text" && typeof part.text === "string") {
          const text = part.text.trim();
          if (text) {
            return text;
          }
        }
      }
    }
  }

  return "I could not generate a response right now. Please try again.";
}

function extractCitations(openAiData) {
  const citations = [];
  const seenUrls = new Set();

  if (!Array.isArray(openAiData.output)) {
    return citations;
  }

  for (const item of openAiData.output) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const part of item.content) {
      if (part.type !== "output_text" || !Array.isArray(part.annotations)) {
        continue;
      }

      for (const annotation of part.annotations) {
        const url = annotation.url || annotation.href || "";
        const title = annotation.title || annotation.display_text || url;

        if (!url || seenUrls.has(url)) {
          continue;
        }

        seenUrls.add(url);
        citations.push({ title, url });
      }
    }
  }

  return citations;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
