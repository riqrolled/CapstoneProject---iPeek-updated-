/* ── State ───────────────────────────────────────────────────────────────── */
let paperData    = null;
let researchId   = null;   // numeric id — needed for AI/PDF calls now
let chatHistory  = [];

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