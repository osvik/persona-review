let currentSessionId = null;
let pollInterval = null;
let configData = null;
let personasData = [];
let logsLength = 0;
let chatMessagesCount = 0;
let currentReportData = null;

// Elements
const selectPersona = document.getElementById("select-persona");
const selectProvider = document.getElementById("select-provider");
const selectModel = document.getElementById("select-model");
const inputUrl = document.getElementById("input-url");
const checkSubmit = document.getElementById("check-submit");
const checkNav = document.getElementById("check-nav");
const btnStartReview = document.getElementById("btn-start-review");
const setupForm = document.getElementById("setup-form");

const personaSummaryBox = document.getElementById("persona-summary-box");
const personaInfoName = document.getElementById("persona-info-name");
const personaInfoRole = document.getElementById("persona-info-role");
const personaInfoDevice = document.getElementById("persona-info-device");
const personaInfoTech = document.getElementById("persona-info-tech");
const personaInfoEngagement = document.getElementById(
  "persona-info-engagement",
);
const personaInfoScrutiny = document.getElementById("persona-info-scrutiny");
const personaInfoGoals = document.getElementById("persona-info-goals");

const runSection = document.getElementById("run-section");
const logTerminal = document.getElementById("log-terminal");
const viewportScreenshot = document.getElementById("viewport-screenshot");
const viewportOverlay = document.getElementById("viewport-overlay");
const viewportOverlayText = document.getElementById("viewport-overlay-text");
const agentPulse = document.getElementById("agent-pulse");
const agentStatusBar = document.getElementById("agent-status-bar");
const agentCostBar = document.getElementById("agent-cost-bar");
const providerBadges = document.getElementById("provider-badges");

const resultsSection = document.getElementById("results-section");
const resultsSummary = document.getElementById("results-summary");
const resultsAuthorName = document.getElementById("results-author-name");
const resultsAuthorRole = document.getElementById("results-author-role");
const resultsUrlSub = document.getElementById("results-url-sub");
const resultsCost = document.getElementById("results-cost");
const btnDownloadPdf = document.getElementById("btn-download-pdf");
const resultsLiked = document.getElementById("results-liked");
const resultsConfused = document.getElementById("results-confused");
const resultsAccessibility = document.getElementById("results-accessibility");
const resultsTrustPositive = document.getElementById("results-trust-positive");
const resultsTrustNegative = document.getElementById("results-trust-negative");
const resultsFriction = document.getElementById("results-friction");
const resultsTrace = document.getElementById("results-trace");

const chatSection = document.getElementById("chat-section");
const chatHistory = document.getElementById("chat-history");
const chatInput = document.getElementById("chat-input");
const chatForm = document.getElementById("chat-form");
const btnChatSend = document.getElementById("btn-chat-send");
const chatPersonaName = document.getElementById("chat-persona-name");

function formatUsd(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

// 1. Initial configuration load
async function init() {
  try {
    // Fetch system configurations
    const configRes = await fetch("/api/config");
    configData = await configRes.json();

    // Fetch personas list
    const personasRes = await fetch("/api/personas");
    personasData = await personasRes.json();

    renderConfigBadges();
    populateProviderDropdown();
    populatePersonaDropdown();
  } catch (err) {
    console.error("Initialization failed:", err);
    alert(
      "Could not load backend configurations. Make sure the server is running.",
    );
  }
}

// Render status badges in navigation
function renderConfigBadges() {
  providerBadges.innerHTML = "";
  Object.keys(configData.providers).forEach((p) => {
    const info = configData.providers[p];
    const badge = document.createElement("div");
    badge.className = `api-badge ${info.ready ? "ready" : ""}`;
    badge.title = info.ready
      ? `API key set for ${p}`
      : `Missing ${info.envVar}`;

    const dot = document.createElement("span");
    dot.className = "dot";
    badge.appendChild(dot);

    const name = document.createTextNode(
      p.charAt(0).toUpperCase() + p.slice(1),
    );
    badge.appendChild(name);

    providerBadges.appendChild(badge);
  });
}

// Populate provider dropdown
function populateProviderDropdown() {
  selectProvider.innerHTML = "";
  Object.keys(configData.providers).forEach((p) => {
    const info = configData.providers[p];
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
    if (p === configData.defaultProvider) {
      opt.selected = true;
    }
    selectProvider.appendChild(opt);
  });

  updateModelOptions();
  selectProvider.addEventListener("change", updateModelOptions);
}

// Update model list when provider changes
function updateModelOptions() {
  const provider = selectProvider.value;
  const info = configData.providers[provider];

  selectModel.innerHTML = "";
  info.models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    if (m === info.defaultModel) {
      opt.selected = true;
    }
    selectModel.appendChild(opt);
  });
}

// Populate persona dropdown
function populatePersonaDropdown() {
  selectPersona.innerHTML =
    '<option value="" disabled selected>Select a Persona...</option>';
  personasData.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.role})`;
    selectPersona.appendChild(opt);
  });

  selectPersona.addEventListener("change", handlePersonaChange);
}

// Display persona summary info on change
function handlePersonaChange() {
  const pId = selectPersona.value;
  const p = personasData.find((persona) => persona.id === pId);
  if (!p) return;

  personaInfoName.textContent = p.name;
  personaInfoRole.textContent = `— ${p.role}`;
  personaInfoDevice.textContent = p.device;
  personaInfoTech.textContent = p.tech_confidence;
  personaInfoEngagement.textContent = p.cause_engagement;
  personaInfoScrutiny.textContent = p.scrutiny;

  // Format goals and frustrations
  personaInfoGoals.innerHTML = `
    <strong>Goals:</strong> ${p.goals.join(", ")}<br>
    <strong>Frustrations:</strong> ${p.frustrations.join(", ")}
  `;

  personaSummaryBox.classList.remove("hidden");
}

// 2. Start review audit
setupForm.addEventListener("submit", async () => {
  const personaId = selectPersona.value;
  const url = inputUrl.value;
  const provider = selectProvider.value;
  const model = selectModel.value;
  const allowSubmit = checkSubmit.checked;
  const allowCrossPageNavigation = checkNav.checked;

  if (!url || !personaId) return;

  // Clear previous states
  btnStartReview.disabled = true;
  btnStartReview.textContent = "Launching...";

  runSection.classList.add("hidden");
  resultsSection.classList.add("hidden");
  chatSection.classList.add("hidden");

  logTerminal.innerHTML = "";
  logsLength = 0;
  chatMessagesCount = 0;
  viewportScreenshot.src = "";
  viewportScreenshot.classList.add("placeholder");
  viewportOverlay.classList.remove("hidden");
  viewportOverlayText.textContent = "Awaiting Browser Session...";
  agentPulse.classList.add("running");
  agentPulse.textContent = "Active";

  try {
    const res = await fetch("/api/review/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personaId,
        url,
        provider,
        model,
        allowSubmit,
        allowCrossPageNavigation,
      }),
    });

    const data = await res.json();
    if (data.error) {
      alert(`Error starting audit: ${data.error}`);
      btnStartReview.disabled = false;
      btnStartReview.textContent = "Start AI Audit";
      return;
    }

    currentSessionId = data.sessionId;
    runSection.classList.remove("remove", "hidden");
    runSection.scrollIntoView({ behavior: "smooth" });
    btnDownloadPdf?.classList.add("hidden");
    currentReportData = null;

    // Start Polling
    pollInterval = setInterval(pollStatus, 800);
  } catch (err) {
    console.error("Start audit request failed:", err);
    alert("Could not communicate with the review backend.");
    btnStartReview.disabled = false;
    btnStartReview.textContent = "Start AI Audit";
  }
});

// 3. Poll session status
async function pollStatus() {
  if (!currentSessionId) return;

  try {
    const res = await fetch(`/api/review/status/${currentSessionId}`);
    const data = await res.json();

    if (data.error) {
      handleAuditFailure(data.error);
      return;
    }

    // Update Logs
    updateTerminalLogs(data.logs);

    // Update Screenshot
    if (data.screenshot) {
      viewportScreenshot.src = data.screenshot;
      viewportScreenshot.classList.remove("placeholder");
      viewportOverlay.classList.add("hidden");
    }

    // Update agent status text
    agentStatusBar.textContent = data.statusMessage;

    // Check complete
    if (data.costTracker) {
      updateCostDisplay(data.costTracker);
    }

    if (data.status === "completed") {
      handleAuditSuccess(data);
    } else if (data.status === "failed") {
      handleAuditFailure(
        data.error || "Review failed inside the LLM execution loop.",
      );
    }
  } catch (err) {
    console.error("Poll status failed:", err);
  }
}

// Update terminal scroll logs
function updateTerminalLogs(logs) {
  if (logs.length > logsLength) {
    for (let i = logsLength; i < logs.length; i++) {
      const line = logs[i];
      const entry = document.createElement("div");

      // Style entry based on message types
      if (
        line.includes("Initializing") ||
        line.includes("loaded in") ||
        line.includes("completed")
      ) {
        entry.className = "log-entry status-msg";
      } else if (
        line.includes("scrolls") ||
        line.includes("clicks") ||
        line.includes("types") ||
        line.includes("SUBMITS")
      ) {
        entry.className = "log-entry action-msg";
      } else if (line.startsWith("Error:") || line.startsWith("Failed:")) {
        entry.className = "log-entry error-msg";
      } else {
        entry.className = "log-entry";
      }

      entry.textContent = line;
      logTerminal.appendChild(entry);
    }
    logTerminal.scrollTop = logTerminal.scrollHeight;
    logsLength = logs.length;
  }
}

// Handle failure
function handleAuditFailure(errorMsg) {
  clearInterval(pollInterval);
  agentPulse.classList.remove("running");
  agentPulse.textContent = "Error";
  agentPulse.style.backgroundColor = "var(--badge-high-bg)";
  agentPulse.style.color = "var(--badge-high-text)";

  const entry = document.createElement("div");
  entry.className = "log-entry error-msg";
  entry.textContent = `[Audit Terminated: ${errorMsg}]`;
  logTerminal.appendChild(entry);
  logTerminal.scrollTop = logTerminal.scrollHeight;

  btnStartReview.disabled = false;
  btnStartReview.textContent = "Start AI Audit";
  alert(`Usability Audit Failed: ${errorMsg}`);
}

// Handle success
function handleAuditSuccess(data) {
  clearInterval(pollInterval);

  agentPulse.classList.remove("running");
  agentPulse.textContent = "Completed";
  agentPulse.style.backgroundColor = "var(--badge-low-bg)";
  agentPulse.style.color = "var(--badge-low-text)";

  currentReportData = {
    feedback: data.feedback,
    persona: data.persona,
    url: data.url,
    costTracker: data.costTracker || null,
  };

  // Render report
  renderReport(data.feedback, data.persona, data.url);

  // Setup Q&A chat
  setupQAChat(data.persona, data.messages);

  btnStartReview.disabled = false;
  btnStartReview.textContent = "Start AI Audit";
}

// 4. Render Final report
function renderReport(feedback, persona, url) {
  resultsUrlSub.textContent = `Target page: ${url}`;
  resultsSummary.textContent = feedback.summary;
  resultsAuthorName.textContent = persona.name;
  resultsAuthorRole.textContent = persona.role;

  if (resultsCost) {
    const costInfo = currentReportData?.costTracker;
    resultsCost.textContent = costInfo
      ? `LLM cost: ${formatUsd(costInfo.total)} of ${formatUsd(costInfo.limit)} cap`
      : "";
  }

  // Liked items
  resultsLiked.innerHTML = "";
  if (feedback.liked && feedback.liked.length) {
    feedback.liked.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      resultsLiked.appendChild(li);
    });
  } else {
    resultsLiked.innerHTML = "<li>No specific elements liked by persona</li>";
  }

  // Confused items
  resultsConfused.innerHTML = "";
  if (feedback.confused_by && feedback.confused_by.length) {
    feedback.confused_by.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      resultsConfused.appendChild(li);
    });
  } else {
    resultsConfused.innerHTML =
      "<li>No confusion points logged by persona</li>";
  }

  // Accessibility issues
  resultsAccessibility.innerHTML = "";
  if (feedback.accessibility_issues && feedback.accessibility_issues.length) {
    feedback.accessibility_issues.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      resultsAccessibility.appendChild(li);
    });
  } else {
    resultsAccessibility.innerHTML = "<li>No accessibility issues noticed</li>";
  }

  // Trust signals
  resultsTrustPositive.innerHTML = "";
  if (
    feedback.trust_signals.positive &&
    feedback.trust_signals.positive.length
  ) {
    feedback.trust_signals.positive.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      resultsTrustPositive.appendChild(li);
    });
  } else {
    resultsTrustPositive.innerHTML = "<li>None noted</li>";
  }

  resultsTrustNegative.innerHTML = "";
  if (
    feedback.trust_signals.negative &&
    feedback.trust_signals.negative.length
  ) {
    feedback.trust_signals.negative.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      resultsTrustNegative.appendChild(li);
    });
  } else {
    resultsTrustNegative.innerHTML = "<li>None noted</li>";
  }

  // Friction points
  resultsFriction.innerHTML = "";
  if (feedback.friction && feedback.friction.length) {
    feedback.friction.forEach((point) => {
      const row = document.createElement("div");
      row.className = "friction-row";

      const badgeCell = document.createElement("div");
      badgeCell.className = "friction-badge-cell";
      const badge = document.createElement("span");
      badge.className = `severity-pill ${point.severity}`;
      badge.textContent = point.severity;
      badgeCell.appendChild(badge);

      const detailsCell = document.createElement("div");
      detailsCell.className = "friction-details-cell";

      const where = document.createElement("div");
      where.className = "friction-where";
      where.textContent = point.where;
      detailsCell.appendChild(where);

      if (point.quote) {
        const quote = document.createElement("div");
        quote.className = "friction-quote";
        quote.textContent = `“${point.quote}”`;
        detailsCell.appendChild(quote);
      }

      row.appendChild(badgeCell);
      row.appendChild(detailsCell);
      resultsFriction.appendChild(row);
    });
  } else {
    resultsFriction.innerHTML =
      '<p style="color: var(--ink-mute); font-style: italic;">No friction points flagged.</p>';
  }

  // User Interaction Trace
  resultsTrace.innerHTML = "";
  if (feedback.trace && feedback.trace.length) {
    feedback.trace.forEach((t) => {
      const item = document.createElement("div");
      item.className = "trace-item";

      const marker = document.createElement("div");
      marker.className = "trace-marker";

      const content = document.createElement("div");
      content.className = "trace-content";

      const step = document.createElement("div");
      step.className = "trace-step";
      step.textContent = t.step;

      const reaction = document.createElement("div");
      reaction.className = "trace-reaction";
      reaction.textContent = t.reaction;

      content.appendChild(step);
      content.appendChild(reaction);
      item.appendChild(marker);
      item.appendChild(content);

      resultsTrace.appendChild(item);
    });
  }

  // Reveal section
  resultsSection.classList.remove("hidden");
  if (btnDownloadPdf) {
    btnDownloadPdf.classList.remove("hidden");
    btnDownloadPdf.disabled = false;
  }
}

function updateCostDisplay(costTracker) {
  if (!costTracker) return;
  if (agentCostBar) {
    agentCostBar.textContent = `LLM cost: ${formatUsd(costTracker.total)} of ${formatUsd(costTracker.limit)} cap`;
    agentCostBar.classList.remove("hidden");
  }
  if (resultsCost) {
    resultsCost.textContent = `LLM cost: ${formatUsd(costTracker.total)} of ${formatUsd(costTracker.limit)} cap`;
  }
}

// 5. Chat Follow-up Q&A Q Setup
function setupQAChat(persona, messages) {
  chatPersonaName.textContent = persona.name;
  chatInput.placeholder = `Ask ${persona.name} a question about the page...`;

  // Clear chat except system message
  chatHistory.innerHTML = `
    <div class="message system">
      <div class="message-content">
        Conversation with <strong>${persona.name}</strong> is active. You can type follow-up questions below.
      </div>
    </div>
  `;

  chatMessagesCount = 0;

  // Render existing follow-up messages if any
  messages.forEach((msg) => {
    appendChatMessage(msg.role, msg.text, msg.screenshot);
  });

  chatSection.classList.remove("hidden");
}

function appendChatMessage(role, text, screenshot) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  contentDiv.textContent = text;

  msgDiv.appendChild(contentDiv);
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // Update viewport image if chat includes a screenshot
  if (role === "persona" && screenshot) {
    viewportScreenshot.src = screenshot;
  }
}

// Chat Form Submit
chatForm.addEventListener("submit", async () => {
  const query = chatInput.value.trim();
  if (!query || !currentSessionId) return;

  chatInput.value = "";
  chatInput.disabled = true;
  btnChatSend.disabled = true;
  btnChatSend.textContent = "Thinking...";

  // Add User message
  appendChatMessage("user", query);

  // Re-enable pulse animations
  agentPulse.classList.add("running");
  agentPulse.textContent = "Thinking";
  agentPulse.style.backgroundColor = "";
  agentPulse.style.color = "";

  try {
    const res = await fetch(`/api/review/chat/${currentSessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: query }),
    });

    const data = await res.json();
    if (data.error) {
      alert(`Chat error: ${data.error}`);
      resetChatInputs();
      return;
    }

    // Start polling again to wait for follow-up result
    pollInterval = setInterval(pollChatResponse, 800);
  } catch (err) {
    console.error("Send chat failed:", err);
    alert("Could not communicate with the chat endpoint.");
    resetChatInputs();
  }
});

// Poll Chat Turn status
async function pollChatResponse() {
  if (!currentSessionId) return;

  try {
    const res = await fetch(`/api/review/status/${currentSessionId}`);
    const data = await res.json();

    updateTerminalLogs(data.logs);
    agentStatusBar.textContent = data.statusMessage;

    // We check if the chat message count has increased in the session
    const backendMsgs = data.messages || [];
    if (backendMsgs.length > chatMessagesCount) {
      // Find new messages (typically user message + persona message)
      for (let i = chatMessagesCount; i < backendMsgs.length; i++) {
        const msg = backendMsgs[i];
        appendChatMessage(msg.role, msg.text, msg.screenshot);
      }
      chatMessagesCount = backendMsgs.length;
    }

    // Check if the current follow-up operation finished (completed)
    if (data.status === "completed") {
      clearInterval(pollInterval);
      resetChatInputs();

      agentPulse.classList.remove("running");
      agentPulse.textContent = "Chat Completed";
      agentPulse.style.backgroundColor = "var(--badge-low-bg)";
      agentPulse.style.color = "var(--badge-low-text)";
    } else if (data.status === "failed") {
      clearInterval(pollInterval);
      resetChatInputs();
      alert(`Follow-up failed: ${data.error}`);
    }
  } catch (err) {
    console.error("Poll chat response failed:", err);
  }
}

function resetChatInputs() {
  chatInput.disabled = false;
  btnChatSend.disabled = false;
  btnChatSend.textContent = "Send Message";
  chatInput.focus();
}

function downloadReportPdf() {
  if (!currentReportData) return;
  const jspdf = window.jspdf;
  const jsPDF = jspdf?.jsPDF || jspdf?.default || null;
  if (!jsPDF) {
    alert("Unable to generate PDF because the PDF library failed to load.");
    return;
  }

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;
  let y = 40;
  const lineHeight = 16;

  const addWrappedText = (text, options = {}) => {
    const lines = doc.splitTextToSize(text, maxWidth, options);
    lines.forEach((line) => {
      if (y > 750) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    });
  };

  const addSection = (title, content) => {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin, y);
    y += lineHeight;
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    addWrappedText(content);
    y += lineHeight / 2;
  };

  const addList = (title, items, emptyLabel) => {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin, y);
    y += lineHeight;
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");

    if (!items || !items.length) {
      addWrappedText(emptyLabel);
      y += lineHeight / 2;
      return;
    }

    items.forEach((item) => {
      addWrappedText(`• ${item}`);
    });
    y += lineHeight / 2;
  };

  const { feedback, persona, url, costTracker } = currentReportData;
  const reportTime = new Date();
  const reportTimeLabel = reportTime.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const filenameTimestamp = reportTime.toISOString().replace(/[:.]/g, "-");

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Persona Feedback Report", margin, y);
  y += lineHeight * 1.8;

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  addWrappedText(`Generated: ${reportTimeLabel}`);
  y += lineHeight;
  addWrappedText(`Target page: ${url}`);
  y += 4;
  addWrappedText(`Persona: ${persona.name} — ${persona.role}`);
  y += lineHeight;
  if (costTracker) {
    addWrappedText(
      `LLM cost: ${formatUsd(costTracker.total)} of ${formatUsd(costTracker.limit)} cap`,
    );
    y += lineHeight;
  }

  addSection("Summary", feedback.summary || "No summary available.");
  addList(
    "Liked Elements",
    feedback.liked,
    "No specific elements liked by persona.",
  );
  addList(
    "Confusing Elements",
    feedback.confused_by,
    "No confusion points logged by persona.",
  );
  addList(
    "Accessibility Issues",
    feedback.accessibility_issues,
    "No accessibility issues noticed.",
  );
  addList(
    "Positive Trust Signals",
    feedback.trust_signals?.positive,
    "None noted.",
  );
  addList(
    "Negative Trust Signals",
    feedback.trust_signals?.negative,
    "None noted.",
  );

  const frictionItems = feedback.friction?.length
    ? feedback.friction.map((point) => {
      const quoteText = point.quote ? ` Quote: “${point.quote}”.` : "";
      return `${point.severity.toUpperCase()} — ${point.where}.${quoteText}`;
    })
    : [];
  addList("Friction Points", frictionItems, "No friction points flagged.");

  const traceItems = feedback.trace?.length
    ? feedback.trace.map((t) => `${t.step} — ${t.reaction}`)
    : [];
  addList(
    "User Interaction Trace",
    traceItems,
    "No interaction trace available.",
  );

  doc.save(`persona-feedback-report-${filenameTimestamp}.pdf`);
}

btnDownloadPdf?.addEventListener("click", downloadReportPdf);

// Initialize on page load
window.addEventListener("DOMContentLoaded", init);
