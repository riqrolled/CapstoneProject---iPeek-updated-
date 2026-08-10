/**
 * motion.js
 * ---------
 * Shared UI motion utilities: skeleton loading, staggered entry
 * animation, animated number counting, book loader markup, and the
 * typewriter/citation-pop writing animation.
 *
 * Include on every page AFTER api.js and BEFORE the page's own script.
 */

/** Returns the animated book loader SVG as an HTML string. size in px. */
function bookLoaderHTML(size = 48) {
  return `
    <div class="book-loader" style="width:${size}px;height:${size}px;">
      <svg viewBox="0 0 64 64" width="${size}" height="${size}">
        <path class="book-line" d="M32 14 L10 20 L10 48 L32 42 Z" />
        <path class="book-line" d="M32 14 L54 20 L54 48 L32 42 Z" />
        <line class="book-sweep" x1="14" y1="30" x2="28" y2="27" />
        <line class="book-sweep" x1="36" y1="27" x2="50" y2="30" />
      </svg>
    </div>`;
}

/**
 * Shows a skeleton in `container` only if `loadFn` takes longer than
 * 300ms — avoids a flash of skeleton-then-content on fast connections.
 * `loadFn` must render its own final content into `container` when done.
 */
async function withSkeleton(container, skeletonHTML, loadFn) {
  if (!container) return loadFn();
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    container.innerHTML = skeletonHTML;
  }, 300);

  try {
    await loadFn();
  } finally {
    clearTimeout(timer);
    if (shown) container.classList.add("motion-in");
  }
}

/** Applies a staggered fade-up-in animation to each direct child of `container`, once. */
function staggerIn(container, delayStep = 40) {
  if (!container) return;
  Array.from(container.children).forEach((child, i) => {
    child.style.animationDelay = `${i * delayStep}ms`;
    child.classList.add("motion-in");
  });
}

/** Animates a number from its current text content up/down to `target` over `duration`ms. */
function countUp(el, target, duration = 350) {
  if (!el) return;
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) return;
  const range = target - start;
  const startTime = performance.now();

  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(start + range * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/**
 * Types `text` into `el` character-by-character, treating page
 * citations like "(p. 12)" or "(p. 12, p. 24)" as single pop-in units
 * instead of typing them character-by-character. Variable pacing:
 * faster through plain text, brief pause after punctuation.
 */
function typeWriter(el, text) {
  if (!el) return;
  el.innerHTML = "";
  el.classList.add("writing-active");

  const tokens = [];
  const citationRegex = /(\(p\.\s*\d+(?:,\s*p\.\s*\d+)*\))/g;
  let lastIndex = 0;
  let match;
  while ((match = citationRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      for (const ch of text.slice(lastIndex, match.index)) {
        tokens.push({ type: "char", text: ch });
      }
    }
    tokens.push({ type: "citation", text: match[0] });
    lastIndex = match.index + match[0].length;
  }
  for (const ch of text.slice(lastIndex)) {
    tokens.push({ type: "char", text: ch });
  }

  const cursor = document.createElement("span");
  cursor.className = "writing-cursor";

  let i = 0;
  function step() {
    if (i >= tokens.length) {
      cursor.remove();
      el.classList.remove("writing-active");
      return;
    }
    const tok = tokens[i];
    if (tok.type === "citation") {
      const badge = document.createElement("span");
      badge.className   = "citation-badge citation-pop";
      badge.textContent = tok.text;
      el.insertBefore(badge, cursor);
      i++;
      el.appendChild(cursor);
      setTimeout(step, 60);
    } else {
      el.insertBefore(document.createTextNode(tok.text), cursor);
      el.appendChild(cursor);
      i++;
      const delay = /[.,!?]/.test(tok.text) ? 200 : 16;
      setTimeout(step, delay);
    }
  }
  el.appendChild(cursor);
  step();
}

/**
 * Populates `container` with slowly drifting, glowing book/page/bookmark
 * icons for a repository-themed ambient background. Yellow stays the
 * dominant color (per brand), with a smaller mix of vibrant accent
 * colors and navy for depth and visual interest.
 *
 * @param {HTMLElement} container - should already have class "page-ambient"
 * @param {number} count - how many icons to generate (default 30)
 */
function initAmbientBackground(container, count = 105) {
  if (!container) return;

  const icons = [
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 6 L3 8 L3 19 L12 17 Z" />
      <path d="M12 6 L21 8 L21 19 L12 17 Z" />
    </svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 2 H15 L19 6 V22 H6 Z" />
      <path d="M15 2 V6 H19" />
      <line x1="9" y1="11" x2="16" y2="11" />
      <line x1="9" y1="15" x2="16" y2="15" />
    </svg>`,
    `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M6 2 H18 V22 L12 17 L6 22 Z" />
    </svg>`,
  ];

  /* Weighted color palette — yellow dominant (~60%), warm vibrant accent
     for pop (~25%), navy for depth/contrast (~15%) */
  const palette = [
    { color: "#f5c518", weight: 6 },  // brand yellow
    { color: "#d4a800", weight: 3 },  // deeper gold
    { color: "#ff8c42", weight: 3 },  // vibrant warm orange
    { color: "#2a4a7f", weight: 2 },  // navy, for depth
  ];
  const weighted = palette.flatMap(p => Array(p.weight).fill(p.color));
  const pickColor = () => weighted[Math.floor(Math.random() * weighted.length)];

  let html = "";
  for (let i = 0; i < count; i++) {
    const size     = 14 + Math.random() * 26;              // 14–40px
    const left = Math.random() * 100;
    const duration = 18 + Math.random() * 22;               // 18–40s
    const delay    = -Math.random() * duration;
    const driftX   = (Math.random() * 100 - 50).toFixed(0);
    const rotStart = (Math.random() * 30 - 15).toFixed(0);
    const rotEnd   = (parseFloat(rotStart) + (Math.random() * 50 - 25)).toFixed(0);
    const peakOp = (0.12 + Math.random() * 0.16).toFixed(2);
    const icon     = icons[Math.floor(Math.random() * icons.length)];
    const color    = pickColor();

    html += `
      <div class="ambient-icon" style="
        left:${left}%;
        width:${size}px; height:${size}px;
        color:${color};
        animation-duration:${duration}s;
        animation-delay:${delay}s;
        --drift-x:${driftX}px;
        --rot-start:${rotStart}deg;
        --rot-end:${rotEnd}deg;
        --peak-opacity:${peakOp};
      ">${icon}</div>`;
  }

  container.innerHTML = html;
}
