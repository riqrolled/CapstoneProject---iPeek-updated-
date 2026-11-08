/**
 * Login form motion shared by every showLogin()/showRegister() entry point.
 * Desktop waits for the image panel slide; mobile fades immediately.
 * Load after login.js.
 */

document.addEventListener("DOMContentLoaded", () => {

  const authShell    = document.getElementById("authShell");
  const imagePanel    = document.getElementById("imagePanel");
  const authToggle    = document.getElementById("authToggle");
  const toggleSignIn = document.getElementById("toggleSignIn");
  const toggleSignUp = document.getElementById("toggleSignUp");

  const loginBox = authShell ? authShell.querySelector(".login-right") : null;
  const desktop = window.matchMedia("(min-width: 769px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let waitingForSlide = false;

  function slideIsRunning() {
    return imagePanel && imagePanel.getAnimations().some(animation =>
      animation.transitionProperty === "left" && animation.playState !== "finished");
  }

  function revealForm() {
    if (!loginBox) return;
    waitingForSlide = false;
    loginBox.inert = false;
    loginBox.classList.remove("form-fade-pending", "form-fade-in");
    if (!reducedMotion.matches) {
      // Commit removal so rapid switches restart the existing CSS animation.
      void loginBox.offsetWidth;
      loginBox.classList.add("form-fade-in");
    }
    requestAnimationFrame(() => {
      const field = [...loginBox.querySelectorAll('input:not(:disabled)')].find(el => el.getClientRects().length);
      field?.focus({preventScroll: true});
    });
  }

  function finishSlide(event) {
    if (event.target !== imagePanel || event.propertyName !== "left") return;
    // A cancelled old slide may already have been replaced by a reverse slide.
    if (waitingForSlide && !slideIsRunning()) revealForm();
  }

  function setOrientation(isRegister) {
    if (loginBox) {
      loginBox.inert = true;
      loginBox.classList.remove("form-fade-in");
      loginBox.classList.add("form-fade-pending");
    }
    if (authShell) authShell.classList.toggle("register-orientation", isRegister);
    if (authToggle) authToggle.classList.toggle("on-register", isRegister);
    if (toggleSignIn) toggleSignIn.classList.toggle("active", !isRegister);
    if (toggleSignUp) toggleSignUp.classList.toggle("active", isRegister);
    waitingForSlide = !reducedMotion.matches && desktop.matches && slideIsRunning();
    if (!waitingForSlide) revealForm();
  }

  // Fired synchronously before the incoming panel becomes visible.
  document.addEventListener("login-form-switch", event => setOrientation(event.detail.isRegister));
  if (imagePanel) {
    imagePanel.addEventListener("transitionend", finishSlide);
    imagePanel.addEventListener("transitioncancel", finishSlide);
  }
  if (loginBox) {
    loginBox.addEventListener("animationend", event => {
      if (event.target === loginBox && event.animationName === "formFadeIn") {
        loginBox.classList.remove("form-fade-in");
      }
    });
  }
  desktop.addEventListener("change", () => {
    if (waitingForSlide && !desktop.matches) revealForm();
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) revealForm();
  });

  if (toggleSignIn) toggleSignIn.addEventListener("click", () => showLogin());
  if (toggleSignUp) toggleSignUp.addEventListener("click", () => showRegister());

  /* ── Mobile welcome screen dismissal ─────────────────────────────── */
  const mobileWelcomeSignIn = document.getElementById("mobileWelcomeSignIn");
  if (mobileWelcomeSignIn) {
    mobileWelcomeSignIn.addEventListener("click", () => {
      document.body.classList.add("welcome-dismissed");
      document.getElementById("loginUid").focus();
    });
  }

});
