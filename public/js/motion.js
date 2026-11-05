const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
const timers = new Map();

/** Plays the stage's entrance animation on whatever was just painted; the class drops afterwards so live repaints stay still. */
export function enterStage(stage, cls = "is-entering", ms = 900) {
  if (REDUCED?.matches) return;
  stage.classList.add(cls);
  clearTimeout(timers.get(cls));
  timers.set(cls, setTimeout(() => stage.classList.remove(cls), ms));
}

/** Runs a DOM update as a view transition where the browser has them, so named parts morph between the two states. */
export function morph(update) {
  if (!document.startViewTransition || REDUCED?.matches) return update();
  document.startViewTransition(update);
}
