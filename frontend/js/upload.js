/**
 * upload.js
 * ---------
 * Submit Research — single-step file upload with AI-extraction confirm modal.
 *
 * uploadInProgress guards against silent data loss: navigating away
 * mid-request doesn't cleanly cancel anything server-side (the backend
 * keeps running via asyncio.to_thread), it just kills the browser's
 * ability to see the result — so we warn before letting that happen.
 */

let selectedFile = null;
let currentPreviewId = null;
let uploadInProgress = false;


/* ── Navigation guard ───────────────────────────────────────────────── */

window.addEventListener("beforeunload", (e) => {
  if (uploadInProgress) {
    e.preventDefault();
    e.returnValue = ""; // required for the browser's native confirm dialog
  }
});


/* ── Page guard ─────────────────────────────────────────────────────── */

async function initPage() {
  let me;

  try {
    me = await apiMe();
  } catch {
    window.location.replace("index.html");
    return;
  }

  try {
    applyNav(me.role);
  } catch (e) {
    console.error("applyNav failed:", e);
  }

  document.body.style.visibility = "visible";
}

initPage();


/* ── File upload ────────────────────────────────────────────────────── */

function dragOver(e) {
  e.preventDefault();

  document
    .getElementById("dropZone")
    .classList.add("over");
}


function dragLeave() {
  document
    .getElementById("dropZone")
    .classList.remove("over");
}


function dropped(e) {
  e.preventDefault();

  dragLeave();

  const file = e.dataTransfer.files[0];

  if (file) {
    setFile(file);
  }
}


function fileChosen(e) {
  const file = e.target.files[0];

  if (file) {
    setFile(file);
  }
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

  document.getElementById("fileSize").textContent =
    (file.size / 1024 / 1024).toFixed(2) + " MB";

  document.getElementById("fileInfo").style.display = "flex";

  document.getElementById("dropZone").style.display = "none";
}


function clearFile() {
  selectedFile = null;

  document.getElementById("fileInfo").style.display = "none";

  document.getElementById("dropZone").style.display = "block";

  document.getElementById("fileInput").value = "";
}


/* ── Step 1: upload + AI extraction ─────────────────────────────────── */

async function submitPaper() {
  if (!selectedFile) {
    toast("Please select a PDF first.", "error");
    return;
  }

  const btn = document.getElementById("submitBtn");
  const status = document.getElementById("submitStatus");

  btn.disabled = true;
  btn.textContent = "Reading document...";

  status.style.display = "block";

  status.style.cssText =
    "display:block;padding:12px 14px;border-radius:7px;" +
    "font-size:0.84rem;color:var(--muted);" +
    "background:var(--bg);";

  status.textContent =
    "⏳ Extracting metadata from your PDF... please don't close or navigate away.";

  uploadInProgress = true;

  const emptyFormData = {
    title: "",
    department: "",
    year: "",
    members: "",
    abstract: ""
  };

  try {
    const preview = await apiIngestPreview(
      selectedFile,
      emptyFormData
    );

    currentPreviewId = preview.preview_id;

    status.style.display = "none";

    btn.style.display = "none";

    showMetaModal(preview.ai_metadata);

  } catch (e) {
    status.style.cssText =
      "display:block;padding:12px 14px;border-radius:7px;" +
      "font-size:0.84rem;color:var(--danger);" +
      "background:#fef2f2;border:1px solid #fca5a5;";

    status.textContent = `⚠️ ${e.message}`;

    btn.disabled = false;

    btn.textContent = "Submit Research →";

  } finally {
    uploadInProgress = false;
  }
}


/* ── Modal: show AI-extracted metadata ──────────────────────────────── */

function showMetaModal(meta) {
  document.getElementById("metaTitle").textContent =
    meta.title || "—";

  document.getElementById("metaAuthors").textContent =
    meta.authors || "—";

  document.getElementById("metaYear").textContent =
    meta.year || "—";

  document.getElementById("metaCollege").textContent =
    meta.college || "—";

  document.getElementById("metaAbstract").textContent =
    meta.abstract || "—";

  document.getElementById("metaKeywords").textContent =
    meta.keywords || "—";

  document.getElementById("metaModal").style.display = "flex";
}


function cancelMetaConfirm() {
  document.getElementById("metaModal").style.display = "none";

  currentPreviewId = null;
}


/* ── Step 2: student confirms → actually save to DB ─────────────────── */

async function confirmMetaAndSubmit() {
  if (!currentPreviewId) {
    toast("Preview expired — please re-upload.", "error");
    return;
  }

  const btn = document.getElementById("confirmMetaBtn");

  btn.disabled = true;

  btn.textContent = "Submitting...";

  const status = document.getElementById("submitStatus");

  status.style.display = "block";

  status.style.cssText =
    "display:block;padding:12px 14px;border-radius:7px;" +
    "font-size:0.84rem;color:var(--muted);" +
    "background:var(--bg);";

  status.textContent =
    "⏳ Uploading and indexing document into repository... please don't close or navigate away.";

  uploadInProgress = true;

  try {
    const result = await apiIngestConfirm(
      currentPreviewId,
      {}
    );

    document.getElementById("metaModal").style.display = "none";

    status.style.cssText =
      "display:block;padding:12px 14px;border-radius:7px;" +
      "font-size:0.84rem;color:var(--success);" +
      "background:#f0fdf4;border:1px solid #86efac;";

    /*
     * Keep the owner's newer implementation here.
     *
     * The previous/stashed version used finalValues.title,
     * but finalValues no longer exists in this single-step
     * upload workflow.
     */
    status.textContent =
      `✅ "${result.metadata?.title || selectedFile.name}" submitted — ` +
      `${result.chunks} chunks indexed. Pending librarian review.`;

    toast(
      "Research submitted successfully!",
      "success"
    );

    setTimeout(() => {
      window.location.href = "my-submissions.html";
    }, 2500);

  } catch (e) {
    status.style.cssText =
      "display:block;padding:12px 14px;border-radius:7px;" +
      "font-size:0.84rem;color:var(--danger);" +
      "background:#fef2f2;border:1px solid #fca5a5;";

    status.textContent =
      `⚠️ Submission failed: ${e.message}`;

    btn.disabled = false;

    btn.textContent = "Confirm & Submit →";

  } finally {
    uploadInProgress = false;
  }
}