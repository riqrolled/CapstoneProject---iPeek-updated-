/**
 * api.js
 * ------
 * ADAPTER LAYER for the new FastAPI/JWT backend.
 *
 * Every exported function keeps the EXACT same name and return shape as
 * the old Flask session-cookie backend. Internally, each one translates
 * to the new endpoint paths, attaches a JWT bearer token instead of a
 * session cookie, and maps new field names (fullname, authors, year int,
 * etc.) back onto the old field names every page script already expects
 * (full_name, lead_researcher, school_year string, etc.).
 *
 * This means browse.js, upload.js, my-submissions.js, profile.js, and
 * login.js need ZERO changes — they only ever talk to api.js's stable
 * interface, never the raw backend directly.
 *
 * TOKEN STORAGE: JWT stored in sessionStorage under "ipeek_token".
 * Cleared on logout via sessionStorage.clear() (already done in every
 * page's inline logout() script).
 */
/**
 * api.js
 * ------
 * ADAPTER LAYER for the FastAPI/JWT backend.
 *
 * Every exported function keeps a stable name/shape so page scripts
 * never talk to the raw backend directly — only to this file.
 *
 * TOKEN STORAGE: JWT stored in sessionStorage under "ipeek_token".
 * Cleared on logout via sessionStorage.clear().
 *
 * ADDED: apiRequestOtp / apiVerifyOtp / apiRegister — the three calls
 * behind the new registration flow in login.js. Role is never sent by
 * the client in apiRegister(); the backend derives it from the email
 * domain. See services/otp_service.py::determine_role_from_email().
 */

const API_BASE = "http://localhost:8000";

/* ── Nav link sets ──────────────────────────────────────────────────── */
const NAV_LINKS = {
  student: [
    { href: "browse.html",  label: "Browse Research",  id: "browse"  },
    { href: "upload.html",  label: "Submit Proposal",  id: "upload"  },
    { href: "my-submissions.html", label: "My Submissions",    id: "my-submissions" },
  ],
  faculty: [
    { href: "browse.html",  label: "Browse Research",  id: "browse"  },
    { href: "upload.html",  label: "Submit Proposal",  id: "upload"  },
    { href: "my-submissions.html", label: "My Submissions",    id: "my-submissions" },
  ],
  librarian: [
    { href: "dashboard.html", label: "Dashboard",     id: "dashboard" },
    { href: "review.html",    label: "Review Queue",  id: "review"    },
    { href: "browse.html",    label: "Browse",        id: "browse"    },
    { href: "upload.html",    label: "Upload",        id: "upload"    },
  ],
};

function applyNav(role) {
  const container = document.querySelector(".nav-links");
  if (!container) return;
  const links   = NAV_LINKS[role] || NAV_LINKS.student;
  const current = window.location.pathname.split("/").pop();

  const ul = document.createElement("ul");
  ul.className = "pill-list";
  links.forEach(({ href, label }) => {
    const li = document.createElement("li");
    const a  = document.createElement("a");
    a.className   = `pill${href === current ? " is-active" : ""}`;
    a.href        = href;
    a.textContent = label;
    li.appendChild(a);
    ul.appendChild(li);
  });
  container.innerHTML = "";
  container.appendChild(ul);

  if (typeof initPillNav === "function") initPillNav(container);
  if (typeof applyProfilePill === "function") applyProfilePill();
}

function applyProfilePill() {
  const navRight = document.querySelector(".nav-right");
  if (!navRight) return;
  const existingAvatar = document.getElementById("avatarEl");
  const existingRole   = document.getElementById("rolePill");
  if (!existingAvatar || !existingRole) return;
  if (existingAvatar.closest(".profile-pill")) return;

  const wrapper = document.createElement("a");
  wrapper.className = "profile-pill";
  wrapper.href = "profile.html";
  navRight.insertBefore(wrapper, existingAvatar);
  wrapper.appendChild(existingAvatar);
  wrapper.appendChild(existingRole);
}

/* ── Token helpers ───────────────────────────────────────────────────── */

function _getToken() {
  return sessionStorage.getItem("ipeek_token");
}

function _authHeaders() {
  const token = _getToken();
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

function apiAuthHeaderForPdf() {
  return _authHeaders();
}

/* ── Auth ────────────────────────────────────────────────────────────── */

async function apiLogin(username, password) {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const r = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Login failed.");

  sessionStorage.setItem("ipeek_token", d.access_token);
  return { success: true, role: d.role, full_name: d.fullname };
}

async function apiLogout() {
  return { success: true };
}

async function apiMe() {
  const r = await fetch(`${API_BASE}/auth/me`, { headers: _authHeaders() });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Not logged in.");
  return {
    user_id:   d.id,
    username:  d.username,
    role:      d.role,
    full_name: d.fullname,
    email:     d.email,
    contact:   d.contact,
    department: d.department,
  };
}

async function apiUpdateProfile(fullName, email, contact) {
  const r = await fetch(`${API_BASE}/auth/me`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body: JSON.stringify({ fullname: fullName, email, contact }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Failed to update profile.");
  return {
    user_id: d.id, username: d.username, role: d.role,
    full_name: d.fullname, email: d.email, contact: d.contact, department: d.department,
  };
}

async function apiUpdatePassword(currentPassword, newPassword) {
  const r = await fetch(`${API_BASE}/auth/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Failed to update password.");
  return d;
}

/* ── Registration (OTP flow) ────────────────────────────────────────── */
/* No auth headers needed on any of these three — the user isn't logged
   in yet during registration. Note apiRegister() never sends a "role"
   field: the server derives it from the email domain, and would ignore
   a client-supplied role even if one were sent. */

async function apiRequestOtp(email) {
  const r = await fetch(`${API_BASE}/auth/register/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Could not send verification code.");
  return d;
}

async function apiVerifyOtp(email, code) {
  const r = await fetch(`${API_BASE}/auth/register/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Verification failed.");
  return d;
}

async function apiRegister({ email, password, fullname, department }) {
  const r = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullname, department: department || null }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Registration failed.");
  return d;
}

/* ── Ingest (upload preview/confirm) ────────────────────────────────── */

async function apiIngestPreview(file, formData) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("title", formData.title || "");
  fd.append("department", formData.department || "");
  fd.append("year", formData.year || "");
  fd.append("members", formData.members || "");
  fd.append("abstract", formData.abstract || "");

  const r = await fetch(`${API_BASE}/repository/upload/preview`, {
    method: "POST",
    headers: _authHeaders(),
    body: fd,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Preview failed.");
  return d;
}

async function apiIngestConfirm(previewId, finalValues) {
  const r = await fetch(`${API_BASE}/repository/upload/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body: JSON.stringify({ preview_id: previewId, final_values: finalValues }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Submission failed.");
  return d;
}

/* ── RAG Analysis ────────────────────────────────────────────────────── */

async function apiSimilarity(researchId) {
  const r = await fetch(`${API_BASE}/ai/${researchId}/similarity`, {
    method: "POST", headers: _authHeaders(),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Similarity failed.");
  return d;
}

async function apiSummary(researchId) {
  const r = await fetch(`${API_BASE}/ai/${researchId}/summary`, {
    method: "POST", headers: _authHeaders(),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Summary failed.");
  return d;
}

async function apiGaps(researchId) {
  const r = await fetch(`${API_BASE}/ai/${researchId}/gaps`, {
    method: "POST", headers: _authHeaders(),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Gap analysis failed.");
  return d;
}

async function apiChat(question, history = []) {
  const r = await fetch(`${API_BASE}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body: JSON.stringify({ question, history }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Chat failed.");
  return d;
}

/* ── Repository Data ─────────────────────────────────────────────────── */

function _mapResearch(item) {
  return {
    id:               item.id,
    title:            item.title,
    authors:          item.authors,
    lead_researcher:  item.authors,
    year:             item.year ? String(item.year) : "Unknown",
    school_year:      item.year ? String(item.year) : "Unknown",
    college:          item.department,
    department:       item.department,
    keywords:         "",
    abstract:         item.abstract || "",
    source:           item.source_stem,
    source_stem:      item.source_stem,
    status:           item.status,
    feedback:         item.feedback_note,
    submitted_at:     item.created_at,
  };
}

async function apiDocuments() {
  const r = await fetch(`${API_BASE}/repository/browse`, { headers: _authHeaders() });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Failed to load documents.");
  return { documents: d.map(_mapResearch) };
}

async function apiDocumentDetail(source) {
  const r = await fetch(`${API_BASE}/repository/${encodeURIComponent(source)}/detail`, {
    headers: _authHeaders(),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Document not found.");
  return _mapResearch(d);
}

async function apiStatus() {
  return { status: "ok", chunks_indexed: 0, message: "" };
}

function apiPdfUrl(source) {
  return `${API_BASE}/repository/${encodeURIComponent(source)}/pdf`;
}

async function apiValidateResearch(researchId, action, comments) {
  const r = await fetch(`${API_BASE}/admin/repository/${researchId}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body: JSON.stringify({ approve: action === "validated", feedback_message: comments || null }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Failed to record decision.");
  return d;
}

async function apiDeletePaper(id) {
  const r = await fetch(`${API_BASE}/admin/repository/${id}`, {
    method: "DELETE", headers: _authHeaders(),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Delete failed.");
  return { success: true, message: d.detail };
}

async function apiSubmissions() {
  const r = await fetch(`${API_BASE}/admin/repository`, { headers: _authHeaders() });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Failed to fetch submissions.");
  return { submissions: d.map(_mapResearch) };
}

async function apiMySubmissions() {
  const r = await fetch(`${API_BASE}/repository/my-uploads`, { headers: _authHeaders() });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "Failed to fetch your submissions.");
  return { submissions: d.map(_mapResearch) };
}

/* ── Toast helper ────────────────────────────────────────────────────── */

function toast(msg, type = "info", duration = 3500) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const el       = document.createElement("div");
  el.className   = `toast ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), duration);
}