/** Hidden file input: off-screen so the browser does not scroll the page to the field after pick. */
export const SETTINGS_HIDDEN_FILE_INPUT_CLASS =
  'pointer-events-none fixed left-0 top-0 -z-10 h-px w-px overflow-hidden opacity-0';

function findDashboardScrollParent(from: HTMLElement | null): HTMLElement | null {
  if (typeof window === 'undefined') return null;
  let node: HTMLElement | null = from;
  while (node) {
    const oy = window.getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return node;
    node = node.parentElement;
  }
  return null;
}

function getSettingsScrollAnchor(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-settings-scroll-anchor]');
}

/** Run async work without losing the dashboard main scroll position (e.g. after a file picker closes). */
export async function preserveSettingsScrollDuring<T>(task: () => Promise<T>): Promise<T> {
  const scrollParent = findDashboardScrollParent(getSettingsScrollAnchor());
  const scrollTop = scrollParent?.scrollTop ?? window.scrollY;

  try {
    return await task();
  } finally {
    const restore = () => {
      if (scrollParent) {
        scrollParent.scrollTop = scrollTop;
      } else {
        window.scrollTo({ top: scrollTop, left: 0, behavior: 'auto' });
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    };
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }
}

export function blurFileInput(input: HTMLInputElement | null) {
  input?.blur();
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}
