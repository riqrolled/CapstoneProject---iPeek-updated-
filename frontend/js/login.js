/**
 * login.js
 * --------
 * Handles the login page:
 *  - Role tab switching (Student / Librarian) — pre-fills the expected
 *    username for the demo accounts, but does NOT itself grant access;
 *    the actual check happens server-side via apiLogin()
 *  - Calls POST /api/auth/login (real check against the users table)
 *  - On success, Flask sets a session cookie — that cookie, not
 *    sessionStorage, is what protected routes (approve/review) check
 *  - sessionStorage is still set too, but ONLY for display purposes
 *    (showing the name/role in the navbar) — it has no security value
 *    and is never trusted by the backend
 *
 * DEMO ACCOUNTS (seeded server-side, see backend/database/auth_repo.py):
 *   username: librarian / password: admin    → role: librarian
 *   username: student   / password: student  → role: student
 */

/* Currently selected role tab — used only to pre-fill the username field
   as a demo convenience, NOT to grant any access by itself */
let role = "student";

/**
 * Updates the active role tab and pre-fills the username field with
 * the matching demo account's username, so testers don't have to
 * remember the exact credentials. Password is NOT pre-filled.
 *
 * @param {string} r  - Role key: 'student' | 'librarian'
 * @param {HTMLElement} el - The tab button that was clicked
 */
function setRole(r, el) {
  role = r;

  document.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");

  const map = {
    student:   { lbl: "Username", ph: "student",   prefill: "student"   },
    librarian: { lbl: "Username", ph: "librarian", prefill: "librarian" },
  };

  document.getElementById("idLbl").textContent  = map[r].lbl;
  document.getElementById("uid").placeholder    = map[r].ph;
  document.getElementById("uid").value          = map[r].prefill;
}

/**
 * Submits credentials to the real backend auth route.
 * On success: stores display info in sessionStorage (name/role shown
 * in navbars across pages) and redirects based on the REAL role the
 * server returned — not the tab the user happened to have selected.
 * This matters: if someone selects the "Librarian" tab but types the
 * student account's credentials, they get redirected as a student,
 * because the server's answer is authoritative, not the UI tab.
 */
async function login() {
  const uid = document.getElementById("uid").value.trim();
  const pwd = document.getElementById("pwd").value.trim();

  if (!uid || !pwd) {
    showErr("Please enter your username and password.");
    return;
  }

  const btn = document.querySelector(".btn-sign");
  btn.disabled    = true;
  btn.textContent = "Signing in...";

  try {
    const result = await apiLogin(uid, pwd);

    // sessionStorage here is DISPLAY-ONLY — used by dashboard.js, review.js,
    // etc. to show "Hi, Demo Librarian" in the navbar. It carries no
    // authority: every protected backend route checks the real Flask
    // session cookie via login_required(), not this value.
    sessionStorage.setItem("role", result.role);
    sessionStorage.setItem("uid",  result.full_name || uid);

    const dest = {
      student:   "browse.html",
      librarian: "dashboard.html",
      admin:     "dashboard.html",
    };

    window.location.href = dest[result.role] || "browse.html";

  } catch (e) {
    showErr(e.message || "Invalid credentials.");
    btn.disabled    = false;
    btn.textContent = "Sign In to Repository";
  }
}

/**
 * Shows an error message inside the red error box.
 * @param {string} msg - Error text to display
 */
function showErr(msg) {
  const el = document.getElementById("err");
  el.textContent    = msg;
  el.style.display  = "block";
}