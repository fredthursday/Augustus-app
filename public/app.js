// Augustus — personal assistant with persistent local memory.
// No build step required. Talks to /api/chat (a serverless function that holds the API key).

const STORAGE_KEYS = {
  PROFILE: "augustus:profile",
  MESSAGES: "augustus:messages",
  TRAITS: "augustus:traits",
  NOTES: "augustus:notes",
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- Local storage helpers ----------

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------- State ----------

let profile = loadJSON(STORAGE_KEYS.PROFILE, { name: "" });
let messages = loadJSON(STORAGE_KEYS.MESSAGES, []);
let traits = loadJSON(STORAGE_KEYS.TRAITS, []);
let notes = loadJSON(STORAGE_KEYS.NOTES, []); // explicit user-saved notes, distinct from auto-learned traits
let panelOpen = false;
let sending = false;
let pendingFeedbackId = null;
let storageError = false;

function persistAll() {
  const ok1 = saveJSON(STORAGE_KEYS.PROFILE, profile);
  const ok2 = saveJSON(STORAGE_KEYS.MESSAGES, messages);
  const ok3 = saveJSON(STORAGE_KEYS.TRAITS, traits);
  const ok4 = saveJSON(STORAGE_KEYS.NOTES, notes);
  storageError = !(ok1 && ok2 && ok3 && ok4);
}

// ---------- API calls (via local serverless proxy) ----------

async function callAugustus(history, systemPrompt) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history, system: systemPrompt, max_tokens: 1000 }),
  });
  if (!res.ok) throw new Error("API error " + res.status);
  const data = await res.json();
  const text = (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
  return {
    text: text || "I couldn't generate a response just now.",
    savedNotes: Array.isArray(data.saved_notes) ? data.saved_notes : [],
  };
}

async function extractTraits(userText, assistantText) {
  const prompt = `You silently observe a conversation between a person and an assistant and extract durable facts or preferences about the PERSON ONLY — things worth remembering for future conversations (interests, communication style preferences, recurring goals, constraints, dislikes). Be conservative: only extract things that are clearly stated or strongly implied, not one-off details.

Person said: "${userText}"
Assistant replied: "${assistantText}"

Respond ONLY with JSON, no preamble, no markdown fences, in this exact shape:
{"traits": ["short fact or preference", ...]}
If nothing durable was learned, respond {"traits": []}. Max 2 traits.`;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: 300 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || "").join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed.traits) ? parsed.traits.filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ---------- System prompt ----------

function buildSystemPrompt() {
  const traitLines = traits.length
    ? traits.map((t) => `- ${t.text}${t.source === "feedback" ? " (learned from explicit correction)" : ""}`).join("\n")
    : "- (nothing learned yet — this is early in the relationship)";
  const downvoteNotes = messages
    .filter((m) => m.feedback === "down" && m.note)
    .slice(-5)
    .map((m) => `- Avoid: ${m.note}`)
    .join("\n");
  const noteLines = notes.length
    ? notes.map((n) => `- ${n.text}`).join("\n")
    : "- (none saved yet)";

  return `You are Augustus, a personal assistant for ${profile.name || "the user"}.

What you've learned about this person so far:
${traitLines}

${downvoteNotes ? `Recent corrections to apply:\n${downvoteNotes}\n` : ""}
Things they've explicitly asked you to remember:
${noteLines}

You have tools available: calculate (math/unit conversions), get_weather, web_search, and save_note. Use them whenever they'd genuinely help — don't ask permission first, just use them. Use save_note only when the user clearly wants something remembered for later (e.g. "remember that...", "save this").

Be genuinely useful, warm, and concise. Adapt your tone and content to what you've learned above. Don't mention that you're "an AI that learns" or narrate this system — just naturally apply what you know.`;
}

// ---------- Rendering ----------

const root = document.getElementById("root");

function icon(name, size = 14) {
  const icons = {
    thumbsUp: `<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>`,
    thumbsDown: `<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>`,
    send: `<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>`,
    x: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
    chevronDown: `<path d="m6 9 6 6 6-6"/>`,
    chevronUp: `<path d="m18 15-6-6-6 6"/>`,
    trash: `<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
    sprout: `<path d="M7 20h10"/><path d="M10 20c0-4.5-2.5-6.5-5-6.5C5 17 7 20 10 20Z"/><path d="M14 20c0-6 3-8 6-8.5-.5 4-2 8.5-6 8.5Z"/><path d="M12 10V4"/><path d="M9 4c0 2 1 3 3 3s3-1 3-3"/>`,
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;
}

function growthRingSVG(traitCount) {
  const rings = Math.min(6, Math.max(1, Math.ceil(traitCount / 2) || 1));
  const size = 56, center = size / 2;
  let circles = "";
  for (let i = 0; i < rings; i++) {
    const r = 6 + i * 4;
    const opacity = 0.18 + (i / rings) * 0.55;
    circles += `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="#9C7A4E" stroke-width="1.4" opacity="${opacity}"/>`;
  }
  circles += `<circle cx="${center}" cy="${center}" r="3" fill="#5C4424"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circles}</svg>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function render() {
  const showOnboarding = !profile.name;

  root.innerHTML = `
    <div class="app">
      ${showOnboarding ? renderOnboarding() : ""}
      <header>
        <div class="header-left">
          ${growthRingSVG(traits.length)}
          <div>
            <div class="header-title">Augustus</div>
            <div class="header-sub">${traits.length === 0 ? "still getting to know you" : `${traits.length} thing${traits.length === 1 ? "" : "s"} learned so far`}</div>
          </div>
        </div>
        <button class="ledger-toggle" id="ledgerToggleBtn">Ledger ${icon(panelOpen ? "chevronUp" : "chevronDown", 14)}</button>
      </header>

      <div id="ledgerPanel" class="${panelOpen ? "open" : ""}">
        ${storageError ? `<p class="storage-warn">Local storage isn't available in this browser — your data won't be saved between visits.</p>` : ""}
        ${traits.length === 0
          ? `<p class="empty-note">Nothing learned yet. Chat naturally, or correct a response with 👎 and I'll remember.</p>`
          : `<div class="trait-list">${traits.map((t) => `
              <div class="trait-chip" data-trait-id="${t.id}">
                <span>${escapeHtml(t.text)}</span>
                <button class="remove-trait-btn" data-trait-id="${t.id}" aria-label="Remove">${icon("x", 11)}</button>
              </div>`).join("")}</div>`
        }
        ${notes.length > 0 ? `
          <p class="empty-note" style="margin-top:10px;margin-bottom:6px;">Saved notes:</p>
          <div class="trait-list">${notes.map((n) => `
            <div class="trait-chip" data-note-id="${n.id}">
              <span>${escapeHtml(n.text)}</span>
              <button class="remove-note-btn" data-note-id="${n.id}" aria-label="Remove">${icon("x", 11)}</button>
            </div>`).join("")}</div>
        ` : ""}
        <button class="reset-btn" id="resetBtn">${icon("trash", 11)} Reset everything</button>
      </div>

      <div id="messages">
        ${messages.length === 0 ? `
          <div class="empty-state">
            ${icon("sprout", 22)}
            <p>Say something — anything you mention helps Augustus get sharper over time.</p>
          </div>` : messages.map(renderMessage).join("")}
      </div>

      <div class="composer">
        <div class="composer-row">
          <textarea id="composerInput" placeholder="Ask anything…" rows="1">${escapeHtml(draftInput)}</textarea>
          <button class="send" id="sendBtn" ${(!draftInput.trim() || sending) ? "disabled" : ""} aria-label="Send">${icon("send", 16)}</button>
        </div>
      </div>
    </div>
  `;

  attachListeners();
  scrollMessagesToBottom();
}

let draftInput = "";
let onboardingDraft = "";

function renderOnboarding() {
  return `
    <div class="overlay">
      <div class="overlay-card">
        ${icon("sprout", 26)}
        <h1>Meet Augustus</h1>
        <p>Everything you tell him gets folded into how he responds — nothing resets between visits.</p>
        <input id="onboardingInput" placeholder="What should he call you?" value="${escapeHtml(onboardingDraft)}" autofocus />
        <button class="primary" id="onboardingBtn" ${!onboardingDraft.trim() ? "disabled" : ""}>Begin</button>
      </div>
    </div>
  `;
}

function renderMessage(m) {
  const isUser = m.role === "user";
  let html = `<div class="msg-row ${isUser ? "user" : "assistant"}"><div class="msg-col">`;
  html += `<div class="bubble ${isUser ? "user" : "assistant"}">${escapeHtml(m.text)}</div>`;
  if (!isUser && !m.pending) {
    html += `<div class="fb-row">
      <button class="fb-btn ${m.feedback === "up" ? "active-up" : ""}" data-fb="up" data-id="${m.id}">${icon("thumbsUp", 13)}</button>
      <button class="fb-btn ${m.feedback === "down" ? "active-down" : ""}" data-fb="down" data-id="${m.id}">${icon("thumbsDown", 13)}</button>
      ${m.feedback === "down" && m.note ? `<span class="fb-note-tag">noted: ${escapeHtml(m.note)}</span>` : ""}
    </div>`;
  }
  html += `</div></div>`;
  if (pendingFeedbackId === m.id) {
    html += `<div class="note-prompt" style="margin-top:6px;max-width:82%;" id="notePrompt">
      <input id="noteInput" placeholder="What was wrong? (optional)" autofocus />
      <button class="save" id="noteSaveBtn">Save</button>
      <button class="skip" id="noteSkipBtn">Skip</button>
    </div>`;
  }
  return html;
}

function scrollMessagesToBottom() {
  const el = document.getElementById("messages");
  if (el) el.scrollTop = el.scrollHeight;
}

// ---------- Event wiring ----------

function attachListeners() {
  const ledgerToggleBtn = document.getElementById("ledgerToggleBtn");
  if (ledgerToggleBtn) ledgerToggleBtn.onclick = () => { panelOpen = !panelOpen; render(); };

  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) resetBtn.onclick = () => {
    messages = [];
    traits = [];
    notes = [];
    persistAll();
    render();
  };

  document.querySelectorAll(".remove-trait-btn").forEach((btn) => {
    btn.onclick = () => {
      traits = traits.filter((t) => t.id !== btn.dataset.traitId);
      persistAll();
      render();
    };
  });

  document.querySelectorAll(".remove-note-btn").forEach((btn) => {
    btn.onclick = () => {
      notes = notes.filter((n) => n.id !== btn.dataset.noteId);
      persistAll();
      render();
    };
  });

  document.querySelectorAll(".fb-btn").forEach((btn) => {
    btn.onclick = () => handleFeedback(btn.dataset.id, btn.dataset.fb);
  });

  const noteSaveBtn = document.getElementById("noteSaveBtn");
  const noteSkipBtn = document.getElementById("noteSkipBtn");
  const noteInput = document.getElementById("noteInput");
  if (noteSaveBtn) noteSaveBtn.onclick = () => submitDownvoteNote(noteInput.value);
  if (noteSkipBtn) noteSkipBtn.onclick = () => {
    messages = messages.map((m) => (m.id === pendingFeedbackId ? { ...m, feedback: "down" } : m));
    pendingFeedbackId = null;
    persistAll();
    render();
  };
  if (noteInput) {
    noteInput.onkeydown = (e) => {
      if (e.key === "Enter") submitDownvoteNote(noteInput.value);
      if (e.key === "Escape") noteSkipBtn.click();
    };
  }

  const composerInput = document.getElementById("composerInput");
  if (composerInput) {
    composerInput.oninput = (e) => { draftInput = e.target.value; updateSendButtonState(); };
    composerInput.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    };
    composerInput.focus();
    composerInput.setSelectionRange(draftInput.length, draftInput.length);
  }

  const sendBtn = document.getElementById("sendBtn");
  if (sendBtn) sendBtn.onclick = handleSend;

  const onboardingInput = document.getElementById("onboardingInput");
  const onboardingBtn = document.getElementById("onboardingBtn");
  if (onboardingInput) {
    onboardingInput.oninput = (e) => {
      onboardingDraft = e.target.value;
      onboardingBtn.disabled = !onboardingDraft.trim();
    };
    onboardingInput.onkeydown = (e) => { if (e.key === "Enter") finishOnboarding(); };
    onboardingInput.focus();
  }
  if (onboardingBtn) onboardingBtn.onclick = finishOnboarding;
}

function updateSendButtonState() {
  const sendBtn = document.getElementById("sendBtn");
  if (sendBtn) sendBtn.disabled = !draftInput.trim() || sending;
}

function finishOnboarding() {
  if (!onboardingDraft.trim()) return;
  profile = { ...profile, name: onboardingDraft.trim() };
  persistAll();
  render();
}

async function handleSend() {
  if (!draftInput.trim() || sending) return;
  const userText = draftInput.trim();
  const userMsg = { id: uid(), role: "user", text: userText };
  const pendingMsg = { id: uid(), role: "assistant", text: "…", pending: true };
  messages = [...messages, userMsg, pendingMsg];
  draftInput = "";
  sending = true;
  persistAll();
  render();

  try {
    const history = messages
      .filter((m) => !m.pending)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.text }));
    const { text: replyText, savedNotes: newSavedNotes } = await callAugustus(history, buildSystemPrompt());
    messages = messages.map((m) => (m.id === pendingMsg.id ? { ...m, text: replyText, pending: false } : m));

    if (newSavedNotes.length) {
      const existingNoteTexts = new Set(notes.map((n) => n.text.toLowerCase()));
      const noteAdditions = newSavedNotes
        .filter((n) => n && !existingNoteTexts.has(n.toLowerCase()))
        .map((n) => ({ id: uid(), text: n }));
      if (noteAdditions.length) notes = [...notes, ...noteAdditions];
    }

    persistAll();
    sending = false;
    render();

    extractTraits(userText, replyText).then((newTraits) => {
      if (newTraits.length) {
        const existing = new Set(traits.map((t) => t.text.toLowerCase()));
        const additions = newTraits
          .filter((t) => !existing.has(t.toLowerCase()))
          .map((t) => ({ id: uid(), text: t, source: "auto" }));
        if (additions.length) {
          traits = [...traits, ...additions];
          persistAll();
          render();
        }
      }
    });
  } catch (e) {
    messages = messages.map((m) =>
      m.id === pendingMsg.id ? { ...m, text: "Something went wrong reaching Augustus. Try again?", pending: false } : m
    );
    sending = false;
    persistAll();
    render();
  }
}

function handleFeedback(msgId, kind) {
  const target = messages.find((m) => m.id === msgId);
  if (!target) return;
  if (kind === "up") {
    messages = messages.map((m) => (m.id === msgId ? { ...m, feedback: "up" } : m));
    persistAll();
    render();
    return;
  }
  pendingFeedbackId = msgId;
  render();
}

function submitDownvoteNote(note) {
  const trimmed = (note || "").trim();
  messages = messages.map((m) => (m.id === pendingFeedbackId ? { ...m, feedback: "down", note: trimmed } : m));
  if (trimmed) {
    traits = [...traits, { id: uid(), text: trimmed, source: "feedback" }];
  }
  pendingFeedbackId = null;
  persistAll();
  render();
}

// ---------- Init ----------

persistAll(); // checks storage availability up front
render();

// Register service worker for PWA installability (best-effort)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
