/**
 * upload.js
 * ---------
 * Submit Research multi-step form.
 * Accessible by any logged-in user (students submit, librarians can too).
 *
 * TWO-PHASE SUBMIT (metadata discrepancy checker):
 *   1. Preview  — stages the file, AI extracts its own metadata, compares
 *      it against what the student typed (title, department, members).
 *      Nothing is saved yet.
 *   2. If no discrepancies found → auto-confirms immediately, no extra click.
 *      If discrepancies found → shows a "Your entry" vs "PDF detected" choice
 *      per flagged field, waits for the student, THEN confirms with their
 *      final decisions.
 */

let currentStep  = 1;
let selectedFile = null;
let currentPreviewId = null;
let currentWarnings  = [];

/* ── Page guard ──────────────────────────────────────────────────────────── */

async function initPage() {
  let me;
  try {
    me = await apiMe();
  } catch {
    window.location.replace("index.html");
    return;
  }

  // apiMe() succeeded — from here on, any error should NOT log the user out
  try {
    applyNav(me.role);
  } catch (e) {
    console.error("applyNav failed:", e);
  }

  document.body.style.visibility = "visible";
}
initPage();

/* ── Step navigation ─────────────────────────────────────────────────────── */

function goStep(step) {
  if (step > currentStep && !validateStep(currentStep)) return;

  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById(`step${i}`);
    el.classList.remove("active", "done");
    if (i < step)  el.classList.add("done");
    if (i === step) el.classList.add("active");
  }

  for (let i = 1; i <= 3; i++) {
    document.getElementById(`panel${i}`).style.display = i === step ? "block" : "none";
  }

  if (step === 3) populateReview();
  currentStep = step;
}

function validateStep(step) {
  if (step === 1 && !document.getElementById("resTitle").value.trim()) {
    toast("Please enter a research title.", "error");
    return false;
  }
  if (step === 2 && !selectedFile) {
    toast("Please upload a PDF document before continuing.", "error");
    return false;
  }
  return true;
}

function populateReview() {
  document.getElementById("reviewTitle").textContent   = document.getElementById("resTitle").value   || "—";
  document.getElementById("reviewDept").textContent    = document.getElementById("resDept").value    || "—";
  document.getElementById("reviewMembers").textContent = document.getElementById("resMembers").value || "—";
  document.getElementById("reviewFile").textContent    = selectedFile ? selectedFile.name : "No file selected";
}

/* ── File upload ─────────────────────────────────────────────────────────── */

function dragOver(e) {
  e.preventDefault();
  document.getElementById("dropZone").classList.add("over");
}

function dragLeave() {
  document.getElementById("dropZone").classList.remove("over");
}

function dropped(e) {
  e.preventDefault();
  dragLeave();
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
}

function fileChosen(e) {
  const file = e.target.files[0];
  if (file) setFile(file);
}

function setFile(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    toast("Only PDF files are accepted.", "error");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("File exceeds the 25MB limit.", "error");
    return;
  }

  selectedFile = file;
  document.getElementById("fileName").textContent = file.name;
  document.getElementById("fileSize").textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";
  document.getElementById("fileInfo").style.display = "flex";
  document.getElementById("dropZone").style.display  = "none";
}

function clearFile() {
  selectedFile = null;
  document.getElementById("fileInfo").style.display = "none";
  document.getElementById("dropZone").style.display  = "block";
  document.getElementById("fileInput").value          = "";
}

/* ── Submit — Phase 1: preview ──────────────────────────────────────────── */

function gatherFormData() {
  return {
    title:      document.getElementById("resTitle").value.trim(),
    department: document.getElementById("resDept").value,
    year:       document.getElementById("resYear").value.trim(),
    members:    document.getElementById("resMembers").value.trim(),
    abstract:   document.getElementById("resAbstract").value.trim(),
  };
}

async function submitPaper() {
  if (!selectedFile) { toast("No PDF selected.", "error"); return; }

  const btn    = document.getElementById("submitBtn");
  const status = document.getElementById("submitStatus");

  btn.disabled    = true;
  btn.textContent = "Checking submission...";
  status.style.display = "block";
  status.className   = "";
  status.style.cssText = "display:block;padding:12px 14px;border-radius:7px;font-size:0.84rem;color:var(--muted);background:var(--bg);";
  status.textContent = "⏳ Reading your document and checking for discrepancies...";

  document.getElementById("discrepancyPanel").style.display = "none";
  document.getElementById("discrepancyPanel").innerHTML = "";

  const formData = gatherFormData();

  try {
    const preview = await apiIngestPreview(selectedFile, formData);
    currentPreviewId = preview.preview_id;
    currentWarnings  = preview.warnings || [];

    if (!preview.has_warnings) {
      // No conflicts — proceed straight to confirm, no extra click needed
      await confirmSubmission(formData);
      return;
    }

    // Show the discrepancy panel and wait for the student's choices
    renderDiscrepancyPanel(currentWarnings, formData);
    status.style.display = "none";
    btn.disabled    = false;
    btn.textContent = "Submit Research →";

  } catch (e) {
    status.style.cssText = "display:block;padding:12px 14px;border-radius:7px;font-size:0.84rem;color:var(--danger);background:#fef2f2;border:1px solid #fca5a5;";
    status.textContent   = `⚠️ ${e.message}`;
    btn.disabled    = false;
    btn.textContent = "Submit Research →";
  }
}

/* ── Discrepancy panel ───────────────────────────────────────────────────── */

/**
 * Renders a card per flagged field, letting the student choose between
 * what they typed and what the AI found in the PDF. All content set via
 * textContent/createElement — XSS safe, matches the pattern used
 * throughout the rest of the app.
 *
 * @param {Array} warnings - [{ field, label, user_value, ai_value }, ...]
 * @param {Object} formData - original form values, used as the default choice
 */
function renderDiscrepancyPanel(warnings, formData) {
  const panel = document.getElementById("discrepancyPanel");
  panel.innerHTML = "";
  panel.style.display = "block";

  const heading = document.createElement("div");
  heading.style.cssText = "font-weight:700;font-size:0.88rem;margin-bottom:4px;color:var(--warning);";
  heading.textContent = "⚠️ We noticed some differences from what's in the PDF";

  const sub = document.createElement("div");
  sub.style.cssText = "font-size:0.8rem;color:var(--muted);margin-bottom:14px;";
  sub.textContent = "Pick which value to keep for each field below, then submit again.";

  panel.appendChild(heading);
  panel.appendChild(sub);

  /* Tracks the student's choice per field: "mine" or "ai" */
  const choices = {};
  warnings.forEach(w => { choices[w.field] = "mine"; });

  warnings.forEach(w => {
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--bg);";

    const label = document.createElement("div");
    label.style.cssText = "font-weight:700;font-size:0.82rem;margin-bottom:8px;";
    label.textContent = w.label;

    const optRow = document.createElement("div");
    optRow.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    const mineOpt = document.createElement("label");
    mineOpt.style.cssText = "display:flex;align-items:flex-start;gap:8px;font-size:0.82rem;cursor:pointer;";
    const mineRadio = document.createElement("input");
    mineRadio.type = "radio";
    mineRadio.name = `choice_${w.field}`;
    mineRadio.checked = true;
    mineRadio.addEventListener("change", () => { choices[w.field] = "mine"; });
    const mineText = document.createElement("span");
    mineText.innerHTML = ""; // never use innerHTML with data — build with textContent instead
    const mineStrong = document.createElement("strong");
    mineStrong.textContent = "Your entry: ";
    const mineVal = document.createElement("span");
    mineVal.textContent = w.user_value;
    mineText.appendChild(mineStrong);
    mineText.appendChild(mineVal);
    mineOpt.appendChild(mineRadio);
    mineOpt.appendChild(mineText);

    const aiOpt = document.createElement("label");
    aiOpt.style.cssText = "display:flex;align-items:flex-start;gap:8px;font-size:0.82rem;cursor:pointer;";
    const aiRadio = document.createElement("input");
    aiRadio.type = "radio";
    aiRadio.name = `choice_${w.field}`;
    aiRadio.addEventListener("change", () => { choices[w.field] = "ai"; });
    const aiText = document.createElement("span");
    const aiStrong = document.createElement("strong");
    aiStrong.textContent = "PDF detected: ";
    const aiVal = document.createElement("span");
    aiVal.textContent = w.ai_value;
    aiText.appendChild(aiStrong);
    aiText.appendChild(aiVal);
    aiOpt.appendChild(aiRadio);
    aiOpt.appendChild(aiText);

    optRow.appendChild(mineOpt);
    optRow.appendChild(aiOpt);
    card.appendChild(label);
    card.appendChild(optRow);
    panel.appendChild(card);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-accent btn-lg";
  confirmBtn.textContent = "Confirm & Submit →";
  confirmBtn.style.marginTop = "6px";
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Submitting...";

    /* Build final values: student's choice per flagged field, their
       original entry for everything else */
    const finalValues = { ...formData };
    warnings.forEach(w => {
      if (choices[w.field] === "ai") {
        finalValues[w.field] = w.ai_value;
      }
    });

    try {
      await confirmSubmission(finalValues);
    } catch (e) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirm & Submit →";
    }
  });

  panel.appendChild(confirmBtn);
}

/* ── Submit — Phase 2: confirm ──────────────────────────────────────────── */

async function confirmSubmission(finalValues) {
  const status = document.getElementById("submitStatus");
  status.style.display = "block";
  status.style.cssText = "display:block;padding:12px 14px;border-radius:7px;font-size:0.84rem;color:var(--muted);background:var(--bg);";
  status.textContent = "⏳ Uploading and indexing document into repository...";

  try {
    const result = await apiIngestConfirm(currentPreviewId, finalValues);

    status.style.cssText = "display:block;padding:12px 14px;border-radius:7px;font-size:0.84rem;color:var(--success);background:#f0fdf4;border:1px solid #86efac;";
    status.textContent   = `✅ "${result.metadata?.title || finalValues.title}" submitted — ${result.chunks} chunks indexed. Pending librarian review.`;

    document.getElementById("discrepancyPanel").style.display = "none";

    toast("Research submitted successfully!", "success");
    setTimeout(() => { window.location.href = "browse.html"; }, 2500);

  } catch (e) {
    status.style.cssText = "display:block;padding:12px 14px;border-radius:7px;font-size:0.84rem;color:var(--danger);background:#fef2f2;border:1px solid #fca5a5;";
    status.textContent   = `⚠️ Submission failed: ${e.message}`;
    throw e; // let the caller reset its own button state
  }
}

function saveDraft() { toast("Draft saved locally.", "info"); }