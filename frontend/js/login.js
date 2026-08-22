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

 */

/**
 * login.js
 * --------
 * Handles the login page: sign in, and the two-step registration flow
 * (details -> OTP verification -> account created).
 *
 * IMPORTANT: role is NOT chosen by the user anywhere in this file.
 * It's derived entirely server-side from the institutional email
 * domain (@students.isatu.edu.ph -> student, @isatu.edu.ph -> librarian
 * or faculty depending on the LIBRARIAN_EMAILS allowlist). See
 * backend: services/otp_service.py::determine_role_from_email().
 * There is intentionally no role selector in this UI — trusting a
 * client-supplied role was the original security gap this replaces.
 */

let pendingEmail        = null; // set once OTP has been requested
let pendingRegistration = null; // holds form data between step 1 and step 2

/* ── Panel switching ─────────────────────────────────────────────────── */

function showLogin() {
  document.getElementById("loginPanel").style.display    = "block";
  document.getElementById("registerPanel").style.display = "none";
  document.getElementById("otpPanel").style.display       = "none";
}

function showRegister() {
  document.getElementById("loginPanel").style.display    = "none";
  document.getElementById("registerPanel").style.display = "block";
  document.getElementById("otpPanel").style.display       = "none";
}

function showOtpStep(email) {
  document.getElementById("loginPanel").style.display    = "none";
  document.getElementById("registerPanel").style.display = "none";
  document.getElementById("otpPanel").style.display       = "block";
  document.getElementById("otpEmailDisplay").textContent  = email;
}

/* ── Sign in ─────────────────────────────────────────────────────────── */

/**
 * Submits credentials to the backend. Redirect destination is based
 * entirely on the REAL role the server returns in the response — there
 * is no client-side role choice to be inconsistent with.
 */
async function login() {
  const uid = document.getElementById("loginUid").value.trim();
  const pwd = document.getElementById("loginPwd").value.trim();

  if (!uid || !pwd) {
    showErr("loginErr", "Please enter your email and password.");
    return;
  }

  const btn = document.querySelector("#loginPanel .btn-sign");
  btn.disabled    = true;
  btn.textContent = "Signing in...";

  try {
    const result = await apiLogin(uid, pwd);

    // Display-only — carries no authority. Every protected backend
    // route checks the real JWT via require_role(), not this value.
    sessionStorage.setItem("role", result.role);
    sessionStorage.setItem("uid",  result.full_name || uid);

    const dest = {
      student:   "browse.html",
      faculty:   "browse.html",
      librarian: "dashboard.html",
    };

    window.location.href = dest[result.role] || "browse.html";

  } catch (e) {
    showErr("loginErr", e.message || "Invalid credentials.");
    btn.disabled    = false;
    btn.textContent = "Sign In to Repository";
  }
}

/* ── Register — Step 1: collect details, request OTP ─────────────────── */

async function sendOtp() {

  console.log("========== SEND OTP START ==========");

  const fullname = document.getElementById("regFullname").value.trim();
  const email    = document.getElementById("regEmail").value.trim();
  const dept     = document.getElementById("regDept").value;
  const pwd      = document.getElementById("regPwd").value;
  const pwd2     = document.getElementById("regPwd2").value;

  console.log("fullname:", fullname);
  console.log("email:", email);
  console.log("dept:", dept);
  console.log("password length:", pwd.length);
  console.log("password confirmation length:", pwd2.length);


  // ------------------------------------------------------------
  // VALIDATION
  // ------------------------------------------------------------

  if (!fullname || !email || !pwd) {

    console.log("STOPPED: missing required field");

    showErr(
      "regErr",
      "Please fill in all required fields."
    );

    return;
  }


  if (pwd.length < 8) {

    console.log("STOPPED: password too short");

    showErr(
      "regErr",
      "Password must be at least 8 characters."
    );

    return;
  }


  if (pwd !== pwd2) {

    console.log("STOPPED: passwords don't match");

    showErr(
      "regErr",
      "Passwords do not match."
    );

    return;
  }


  console.log("========== VALIDATION PASSED ==========");


  // ------------------------------------------------------------
  // STORE REGISTRATION DATA
  // ------------------------------------------------------------

  pendingRegistration = {
    fullname: fullname,
    email: email,
    department: dept || null,
    password: pwd
  };

  pendingEmail = email;

  console.log(
    "pendingRegistration:",
    pendingRegistration
  );

  console.log(
    "pendingEmail:",
    pendingEmail
  );


  // ------------------------------------------------------------
  // BUTTON
  // ------------------------------------------------------------

  const btn =
    document.getElementById("sendCodeBtn");

  console.log(
    "Button found:",
    btn
  );


  btn.disabled = true;

  btn.textContent = "Sending code...";


  console.log(
    "========== ABOUT TO CALL apiRequestOtp =========="
  );

  console.log(
    "Email being sent:",
    email
  );


  // ------------------------------------------------------------
  // OTP REQUEST
  // ------------------------------------------------------------

  try {

    console.log(
      "Calling apiRequestOtp NOW..."
    );

    const result =
      await apiRequestOtp(email);

    console.log(
      "========== API REQUEST SUCCESS =========="
    );

    console.log(
      "Backend response:",
      result
    );


    pendingEmail = email;

    console.log(
      "Calling showOtpStep()..."
    );

    showOtpStep(email);

    console.log(
      "========== OTP PANEL SHOULD NOW BE VISIBLE =========="
    );

  }

  catch (e) {

    console.error(
      "========== OTP REQUEST FAILED =========="
    );

    console.error(e);

    showErr(
      "regErr",
      e.message ||
      "Could not send verification code."
    );

  }

  finally {

    console.log(
      "========== SEND OTP FINALLY =========="
    );

    btn.disabled = false;

    btn.textContent =
      "Send Verification Code";

  }

}

/* ── Register — Step 2: verify OTP, then create the account ─────────── */

async function verifyAndRegister() {
  const code = document.getElementById("otpCode").value.trim();
  const btn = document.getElementById("verifyBtn");

  if (!pendingEmail || !pendingRegistration) {
    showErr("otpErr", "Your registration session expired. Please request a new code.");
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    showErr("otpErr", "Please enter the 6-digit verification code.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verifying...";

  try {
    await apiVerifyOtp(pendingEmail, code);
    await apiRegister(pendingRegistration);

    const registeredEmail = pendingEmail;
    pendingEmail = null;
    pendingRegistration = null;
    document.getElementById("otpCode").value = "";
    showLogin();
    showErr("loginErr", `Account created for ${registeredEmail}. You can now sign in.`);
  } catch (e) {
    showErr("otpErr", e.message || "Could not verify the code or create your account.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Verify & Create Account";
  }
}

/* ── Shared error display ───────────────────────────────────────────── */

/**
 * @param {string} boxId - id of the .err-box element for the active panel
 * @param {string} msg
 */
function showErr(boxId, msg) {
  const el = document.getElementById(boxId);
  el.textContent   = msg;
  el.style.display = "block";
}