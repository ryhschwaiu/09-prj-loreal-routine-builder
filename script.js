/* Get references to DOM elements */
const categoryDropdownButton = document.getElementById(
  "categoryDropdownButton",
);
const categoryDropdownMenu = document.getElementById("categoryDropdownMenu");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedCount = document.getElementById("selectedCount");
const clearSelectedButton = document.getElementById("clearSelected");
const generateRoutineButton = document.getElementById("generateRoutine");
const viewProductsButton = document.getElementById("viewProductsBtn");
const viewChatButton = document.getElementById("viewChatBtn");
const resetButton = document.getElementById("resetButton");
const resetConfirmButton = document.getElementById("resetConfirmButton");
const resetConfirmModalElement = document.getElementById("resetConfirmModal");
const productViewSections = document.querySelectorAll(".view-products-section");
const chatViewSections = document.querySelectorAll(".view-chat-section");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const workerEndpoint = window.WORKER_ENDPOINT
  ? window.WORKER_ENDPOINT.trim()
  : "";

const SELECTED_PRODUCTS_STORAGE_KEY = "loreal-selected-product-ids";
const CHAT_STATE_STORAGE_KEY = "loreal-chat-state";
const DEFAULT_CHAT_MESSAGE = "Generate a routine to start the conversation.";
const ENABLE_WEB_SEARCH = true;
const RTL_LANGUAGE_PREFIXES = ["ar", "fa", "he", "ur", "dv", "ps", "ku"];
const MAX_PRODUCT_DESCRIPTION_CHARS = 320;
const VIEW_PRODUCTS = "products";
const VIEW_CHAT = "chat";
const TYPING_FRAME_DELAY_MS = 18;

const appState = {
  allProducts: [],
  filteredProducts: [],
  selectedProductIds: new Set(),
  expandedDescriptionIds: new Set(),
  activeCategory: "",
  activeSearchQuery: "",
  conversationMessages: [],
  routineContextProducts: [],
  routineGenerated: false,
  isLoading: false,
  loadingMessage: "",
  debugMode: false,
  lastDebugInfo: null,
  activeView: VIEW_PRODUCTS,
  nextMessageId: 1,
  typingTimerId: null,
};

productsContainer.innerHTML = `
  <div class="placeholder-message">
    Loading products...
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

function saveSelectedProductsToStorage() {
  const selectedIdsArray = Array.from(appState.selectedProductIds);
  localStorage.setItem(
    SELECTED_PRODUCTS_STORAGE_KEY,
    JSON.stringify(selectedIdsArray),
  );
}

function stopTypingAnimation() {
  if (appState.typingTimerId) {
    window.clearInterval(appState.typingTimerId);
    appState.typingTimerId = null;
  }
}

function getRoutineContextProductIds() {
  return appState.routineContextProducts.map((product) => product.id);
}

function serializeConversationMessage(message) {
  return {
    role: message.role,
    content: String(message.content || ""),
    citations: Array.isArray(message.citations) ? message.citations : [],
  };
}

function saveChatStateToStorage() {
  localStorage.setItem(
    CHAT_STATE_STORAGE_KEY,
    JSON.stringify({
      activeView: appState.activeView,
      conversationMessages: appState.conversationMessages.map(
        serializeConversationMessage,
      ),
      routineContextProductIds: getRoutineContextProductIds(),
      routineGenerated: appState.routineGenerated,
    }),
  );
}

function loadProductsByIds(productIds) {
  const validIds = new Set(productIds);
  return appState.allProducts.filter((product) => validIds.has(product.id));
}

function sanitizeConversationMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
      citations: Array.isArray(message.citations) ? message.citations : [],
    }));
}

function loadChatStateFromStorage() {
  const storedValue = localStorage.getItem(CHAT_STATE_STORAGE_KEY);

  if (!storedValue) {
    return;
  }

  try {
    const parsedState = JSON.parse(storedValue);
    appState.conversationMessages = sanitizeConversationMessages(
      parsedState.conversationMessages,
    );
    appState.nextMessageId = appState.conversationMessages.length + 1;
    appState.routineContextProducts = loadProductsByIds(
      Array.isArray(parsedState.routineContextProductIds)
        ? parsedState.routineContextProductIds
        : [],
    );
    appState.routineGenerated = Boolean(parsedState.routineGenerated);

    if (parsedState.activeView === VIEW_CHAT) {
      appState.activeView = VIEW_CHAT;
    }
  } catch (error) {
    console.error("Could not load saved chat state.", error);
    localStorage.removeItem(CHAT_STATE_STORAGE_KEY);
  }
}

function loadSelectedProductsFromStorage() {
  const storedValue = localStorage.getItem(SELECTED_PRODUCTS_STORAGE_KEY);

  if (!storedValue) {
    return;
  }

  try {
    const parsedIds = JSON.parse(storedValue);

    if (Array.isArray(parsedIds)) {
      appState.selectedProductIds = new Set(parsedIds);
    }
  } catch (error) {
    console.error("Could not load saved product selections.", error);
    localStorage.removeItem(SELECTED_PRODUCTS_STORAGE_KEY);
  }
}

/* Keep saved ids valid if product data changes later */
function sanitizeSelectedIds() {
  const validIds = new Set(appState.allProducts.map((product) => product.id));
  appState.selectedProductIds.forEach((id) => {
    if (!validIds.has(id)) {
      appState.selectedProductIds.delete(id);
    }
  });
}

function applyFilters() {
  const normalizedQuery = appState.activeSearchQuery.toLowerCase().trim();

  appState.filteredProducts = appState.allProducts.filter((product) => {
    const categoryMatches = appState.activeCategory
      ? product.category === appState.activeCategory
      : true;

    const searchableText =
      `${product.name} ${product.brand} ${product.description}`
        .toLowerCase()
        .trim();

    const queryMatches = normalizedQuery
      ? searchableText.includes(normalizedQuery)
      : true;

    return categoryMatches && queryMatches;
  });
}

function updateCategoryDropdownButtonText() {
  const activeItem = categoryDropdownMenu.querySelector(
    ".dropdown-item.active",
  );
  const buttonLabel = activeItem
    ? activeItem.textContent.trim()
    : "All Products";

  categoryDropdownButton.textContent = buttonLabel;
}

function updateCategoryDropdownDisabledStates() {
  const normalizedQuery = appState.activeSearchQuery.toLowerCase().trim();
  const categoryItems = categoryDropdownMenu.querySelectorAll(".dropdown-item");

  categoryItems.forEach((item) => {
    const categoryValue = item.dataset.category;

    if (categoryValue === "") {
      item.disabled = false;
      item.classList.remove("disabled");
      return;
    }

    if (!normalizedQuery) {
      item.disabled = false;
      item.classList.remove("disabled");
      return;
    }

    const hasMatchingProducts = appState.allProducts.some((product) => {
      if (product.category !== categoryValue) {
        return false;
      }

      const searchableText =
        `${product.name} ${product.brand} ${product.description}`
          .toLowerCase()
          .trim();

      return searchableText.includes(normalizedQuery);
    });

    item.disabled = !hasMatchingProducts;
    item.classList.toggle("disabled", !hasMatchingProducts);
  });

  const selectedItem = categoryDropdownMenu.querySelector(
    ".dropdown-item.active",
  );
  if (selectedItem && selectedItem.disabled) {
    setActiveCategory("");
  }
}

function setActiveCategory(categoryValue) {
  appState.activeCategory = categoryValue;

  const categoryItems = categoryDropdownMenu.querySelectorAll(".dropdown-item");
  categoryItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.category === categoryValue);
  });

  updateCategoryDropdownButtonText();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInlineMarkdown(value) {
  let formatted = escapeHtml(value);

  formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  formatted = formatted.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  formatted = formatted.replace(/_([^_]+)_/g, "<em>$1</em>");

  return formatted.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
  );
}

function formatMessageContent(value) {
  const lines = String(value).split("\n");
  const htmlParts = [];
  let inUnorderedList = false;
  let inOrderedList = false;
  let pendingLineBreak = false;

  function closeLists() {
    if (inUnorderedList) {
      htmlParts.push("</ul>");
      inUnorderedList = false;
    }

    if (inOrderedList) {
      htmlParts.push("</ol>");
      inOrderedList = false;
    }
  }

  function appendToLastListItem(content) {
    const lastIndex = htmlParts.length - 1;
    if (lastIndex < 0) {
      return false;
    }

    const lastPart = htmlParts[lastIndex];
    if (!lastPart.startsWith("<li") || !lastPart.endsWith("</li>")) {
      return false;
    }

    const extraBreak = pendingLineBreak ? "<br>" : "";
    htmlParts[lastIndex] = lastPart.replace(
      /<\/li>$/,
      `${extraBreak}<br>${formatInlineMarkdown(content)}</li>`,
    );
    pendingLineBreak = false;
    return true;
  }

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      pendingLineBreak = true;
      return;
    }

    const unorderedListMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (unorderedListMatch) {
      if (inOrderedList) {
        htmlParts.push("</ol>");
        inOrderedList = false;
      }

      if (!inUnorderedList) {
        htmlParts.push("<ul>");
        inUnorderedList = true;
      }

      htmlParts.push(`<li>${formatInlineMarkdown(unorderedListMatch[1])}</li>`);
      pendingLineBreak = false;
      return;
    }

    const orderedListMatch = trimmedLine.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedListMatch) {
      if (inUnorderedList) {
        htmlParts.push("</ul>");
        inUnorderedList = false;
      }

      if (!inOrderedList) {
        htmlParts.push("<ol>");
        inOrderedList = true;
      }

      const explicitNumber = Number(orderedListMatch[1]);
      htmlParts.push(
        `<li value="${explicitNumber}">${formatInlineMarkdown(orderedListMatch[2])}</li>`,
      );
      pendingLineBreak = false;
      return;
    }

    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (pendingLineBreak) {
        closeLists();
        htmlParts.push("<br>");
        pendingLineBreak = false;
      }

      closeLists();
      const headingLevel = Math.min(headingMatch[1].length, 6);
      htmlParts.push(
        `<h${headingLevel}>${formatInlineMarkdown(headingMatch[2])}</h${headingLevel}>`,
      );
      return;
    }

    if (
      (inOrderedList || inUnorderedList) &&
      appendToLastListItem(trimmedLine)
    ) {
      return;
    }

    if (pendingLineBreak) {
      closeLists();
      htmlParts.push("<br>");
      pendingLineBreak = false;
    }

    closeLists();
    htmlParts.push(`<p>${formatInlineMarkdown(trimmedLine)}</p>`);
  });

  if (pendingLineBreak) {
    closeLists();
    htmlParts.push("<br>");
  }

  closeLists();
  return htmlParts.join("");
}

function scrollChatToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function renderChatMessageContent(message) {
  if (message.isTyping) {
    return `<p class="chat-typing-text">${escapeHtml(message.typingContent || "")}<span class="chat-typing-cursor" aria-hidden="true"></span></p>`;
  }

  return formatMessageContent(message.content);
}

function startTypingAnimation(messageId) {
  stopTypingAnimation();

  const message = appState.conversationMessages.find(
    (conversationMessage) => conversationMessage.id === messageId,
  );

  if (!message) {
    return;
  }

  const fullText = String(message.content || "");
  const charsPerFrame = Math.max(1, Math.ceil(fullText.length / 120));

  message.isTyping = true;
  message.typingContent = "";
  renderChatWindow();

  let currentIndex = 0;
  appState.typingTimerId = window.setInterval(() => {
    currentIndex = Math.min(fullText.length, currentIndex + charsPerFrame);
    message.typingContent = fullText.slice(0, currentIndex);
    renderChatWindow();

    if (currentIndex >= fullText.length) {
      stopTypingAnimation();
      message.isTyping = false;
      message.typingContent = "";
      renderChatWindow();
      saveChatStateToStorage();
    }
  }, TYPING_FRAME_DELAY_MS);
}

function renderChatWindow() {
  const chatMessages = appState.conversationMessages.length
    ? appState.conversationMessages
        .map(
          (message) => `
            <div class="chat-message ${message.role} ${
              message.isNew ? "is-new-message" : ""
            }">
              <div class="chat-bubble">
                ${renderChatMessageContent(message)}
              </div>
              ${renderMessageCitations(message.citations)}
            </div>
          `,
        )
        .join("")
    : `<p class="chat-empty">${DEFAULT_CHAT_MESSAGE}</p>`;

  const loadingMessage = appState.isLoading
    ? `
      <div class="chat-message assistant is-loading">
        <div class="chat-bubble typing-bubble" aria-label="Assistant is typing">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      </div>
    `
    : "";

  chatWindow.innerHTML = `${chatMessages}${loadingMessage}`;

  queueMicrotask(() => {
    appState.conversationMessages.forEach((message) => {
      message.isNew = false;
    });
  });

  scrollChatToBottom();
}

function setChatLoadingState(isLoading, loadingMessage = "") {
  appState.isLoading = isLoading;
  appState.loadingMessage = loadingMessage;
  generateRoutineButton.disabled = isLoading;
  userInput.disabled = isLoading;
  sendBtn.disabled = isLoading;
  resetButton.disabled = isLoading;

  if (isLoading) {
    generateRoutineButton.innerHTML =
      '<i class="fa-solid fa-circle-notch fa-spin"></i> Generating...';
    sendBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
  } else {
    generateRoutineButton.innerHTML =
      '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Routine';
    sendBtn.innerHTML =
      '<i class="fa-solid fa-paper-plane"></i><span class="visually-hidden">Send</span>';
  }

  renderChatWindow();
}

function normalizeCitation(citation) {
  if (typeof citation === "string") {
    return {
      title: citation,
      url: citation,
    };
  }

  return {
    title: citation?.title || citation?.label || citation?.url || "Source link",
    url: citation?.url || citation?.link || citation?.href || "",
  };
}

function renderMessageCitations(citations) {
  if (!Array.isArray(citations) || citations.length === 0) {
    return "";
  }

  const renderedCitations = citations
    .map(normalizeCitation)
    .filter((citation) => citation.url);

  if (renderedCitations.length === 0) {
    return "";
  }

  return `
    <div class="chat-citations">
      <span class="chat-citations-label">Sources</span>
      <div class="chat-citations-list">
        ${renderedCitations
          .map(
            (citation) => `
              <a
                class="chat-citation"
                href="${escapeHtml(citation.url)}"
                target="_blank"
                rel="noreferrer"
              >
                ${formatInlineMarkdown(citation.title)}
              </a>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function getRoutineContextProducts() {
  return appState.routineContextProducts.length > 0
    ? appState.routineContextProducts
    : getSelectedProducts();
}

function isRtlLanguage(languageCode) {
  if (!languageCode) {
    return false;
  }

  const normalizedLanguage = languageCode.toLowerCase();
  return RTL_LANGUAGE_PREFIXES.some((prefix) =>
    normalizedLanguage.startsWith(prefix),
  );
}

function applyDirectionFromBrowserLanguage() {
  const htmlLanguage = document.documentElement.lang;
  const primaryBrowserLanguage =
    navigator.languages && navigator.languages.length
      ? navigator.languages[0]
      : navigator.language || "en";

  const primaryLanguage = htmlLanguage || primaryBrowserLanguage;
  const hasRtlLanguage = isRtlLanguage(primaryLanguage);

  document.documentElement.setAttribute("dir", hasRtlLanguage ? "rtl" : "ltr");
}

function serializeProductForAi(product) {
  const compactDescription = String(product.description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PRODUCT_DESCRIPTION_CHARS);

  return {
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: compactDescription,
  };
}

function hasConfiguredWorkerEndpoint() {
  if (!workerEndpoint) {
    return false;
  }

  return !workerEndpoint.includes("YOUR-WORKER-ENDPOINT");
}

function setDebugMode(enabled) {
  appState.debugMode = Boolean(enabled);
  console.info(
    `[Routine Debug] ${appState.debugMode ? "enabled" : "disabled"}`,
  );
}

function logDebugInfo(debugInfo, rawResponse) {
  if (!appState.debugMode) {
    return;
  }

  console.groupCollapsed(
    `[Routine Debug] finish=${debugInfo.finishReason} chars=${debugInfo.contentLength} duration=${debugInfo.requestDurationMs}ms`,
  );
  console.log("Summary", debugInfo);
  console.log("Usage", debugInfo.usage);
  console.log("Raw response", rawResponse);
  console.groupEnd();
}

function registerDebugConsoleApi() {
  window.routineDebug = {
    enable() {
      setDebugMode(true);
    },
    disable() {
      setDebugMode(false);
    },
    status() {
      const snapshot = {
        enabled: appState.debugMode,
        lastResponse: appState.lastDebugInfo,
      };
      console.log("[Routine Debug] status", snapshot);
      return snapshot;
    },
    help() {
      const commandList = [
        "window.routineDebug.enable()",
        "window.routineDebug.disable()",
        "window.routineDebug.status()",
      ];
      console.log("[Routine Debug] commands", commandList);
      return commandList;
    },
  };
}

function buildSystemPrompt(selectedProducts) {
  const productSummary = selectedProducts
    .map(serializeProductForAi)
    .map((product) => JSON.stringify(product, null, 2))
    .join("\n");

  return [
    "You are a helpful L'Oréal routine advisor.",
    "Stay focused on the selected products, skincare, haircare, makeup, fragrance, and related beauty topics.",
    "If the user asks something unrelated, gently steer the conversation back to their routine.",
    "Use the selected product JSON below as the primary source of truth when recommending a routine.",
    "When appropriate, structure answers with clear steps and concise explanations.",
    "",
    "Selected products:",
    productSummary,
  ].join("\n");
}

function buildConversationMessages(userMessage, selectedProducts) {
  return [
    {
      role: "system",
      content: buildSystemPrompt(selectedProducts),
    },
    ...appState.conversationMessages,
    {
      role: "user",
      content: userMessage,
    },
  ];
}

function getAssistantPayload(data) {
  const content =
    data?.choices?.[0]?.message?.content ||
    data?.message?.content ||
    data?.content ||
    data?.response ||
    "";

  const citations =
    data?.citations ||
    data?.sources ||
    data?.choices?.[0]?.message?.citations ||
    data?.choices?.[0]?.message?.annotations ||
    [];

  return { content, citations };
}

async function requestWorkerResponse(userMessage, selectedProducts) {
  if (!hasConfiguredWorkerEndpoint()) {
    throw new Error(
      "Set window.WORKER_ENDPOINT in secrets.js before generating a routine.",
    );
  }

  const messages = buildConversationMessages(userMessage, selectedProducts);
  const requestStartTime = performance.now();

  const response = await fetch(workerEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      products: selectedProducts.map(serializeProductForAi),
      webSearch: ENABLE_WEB_SEARCH,
    }),
  });

  if (!response.ok) {
    throw new Error(`Worker request failed with status ${response.status}.`);
  }

  const data = await response.json();
  const assistantPayload = getAssistantPayload(data);
  const assistantContent = assistantPayload.content.trim();

  if (!assistantContent) {
    throw new Error("The worker response did not include assistant content.");
  }

  const responseCitations = Array.isArray(assistantPayload.citations)
    ? assistantPayload.citations
    : [];

  appState.lastDebugInfo = {
    timestamp: new Date().toISOString(),
    requestDurationMs: Math.round(performance.now() - requestStartTime),
    finishReason:
      data?.choices?.[0]?.finish_reason || data?.finish_reason || "unknown",
    messageCount: messages.length,
    productCount: selectedProducts.length,
    contentLength: assistantContent.length,
    citationCount: responseCitations.length,
    usage: data?.usage || null,
  };

  logDebugInfo(appState.lastDebugInfo, data);

  return {
    content: assistantContent,
    citations: responseCitations,
  };
}

function appendConversationMessage(role, content, citations = [], options = {}) {
  const message = {
    id: appState.nextMessageId++,
    role,
    content,
    citations,
    isNew: true,
    isTyping: false,
    typingContent: "",
  };

  appState.conversationMessages.push(message);
  saveChatStateToStorage();
  renderChatWindow();

  if (role === "assistant" && options.typewriter && !prefersReducedMotion()) {
    startTypingAnimation(message.id);
  }
}

function showChatNotice(message) {
  chatWindow.innerHTML = `
    <div class="chat-message assistant notice">
      <div class="chat-bubble">${formatMessageContent(message)}</div>
    </div>
  `;
}

function updateViewSwitchButtons() {
  const isProductsView = appState.activeView === VIEW_PRODUCTS;

  viewProductsButton.classList.toggle("is-active", isProductsView);
  viewProductsButton.setAttribute("aria-pressed", String(isProductsView));

  viewChatButton.classList.toggle("is-active", !isProductsView);
  viewChatButton.setAttribute("aria-pressed", String(!isProductsView));
}

function setActiveView(viewName) {
  appState.activeView = viewName;
  document.body.dataset.activeView = viewName;

  const showProducts = viewName === VIEW_PRODUCTS;

  productViewSections.forEach((section) => {
    section.classList.toggle("is-view-hidden", !showProducts);
  });

  chatViewSections.forEach((section) => {
    section.classList.toggle("is-view-hidden", showProducts);
  });

  updateViewSwitchButtons();
  saveChatStateToStorage();

  if (!showProducts) {
    scrollChatToBottom();
  }
}

function clearChatState() {
  stopTypingAnimation();
  appState.conversationMessages = [];
  appState.routineContextProducts = [];
  appState.routineGenerated = false;
  appState.loadingMessage = "";
  appState.nextMessageId = 1;
  localStorage.removeItem(CHAT_STATE_STORAGE_KEY);
}

function resetAllAppState() {
  stopTypingAnimation();
  appState.selectedProductIds.clear();
  appState.expandedDescriptionIds.clear();
  appState.activeCategory = "";
  appState.activeSearchQuery = "";
  appState.activeView = VIEW_PRODUCTS;
  userInput.value = "";
  productSearch.value = "";
  setActiveCategory("");

  saveSelectedProductsToStorage();
  clearChatState();

  renderApp();
  renderChatWindow();
  setActiveView(VIEW_PRODUCTS);
}

async function generateRoutine() {
  const selectedProducts = getSelectedProducts();

  if (selectedProducts.length === 0) {
    showChatNotice("Select at least one product before generating a routine.");
    return;
  }

  const userMessage = `Create a personalized skincare, haircare, or makeup routine using these selected products. Return a clear morning/evening or step-by-step routine and explain why each product belongs where it does.`;

  appState.conversationMessages = [];
  appState.routineContextProducts = selectedProducts;
  appState.routineGenerated = false;
  renderChatWindow();
  setActiveView(VIEW_CHAT);
  saveChatStateToStorage();

  setChatLoadingState(true, "Generating your personalized routine...");

  try {
    appendConversationMessage("user", userMessage);
    const assistantResponse = await requestWorkerResponse(
      userMessage,
      selectedProducts,
    );
    setChatLoadingState(false);
    appendConversationMessage(
      "assistant",
      assistantResponse.content,
      assistantResponse.citations,
      { typewriter: true },
    );
    appState.routineGenerated = true;
    saveChatStateToStorage();
  } catch (error) {
    console.error("Could not generate routine.", error);
    appState.conversationMessages.push({
      role: "assistant",
      content:
        "I couldn't generate a routine right now. Please check your worker endpoint and try again.",
    });
    saveChatStateToStorage();
    renderChatWindow();
  } finally {
    if (appState.isLoading) {
      setChatLoadingState(false);
    }
  }
}

async function sendFollowUpMessage(userMessage) {
  const selectedProducts = getRoutineContextProducts();

  if (!appState.routineGenerated || selectedProducts.length === 0) {
    showChatNotice(
      "Generate a routine first, then ask follow-up questions here.",
    );
    return;
  }

  setChatLoadingState(true, "Thinking about your follow-up...");

  try {
    appendConversationMessage("user", userMessage);
    const assistantResponse = await requestWorkerResponse(
      userMessage,
      selectedProducts,
    );
    setChatLoadingState(false);
    appendConversationMessage(
      "assistant",
      assistantResponse.content,
      assistantResponse.citations,
      { typewriter: true },
    );
  } catch (error) {
    console.error("Could not send follow-up message.", error);
    appState.conversationMessages.push({
      role: "assistant",
      content:
        "I couldn't answer that right now. Please try again after checking the worker endpoint.",
    });
    renderChatWindow();
  } finally {
    if (appState.isLoading) {
      setChatLoadingState(false);
    }
  }
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No products match your current filters.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = appState.selectedProductIds.has(product.id);
      const isDescriptionExpanded = appState.expandedDescriptionIds.has(
        product.id,
      );

      return `
        <article
          class="product-card ${isSelected ? "selected" : ""}"
          data-product-id="${product.id}"
          tabindex="0"
          role="button"
          aria-pressed="${isSelected}"
        >
          <span class="selection-indicator ${isSelected ? "remove" : "add"}">
            <i class="fa-solid ${isSelected ? "fa-minus" : "fa-plus"}" aria-hidden="true"></i>
          </span>
          <img src="${product.image}" alt="${product.name}" />
          <div class="product-info">
            <h3>${product.name}</h3>
            <p>${product.brand}</p>
            <button
              type="button"
              class="description-toggle"
              data-description-id="${product.id}"
              aria-expanded="${isDescriptionExpanded}"
            >
              ${isDescriptionExpanded ? "Hide details" : "Show details"}
            </button>
            <p class="product-description ${
              isDescriptionExpanded ? "is-open" : ""
            }">
              ${product.description}
            </p>
          </div>
        </article>
      `;
    })
    .join("");
}

function getSelectedProducts() {
  return appState.allProducts.filter((product) =>
    appState.selectedProductIds.has(product.id),
  );
}

function renderSelectedProducts() {
  const selectedProducts = getSelectedProducts();

  selectedCount.textContent = `${selectedProducts.length} selected`;
  clearSelectedButton.disabled = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="selected-empty">No products selected yet.</p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
        <div class="selected-pill" data-selected-id="${product.id}">
          <span>${product.name}</span>
          <button
            type="button"
            class="remove-selected"
            data-remove-id="${product.id}"
            aria-label="Remove ${product.name}"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
      `,
    )
    .join("");
}

function renderApp() {
  applyFilters();
  updateCategoryDropdownDisabledStates();
  displayProducts(appState.filteredProducts);
  renderSelectedProducts();
}

function toggleProductSelection(productId) {
  if (appState.selectedProductIds.has(productId)) {
    appState.selectedProductIds.delete(productId);
  } else {
    appState.selectedProductIds.add(productId);
  }

  saveSelectedProductsToStorage();
  renderApp();
}

function toggleDescription(productId) {
  if (appState.expandedDescriptionIds.has(productId)) {
    appState.expandedDescriptionIds.delete(productId);
  } else {
    appState.expandedDescriptionIds.add(productId);
  }

  renderApp();
}

/* Handle selection and description interactions in product grid */
productsContainer.addEventListener("click", (event) => {
  const descriptionButton = event.target.closest(".description-toggle");
  if (descriptionButton) {
    event.stopPropagation();
    toggleDescription(Number(descriptionButton.dataset.descriptionId));
    return;
  }

  const productCard = event.target.closest(".product-card");
  if (!productCard) {
    return;
  }

  toggleProductSelection(Number(productCard.dataset.productId));
});

productsContainer.addEventListener("keydown", (event) => {
  const productCard = event.target.closest(".product-card");
  if (!productCard) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleProductSelection(Number(productCard.dataset.productId));
  }
});

selectedProductsList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-selected");
  if (!removeButton) {
    return;
  }

  appState.selectedProductIds.delete(Number(removeButton.dataset.removeId));
  saveSelectedProductsToStorage();
  renderApp();
});

clearSelectedButton.addEventListener("click", () => {
  appState.selectedProductIds.clear();
  saveSelectedProductsToStorage();
  renderApp();
});

generateRoutineButton.addEventListener("click", () => {
  generateRoutine();
});

viewProductsButton.addEventListener("click", () => {
  setActiveView(VIEW_PRODUCTS);
});

viewChatButton.addEventListener("click", () => {
  setActiveView(VIEW_CHAT);
});

resetButton.addEventListener("click", () => {
  if (!resetConfirmModalElement) {
    resetAllAppState();
    return;
  }

  const modalInstance = window.bootstrap?.Modal.getOrCreateInstance(
    resetConfirmModalElement,
  );
  modalInstance?.show();
});

resetConfirmButton.addEventListener("click", () => {
  resetAllAppState();

  const modalInstance = window.bootstrap?.Modal.getInstance(
    resetConfirmModalElement,
  );
  modalInstance?.hide();
});

categoryDropdownMenu.addEventListener("click", (event) => {
  const categoryItem = event.target.closest(".dropdown-item");
  if (!categoryItem || categoryItem.disabled) {
    return;
  }

  setActiveCategory(categoryItem.dataset.category);
  renderApp();
});

productSearch.addEventListener("input", (event) => {
  appState.activeSearchQuery = event.target.value;
  renderApp();
});

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const message = userInput.value.trim();
  if (!message) {
    return;
  }

  userInput.value = "";
  sendFollowUpMessage(message);
});

async function initializeApp() {
  try {
    registerDebugConsoleApi();
    applyDirectionFromBrowserLanguage();
    appState.allProducts = await loadProducts();
    loadSelectedProductsFromStorage();
    sanitizeSelectedIds();
    loadChatStateFromStorage();
    setActiveCategory("");
    saveSelectedProductsToStorage();
    renderApp();
    renderChatWindow();
    setActiveView(appState.activeView);
  } catch (error) {
    console.error("Could not load products.", error);
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        We could not load products right now. Please refresh and try again.
      </div>
    `;
  }
}

initializeApp();
