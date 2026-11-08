/**
 * One click-driven nav pill. Its width stays fixed during each slide;
 * page entry places it immediately on the current link.
 */

function initPillNav(container) {
  if (!container) return;

  let indicator = container.querySelector(".pill-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "pill-indicator";
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.insertBefore(indicator, container.firstChild);
  }
  const links = container.querySelectorAll("a.pill");
  const activeLink = container.querySelector("a.pill.is-active") || links[0];
  let navigating = false;
  let highlightedLink = activeLink;

  function moveTo(el, from = null) {
    highlightedLink = el;
    if (!el) { indicator.style.opacity = "0"; return; }
    // The highlighted font weight affects both link width and position.
    links.forEach(link => {
      link.classList.toggle("nav-lit", link === el);
      link.classList.toggle("is-active", link === el);
    });
    const containerRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (from) {
      // Set the destination size at the source center before translating.
      // Only transform animates, so both edges travel together.
      const sourceRect = from.getBoundingClientRect();
      indicator.style.transition = "none";
      indicator.style.width = `${rect.width}px`;
      indicator.style.height = `${rect.height}px`;
      indicator.style.transform = `translate(${sourceRect.left - containerRect.left - container.clientLeft + (sourceRect.width - rect.width) / 2}px, ${sourceRect.top - containerRect.top - container.clientTop + (sourceRect.height - rect.height) / 2}px)`;
      indicator.getBoundingClientRect();
      indicator.style.transition = "";
    }
    indicator.style.opacity = "1";
    indicator.style.width  = `${rect.width}px`;
    indicator.style.height = `${rect.height}px`;
    indicator.style.transform = `translate(${rect.left - containerRect.left - container.clientLeft}px, ${rect.top - containerRect.top - container.clientTop}px)`;

  }

  function placeImmediately(el) {
    indicator.style.transition = "none";
    moveTo(el);
    indicator.getBoundingClientRect(); // Commit the position before enabling transitions.
    indicator.style.transition = "";
  }

  links.forEach(link => {
    link.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
          event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute("download") ||
          (link.target && link.target !== "_self")) return;
      event.preventDefault();
      if (navigating) return;
      navigating = true;
      moveTo(link, activeLink);
      let navigationTimer;
      const finish = () => {
        clearTimeout(navigationTimer);
        indicator.removeEventListener("transitionend", onTransitionEnd);
        window.location.assign(link.href);
      };
      const onTransitionEnd = event => {
        if (event.target === indicator && event.propertyName === "transform") finish();
      };
      indicator.addEventListener("transitionend", onTransitionEnd);
      // Also handles same-link clicks and disabled transitions.
      navigationTimer = setTimeout(finish, 260);
    });
  });

  // Page entry (including refresh/direct visits) must never replay the slide.
  placeImmediately(activeLink);
  window.addEventListener("resize", () => placeImmediately(highlightedLink));
  document.fonts.ready.then(() => {
    if (container.isConnected && !navigating) placeImmediately(highlightedLink);
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      navigating = false;
      placeImmediately(activeLink);
    }
  });
}

// Runs synchronously before the page's asynchronous auth initialization.
if (typeof restoreNavPresentation === "function") restoreNavPresentation();
if (typeof saveNavPresentation === "function") {
  window.addEventListener("pagehide", saveNavPresentation);
}
