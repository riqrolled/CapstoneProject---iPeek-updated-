
/** Applies a staggered fade-up-in animation to each direct child of `container`, once. */
function staggerIn(container, delayStep = 40) {
  if (!container) return;
  Array.from(container.children).forEach((child, i) => {
    child.style.animationDelay = `${i * delayStep}ms`;
    child.classList.add("motion-in");
  });
}
