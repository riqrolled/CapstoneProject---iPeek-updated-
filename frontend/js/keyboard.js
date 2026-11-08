/* Native dialogs supply modal focus containment, inert background and topmost Escape. */
window.uiDialog = (() => {
  const sessions = new WeakMap();
  function open(id, dismiss, trigger = document.activeElement) {
    const dialog = document.getElementById(id);
    if (dialog.open) return;
    sessions.set(dialog, { trigger, dismiss });
    dialog.oncancel = event => {
      event.preventDefault();
      sessions.get(dialog)?.dismiss();
    };
    // Keep boundary Tab presses in the document rather than moving to browser chrome.
    dialog.onkeydown = event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    dialog.onclick = event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dismiss();
    };
    dialog.showModal();
  }
  function close(id) {
    const dialog = document.getElementById(id);
    if (!dialog.open) return;
    const session = sessions.get(dialog);
    dialog.close();
    sessions.delete(dialog);
    if (session?.trigger?.isConnected) session.trigger.focus({preventScroll: true});
  }
  return { open, close };
})();
