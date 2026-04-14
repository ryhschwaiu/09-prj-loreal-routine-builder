// Cloudflare Worker for Project 9: L'Oreal Routine Builder
// This worker receives `messages` from your frontend and forwards them to OpenAI.

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request, env) {
    // Handle browser CORS preflight requests.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Helpful preview endpoint so opening the Worker URL in a browser
    // does not show a 405 error.
    if (request.method === "GET") {
      return jsonResponse({
        ok: true,
        message: "Worker is running. Send POST requests with JSON body.",
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse(
        { error: "Missing OPENAI_API_KEY in Worker secrets." },
        500,
      );
    }

    let clientPayload;
    try {
      clientPayload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    if (
      !Array.isArray(clientPayload.messages) ||
      clientPayload.messages.length === 0
    ) {
      return jsonResponse(
        { error: "Request must include a non-empty messages array." },
        400,
      );
    }

    const messages = clientPayload.messages;
    const products = Array.isArray(clientPayload.products)
      ? clientPayload.products
      : [];
    const webSearchEnabled = Boolean(clientPayload.webSearch);

    // Frontend already sends full conversation context. This system note makes
    // web-search mode explicitly source-driven and findings-focused.
    const systemNote = {
      role: "system",
      content: webSearchEnabled
        ? `You are a helpful L'Oreal routine advisor. Web search is enabled. Use current web findings when relevant, integrate those findings into the relevant sections of your routine response, and provide source attribution for web-based claims. Include source links whenever available. Selected products JSON: ${JSON.stringify(products)}`
        : `You are a helpful L'Oreal routine advisor. Focus on L'Oreal product/routine guidance using conversation context and selected products only. Selected products JSON: ${JSON.stringify(products)}`,
    };

    const openAiRequestBody = {
      model: "gpt-4o",
      input: [...messages, systemNote],
      temperature: 0.7,
      max_output_tokens: 1200,
    };

    if (webSearchEnabled) {
      openAiRequestBody.tools = [{ type: "web_search_preview" }];
    }

    try {
      let openAiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openAiRequestBody),
      });

      let data = await openAiResponse.json();

      // Some accounts/models may reject web_search_preview. If that happens,
      // retry once without tools so routine generation still works.
      if (!openAiResponse.ok && webSearchEnabled) {
        const fallbackBody = {
          ...openAiRequestBody,
        };
        delete fallbackBody.tools;

        openAiResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fallbackBody),
        });

        data = await openAiResponse.json();
      }

      if (!openAiResponse.ok) {
        const openAiMessage =
          data?.error?.message || data?.message || "OpenAI request failed.";
        return jsonResponse(
          {
            error: openAiMessage,
            details: data,
          },
          openAiResponse.status,
        );
      }

      let assistantContent = extractAssistantContent(data);
      const extractedCitations = extractCitations(data);
      const inlineCitations = extractInlineCitationsFromText(assistantContent);
      let citations = mergeCitations(extractedCitations, inlineCitations);

      if (webSearchEnabled && citations.length === 0) {
        const citationRecovery = await requestCitationRecovery(
          env.OPENAI_API_KEY,
          messages,
          systemNote,
          assistantContent,
        );

        citations = mergeCitations(citations, citationRecovery);
      }

      assistantContent = appendWebSearchInfo(
        assistantContent,
        citations,
        webSearchEnabled,
      );

      // Return a Chat Completions-like payload because frontend reads
      // data.choices[0].message.content and also optional top-level citations.
      return jsonResponse(
        {
          id: data.id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: data.model || "gpt-4o",
          usage: data.usage || null,
          finish_reason: "stop",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: assistantContent,
              },
            },
          ],
          citations,
        },
        200,
      );
    } catch (error) {
      return jsonResponse(
        {
          error: "Unexpected worker error while calling OpenAI.",
          details: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
};

function extractAssistantContent(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    for (const outputItem of data.output) {
      if (
        outputItem?.type !== "message" ||
        !Array.isArray(outputItem?.content)
      ) {
        continue;
      }

      for (const part of outputItem.content) {
        if (part?.type === "output_text" && typeof part?.text === "string") {
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

function extractCitations(data) {
  const citations = [];
  const seenUrls = new Set();

  if (!Array.isArray(data?.output)) {
    return citations;
  }

  for (const outputItem of data.output) {
    if (outputItem?.type !== "message" || !Array.isArray(outputItem?.content)) {
      continue;
    }

    for (const part of outputItem.content) {
      if (part?.type !== "output_text" || !Array.isArray(part?.annotations)) {
        continue;
      }

      for (const annotation of part.annotations) {
        const url = annotation?.url || annotation?.href || "";
        const title = annotation?.title || annotation?.display_text || url;

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

function extractInlineCitationsFromText(content) {
  if (!content) {
    return [];
  }

  const citations = [];
  const seenUrls = new Set();
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  const plainUrlRegex = /https?:\/\/[^\s)]+/gi;

  let markdownMatch = markdownLinkRegex.exec(content);
  while (markdownMatch) {
    const title = String(markdownMatch[1] || "Source link").trim();
    const url = String(markdownMatch[2] || "").trim();

    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      citations.push({ title, url });
    }

    markdownMatch = markdownLinkRegex.exec(content);
  }

  let urlMatch = plainUrlRegex.exec(content);
  while (urlMatch) {
    const url = String(urlMatch[0] || "").trim();

    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      citations.push({ title: url, url });
    }

    urlMatch = plainUrlRegex.exec(content);
  }

  return citations;
}

function mergeCitations(primaryCitations, fallbackCitations) {
  const merged = [];
  const seenUrls = new Set();

  const allCitations = [
    ...(Array.isArray(primaryCitations) ? primaryCitations : []),
    ...(Array.isArray(fallbackCitations) ? fallbackCitations : []),
  ];

  allCitations.forEach((citation) => {
    const url = citation?.url || "";
    const title = citation?.title || url || "Source link";

    if (!url || seenUrls.has(url)) {
      return;
    }

    seenUrls.add(url);
    merged.push({ title, url });
  });

  return merged;
}

function appendWebSearchInfo(content, citations, webSearchEnabled) {
  if (!webSearchEnabled) {
    return content;
  }

  const sourceMentionPattern =
    /according to|source|sources|citation|reference|http:\/\/|https:\/\//i;

  if (citations.length > 0 && !sourceMentionPattern.test(content)) {
    const findingsList = citations
      .slice(0, 4)
      .map((citation) => `- ${citation.title}: ${citation.url}`)
      .join("\n");

    return `${content}\n\nWeb Findings Used:\n${findingsList}`;
  }

  return content;
}

async function requestCitationRecovery(
  apiKey,
  messages,
  systemNote,
  assistantContent,
) {
  try {
    const recoveryPayload = {
      model: "gpt-4o",
      input: [
        ...messages,
        systemNote,
        {
          role: "assistant",
          content: assistantContent,
        },
        {
          role: "user",
          content:
            "List 2-3 source links (title and URL) that support your previous answer. Keep the response concise.",
        },
      ],
      temperature: 0.2,
      max_output_tokens: 350,
      tools: [{ type: "web_search_preview" }],
    };

    const recoveryResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(recoveryPayload),
      },
    );

    const recoveryData = await recoveryResponse.json();

    if (!recoveryResponse.ok) {
      return [];
    }

    const recoveryText = extractAssistantContent(recoveryData);
    const recoveryExtracted = extractCitations(recoveryData);
    const recoveryInline = extractInlineCitationsFromText(recoveryText);

    return mergeCitations(recoveryExtracted, recoveryInline);
  } catch {
    return [];
  }
}
