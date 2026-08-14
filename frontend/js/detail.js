/**
 * detail.js
 * ---------
 * Research Detail page: loads one paper, runs AI similarity/summary/gaps
 * analysis, and drives the PDF viewer + chat panel.
 *
 * FIX NOTES (added — these were missing and caused the page to show
 * only the static shell with every panel stuck on "Loading..."):
 *   - docId was referenced but never parsed from the URL — threw a
 *     ReferenceError on the very first line of initPage(), which
 *     silently killed everything after it.
 *   - renderPaperInfo, showError, switchTab, renderSimilarityBars,
 *     renderSimilarProjects, renderGapsList, sendChat, chatKey, and
 *     the PDF viewer helpers (renderPdfPage, updatePageInfo,
 *     pdfPrevPage, pdfNextPage, hidePdfViewer) were called by this
 *     file and by detail.html's onclick handlers, but never defined.
 *   - pdfDoc / pdfPage / pdfVisible were used but never declared.
 *
 * All DOM writes use textContent/createElement, never innerHTML with
 * data values — matches the XSS-safe pattern used across the rest of
 * the app (see browse.js, review.js, my-submissions.js).
 */

/* ── URL param ───────────────────────────────────────────────────────────── */
const docId = new URLSearchParams(window.location.search).get("id");

/* ── State ───────────────────────────────────────────────────────────────── */
let paperData    = null;
let researchId    = null;   // numeric id — needed for AI/PDF calls now
let chatHistory   = [];

/* PDF viewer state */
let pdfDoc     = null;
let pdfPage    = 1;
let pdfVisible = false;

async function initPage() {
  const navPromise = (async () => {
    try {
      const me = await apiMe();
      applyNav(me.role);
      const el = document.getElementById("avatarEl");
      const rp = document.getElementById("rolePill");
      if (el) el.textContent = (me.full_name || me.username).substring(0, 2).toUpperCase();
      if (rp) rp.textContent = me.role.charAt(0).toUpperCase() + me.role.slice(1);
    } catch {
      applyNav("guest");
    }
    document.body.style.visibility = "visible";
  })();

  if (!docId) {
    showError("No document ID specified.");
    await navPromise;
    return;
  }

  try {
    paperData  = await apiDocumentDetail(docId);
    researchId = paperData.id;   // numeric id, resolved from source_stem
    renderPaperInfo(paperData);
  } catch (e) {
    showError(`Could not load paper: ${e.message}`);
    await navPromise;
    return;
  }

  await navPromise;

  ["simBars", "summaryBox", "gapsBox"].forEach(id => {
    const el = document.getElementById(id);
    if (el && typeof bookLoaderHTML === "function") {
      el.innerHTML = `<div style="display:flex;justify-content:center;padding:30px 0;">${bookLoaderHTML(48)}</div>`;
    }
  });

  await Promise.all([
    runSimilarity(),
    runSummary(),
    runGaps(),
  ]);

  const badge = document.getElementById("analysisStatus");
  if (badge) {
    badge.textContent = "Complete";
    badge.className   = "badge badge-validated";
  }
}

/* ── Paper info / error rendering ───────────────────────────────────────── */

/**
 * Fills in the paper title, meta line, chips, and abstract from the
 * mapped research object returned by apiDocumentDetail().
 * @param {Object} p - mapped research object (see api.js _mapResearch)
 */
function renderPaperInfo(p) {
  const titleEl = document.getElementById("paperTitle");
  if (titleEl) titleEl.textContent = p.title || p.source || "Untitled";

  const metaEl = document.getElementById("paperMeta");
  if (metaEl) {
    const bits = [p.authors, p.department, p.year].filter(v => v && v !== "Unknown");
    metaEl.textContent = bits.join(" · ") || "No metadata available.";
  }

  const chipsEl = document.getElementById("metaChips");
  if (chipsEl) {
    chipsEl.innerHTML = "";
    const chipValues = [
      { label: p.department, cls: "meta-chip" },
      { label: p.year, cls: "meta-chip" },
      { label: p.status, cls: `badge badge-${p.status}` },
    ];
    chipValues.forEach(({ label, cls }) => {
      if (!label || label === "Unknown") return;
      const chip = document.createElement("span");
      chip.className   = cls;
      chip.textContent = label;
      chipsEl.appendChild(chip);
    });
  }

  const abstractEl = document.getElementById("abstractText");
  if (abstractEl) abstractEl.textContent = p.abstract || "No abstract provided.";
}

/**
 * Shows an error state in place of the paper title/abstract, and stops
 * the AI panels from spinning forever.
 * @param {string} msg
 */
function showError(msg) {
  const titleEl = document.getElementById("paperTitle");
  if (titleEl) titleEl.textContent = "Unable to load research";

  const metaEl = document.getElementById("paperMeta");
  if (metaEl) metaEl.textContent = "";

  const abstractEl = document.getElementById("abstractText");
  if (abstractEl) abstractEl.textContent = msg;

  ["simBars", "summaryBox", "gapsBox"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  });

  const badge = document.getElementById("analysisStatus");
  if (badge) {
    badge.textContent = "Unavailable";
    badge.className   = "badge badge-rejected";
  }

  toast(msg, "error");
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

const TAB_PANELS = {
  similarity: "tabSimilarity",
  summary:    "tabSummary",
  gaps:       "tabGaps",
};

/**
 * Switches the active AI-analysis tab.
 * @param {string} tab - one of "similarity" | "summary" | "gaps"
 * @param {HTMLElement} el - the tab button that was clicked
 */
function switchTab(tab, el) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  el.classList.add("active");

  Object.values(TAB_PANELS).forEach(panelId => {
    const panel = document.getElementById(panelId);
    if (panel) panel.style.display = "none";
  });

  const target = document.getElementById(TAB_PANELS[tab]);
  if (target) target.style.display = "block";
}

/* ── AI Analysis — now called with researchId, not a query string ─────── */

async function runSimilarity() {
  try {
    const data = await apiSimilarity(researchId);
    renderSimilarityBars(data.result);
    renderSimilarProjects(data.sources);
  } catch (e) {
    const el = document.getElementById("simBars");
    if (el) {
      el.textContent = "";
      const msg = document.createElement("div");
      msg.className   = "tab-error";
      msg.textContent = `⚠️ Similarity failed: ${e.message}`;
      el.appendChild(msg);
    }
    renderSimilarProjects([]);
  }
}

async function runSummary() {
  const box = document.getElementById("summaryBox");
  try {
    const data = await apiSummary(researchId);
    const clean = data.result.replace(/\*\*/g, "");
    if (box && typeof typeWriter === "function") {
      typeWriter(box, clean);
    } else if (box) {
      box.textContent = clean;
    }
  } catch (e) {
    if (box) {
      box.textContent = "";
      const msg = document.createElement("span");
      msg.className   = "tab-error";
      msg.textContent = `⚠️ Summary failed: ${e.message}`;
      box.appendChild(msg);
    }
  }
}

async function runGaps() {
  const box = document.getElementById("gapsBox");
  try {
    const data = await apiGaps(researchId);
    renderGapsList(data.result);
  } catch (e) {
    if (box) {
      box.textContent = "";
      const msg = document.createElement("span");
      msg.className   = "tab-error";
      msg.textContent = `⚠️ Gap analysis failed: ${e.message}`;
      box.appendChild(msg);
    }
  }
}

/* ── Similarity rendering ───────────────────────────────────────────────── */

const SIM_LEVEL_WIDTH = { HIGH: 90, MODERATE: 60, LOW: 30 };
const SIM_LEVEL_COLOR = {
  HIGH: "var(--success, #16a34a)",
  MODERATE: "var(--warning, #d97706)",
  LOW: "var(--muted, #9ca3af)",
};

/**
 * The Groq LLM returns free text (not JSON) for the similarity report,
 * roughly one block per matched study ending in "Similarity: HIGH/
 * MODERATE/LOW". This parses those blocks into bar data. If nothing
 * matches that shape (LLM phrased it differently), falls back to
 * showing the raw text so the tab is never left blank.
 *
 * @param {string} text - raw LLM output from apiSimilarity().result
 */
function renderSimilarityBars(text) {
  const container = document.getElementById("simBars");
  if (!container) return;
  container.innerHTML = "";

  if (!text || !text.trim()) {
    const empty = document.createElement("div");
    empty.className   = "tab-error";
    empty.textContent = "No similarity data available.";
    container.appendChild(empty);
    return;
  }

  const blocks = text
    .split(/\n(?=\s*\d+[\.\)]\s|\s*\*\*)/)
    .map(b => b.trim())
    .filter(Boolean);

  const items = [];
  blocks.forEach(block => {
    const levelMatch = block.match(/Similarity:\s*(HIGH|MODERATE|LOW)/i);
    if (!levelMatch) return;
    const level = levelMatch[1].toUpperCase();
    const firstLine = block
      .split("\n")[0]
      .replace(/^\s*\d+[\.\)]\s*/, "")
      .replace(/\*\*/g, "")
      .trim();
    const detail = block.replace(/Similarity:\s*(HIGH|MODERATE|LOW)/i, "").trim();
    items.push({ label: firstLine || "Study", level, detail });
  });

  if (items.length === 0) {
    // LLM didn't follow the expected format — show the raw text instead
    // of an empty tab.
    const pre = document.createElement("div");
    pre.style.cssText = "white-space:pre-wrap;font-size:0.84rem;line-height:1.6;";
    pre.textContent = text.replace(/\*\*/g, "");
    container.appendChild(pre);
    return;
  }

  items.forEach(item => {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:16px;";

    const labelRow = document.createElement("div");
    labelRow.style.cssText = "display:flex;justify-content:space-between;font-size:0.84rem;font-weight:600;margin-bottom:6px;";

    const labelEl = document.createElement("span");
    labelEl.textContent = item.label;

    const levelEl = document.createElement("span");
    levelEl.style.color = SIM_LEVEL_COLOR[item.level] || "var(--muted)";
    levelEl.textContent = item.level;

    labelRow.appendChild(labelEl);
    labelRow.appendChild(levelEl);

    const track = document.createElement("div");
    track.style.cssText = "background:var(--bg,#f0f0f0);border-radius:6px;height:8px;overflow:hidden;";

    const fill = document.createElement("div");
    fill.style.cssText = `height:100%;border-radius:6px;width:${SIM_LEVEL_WIDTH[item.level] || 50}%;background:${SIM_LEVEL_COLOR[item.level] || "var(--muted)"};`;

    track.appendChild(fill);

    const detailEl = document.createElement("div");
    detailEl.style.cssText = "font-size:0.78rem;color:var(--muted);margin-top:6px;line-height:1.5;";
    detailEl.textContent = item.detail;

    row.appendChild(labelRow);
    row.appendChild(track);
    row.appendChild(detailEl);
    container.appendChild(row);
  });
}

/**
 * Renders the structured (non-LLM-generated) source list into the
 * right-panel "Similar Projects" card.
 * @param {Array} sources - [{title, authors, year, college, pages}, ...]
 */
function renderSimilarProjects(sources) {
  const container = document.getElementById("similarProjects");
  if (!container) return;
  container.innerHTML = "";

  if (!sources || sources.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:var(--muted);font-size:0.8rem;";
    empty.textContent = "No similar projects found.";
    container.appendChild(empty);
    return;
  }

  sources.forEach(s => {
    const card = document.createElement("div");
    card.style.cssText = "padding:10px 0;border-bottom:1px solid var(--border,#eee);";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:600;font-size:0.82rem;margin-bottom:3px;";
    title.textContent = s.title || "Untitled";

    const meta = document.createElement("div");
    meta.style.cssText = "font-size:0.74rem;color:var(--muted);";
    const bits = [s.authors, s.year, s.college].filter(v => v && v !== "Unknown");
    meta.textContent = bits.join(" · ");

    card.appendChild(title);
    card.appendChild(meta);

    if (s.pages && s.pages.length) {
      const pages = document.createElement("div");
      pages.style.cssText = "font-size:0.72rem;color:var(--muted);margin-top:3px;";
      pages.textContent = `Pages: ${s.pages.join(", ")}`;
      card.appendChild(pages);
    }

    container.appendChild(card);
  });
}

/* ── Gaps rendering ──────────────────────────────────────────────────────── */

const GAP_URGENCY_COLOR = {
  HIGH: "var(--danger, #dc2626)",
  MEDIUM: "var(--warning, #d97706)",
  LOW: "var(--muted, #9ca3af)",
};

/**
 * Parses the LLM's free-text gap analysis (Gap/Recommendation/Urgency
 * triples) into cards. Falls back to raw text if the LLM didn't follow
 * the expected shape, so the tab is never left blank.
 * @param {string} text - raw LLM output from apiGaps().result
 */
function renderGapsList(text) {
  const container = document.getElementById("gapsBox");
  if (!container) return;
  container.innerHTML = "";

  if (!text || !text.trim()) {
    const empty = document.createElement("div");
    empty.className   = "tab-error";
    empty.textContent = "No research gap data available.";
    container.appendChild(empty);
    return;
  }

  const gapRegex = /Gap:\s*(.+?)\s*(?:\n|\r)+.*?Recommendation:\s*(.+?)\s*(?:\n|\r)+.*?Urgency:\s*(HIGH|MEDIUM|LOW)/gis;
  const items = [];
  let match;
  while ((match = gapRegex.exec(text)) !== null) {
    items.push({
      gap: match[1].replace(/\*\*/g, "").trim(),
      recommendation: match[2].replace(/\*\*/g, "").trim(),
      urgency: match[3].toUpperCase(),
    });
  }

  if (items.length === 0) {
    const pre = document.createElement("div");
    pre.style.cssText = "white-space:pre-wrap;font-size:0.84rem;line-height:1.6;";
    pre.textContent = text.replace(/\*\*/g, "");
    container.appendChild(pre);
    return;
  }

  items.forEach(item => {
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid var(--border,#eee);border-radius:8px;padding:12px 14px;margin-bottom:10px;";

    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px;";

    const gapText = document.createElement("div");
    gapText.style.cssText = "font-weight:600;font-size:0.84rem;line-height:1.4;";
    gapText.textContent = item.gap;

    const urgencyBadge = document.createElement("span");
    urgencyBadge.style.cssText = `flex-shrink:0;font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:10px;color:#fff;background:${GAP_URGENCY_COLOR[item.urgency] || "var(--muted)"};`;
    urgencyBadge.textContent = item.urgency;

    header.appendChild(gapText);
    header.appendChild(urgencyBadge);

    const rec = document.createElement("div");
    rec.style.cssText = "font-size:0.8rem;color:var(--muted);line-height:1.5;";
    rec.textContent = item.recommendation;

    card.appendChild(header);
    card.appendChild(rec);
    container.appendChild(card);
  });
}

/* ── Chat ────────────────────────────────────────────────────────────────── */

/**
 * Appends a chat bubble and returns the bubble element (so callers can
 * update its text later, e.g. to replace a "thinking..." placeholder).
 * @param {string} role - "user" | "bot"
 * @param {string} text
 * @returns {HTMLElement} the bubble element
 */
function appendChatMessage(role, text) {
  const log = document.getElementById("chatLog");
  if (!log) return document.createElement("div");

  const msg = document.createElement("div");
  msg.className = `chat-msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className   = "chat-bubble";
  bubble.textContent = text;

  msg.appendChild(bubble);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

/**
 * Enter sends the message, Shift+Enter inserts a newline.
 * @param {KeyboardEvent} e
 */
function chatKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

async function sendChat() {
  const input = document.getElementById("chatInput");
  if (!input) return;

  const question = input.value.trim();
  if (!question) return;

  input.value = "";
  appendChatMessage("user", question);
  chatHistory.push({ role: "user", content: question });

  const thinkingBubble = appendChatMessage("bot", "…");

  try {
    const data = await apiChat(question, chatHistory);
    thinkingBubble.textContent = data.result;
    chatHistory.push({ role: "assistant", content: data.result });
  } catch (e) {
    thinkingBubble.textContent = `⚠️ ${e.message}`;
  }
}

/* ── PDF viewer ──────────────────────────────────────────────────────────── */

async function revealPdfViewer() {
  const card    = document.getElementById("pdfViewerCard");
  const trigger = document.getElementById("pdfViewerTrigger");
  if (!card) return;

  card.style.display    = "block";
  if (trigger) trigger.style.display = "none";
  pdfVisible = true;

  if (pdfDoc) {
    renderPdfPage(pdfPage);
    return;
  }

  const errorEl = document.getElementById("pdfError");
  const canvas  = document.getElementById("pdfCanvas");
  if (errorEl) errorEl.style.display = "none";
  if (canvas)  canvas.style.display  = "block";

  try {
    const url = apiPdfUrl(docId);

    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF.js not loaded. Check the CDN script tag in detail.html.");
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    // httpHeaders carries the JWT bearer token — replaces the old
    // withCredentials:true cookie-based approach
    pdfDoc = await pdfjsLib.getDocument({ url, httpHeaders: apiAuthHeaderForPdf() }).promise;
    updatePageInfo();
    await renderPdfPage(1);

  } catch (e) {
    if (canvas)  canvas.style.display  = "none";
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent   = `Could not load PDF: ${e.message}`;
    }
    toast("PDF failed to load. The document may not be approved yet.", "error");
  }
}

/**
 * Renders a single page of the loaded PDF onto the canvas.
 * @param {number} num - 1-indexed page number
 */
async function renderPdfPage(num) {
  if (!pdfDoc) return;
  pdfPage = num;

  const canvas = document.getElementById("pdfCanvas");
  if (!canvas) return;

  try {
    const page     = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: 1.4 });
    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (e) {
    toast(`Could not render page ${num}: ${e.message}`, "error");
  }

  updatePageInfo();
}

function updatePageInfo() {
  const info    = document.getElementById("pdfPageInfo");
  const prevBtn = document.getElementById("pdfPrevBtn");
  const nextBtn = document.getElementById("pdfNextBtn");

  if (info) {
    info.textContent = pdfDoc ? `Page ${pdfPage} / ${pdfDoc.numPages}` : "Page — / —";
  }
  if (prevBtn) prevBtn.disabled = pdfPage <= 1;
  if (nextBtn) nextBtn.disabled = !pdfDoc || pdfPage >= pdfDoc.numPages;
}

function pdfPrevPage() {
  if (pdfPage > 1) renderPdfPage(pdfPage - 1);
}

function pdfNextPage() {
  if (pdfDoc && pdfPage < pdfDoc.numPages) renderPdfPage(pdfPage + 1);
}

function hidePdfViewer() {
  const card    = document.getElementById("pdfViewerCard");
  const trigger = document.getElementById("pdfViewerTrigger");
  if (card) card.style.display = "none";
  if (trigger) trigger.style.display = "block";
  pdfVisible = false;
}

/* ── Initialize ──────────────────────────────────────────────────────────── */
initPage();