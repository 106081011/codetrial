import { readStored, writeStored } from "./audio-output.js";

/// One arrow key press, in CSS pixels: a rem at the default root size, so a
/// sidebar steps by about two characters of its own text.
const KEY_STEP_PX = 16;

/// What differs between a divider that moves sideways and one that moves up
/// and down. The keys are named for the direction the divider travels.
const AXES = {
  x: {
    client: "clientX",
    extent: "width",
    back: "ArrowLeft",
    forward: "ArrowRight",
  },
  y: {
    client: "clientY",
    extent: "height",
    back: "ArrowUp",
    forward: "ArrowDown",
  },
};

/// A whole pixel inside the bounds. `min` wins when a window is too small to
/// honour both, because the pane that shrinks past its minimum is the one the
/// candidate is resizing and the other can still scroll.
export function clampSize(size, { min, max }) {
  return Math.round(Math.max(min, Math.min(max, size)));
}

/// The pane's size after the divider has travelled `delta` pixels forward
/// (right, or down). A pane after the divider shrinks as the divider advances.
export function movedSize(size, delta, side) {
  return side === "after" ? size - delta : size + delta;
}

/// The size a key press asks for, or `null` for a key that does not move the
/// divider. Home and End go to the two bounds, as the ARIA window splitter
/// pattern has them.
export function keyedSize(key, axis, side, size, bounds) {
  const { back, forward } = AXES[axis];
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  if (key !== back && key !== forward) return null;
  const delta = key === forward ? KEY_STEP_PX : -KEY_STEP_PX;
  return clampSize(movedSize(size, delta, side), bounds);
}

/// The saved size, or `null` when there is none worth applying: nothing
/// stored, storage blocked, or a value that is not a positive length.
export function storedSize(key, storage) {
  const size = Number.parseInt(readStored(key, storage) ?? "", 10);
  return size > 0 ? size : null;
}

/// Makes `handle` a divider that resizes `pane` along `axis`.
///
/// `pane` is the element being sized and `side` says whether it sits before or
/// after the divider. The size reaches the layout as a pixel length in the
/// custom property `property` on `target`, so the stylesheet decides what the
/// length means and what applies while there is none. `bounds()` answers
/// `{ min, max }` in pixels for the window as it is now. Elements in
/// `resizeTargets` can change that room without resizing the window, so they
/// trigger the same reclamping when their boxes change.
///
/// The candidate's choice and the size on show are kept apart. A window that
/// shrinks clamps what is shown and leaves the choice alone, so widening it
/// again brings the pane back instead of leaving it at the smallest size the
/// window ever forced.
export function attachSplitter({
  handle,
  pane,
  axis,
  side = "before",
  target,
  property,
  storageKey,
  bounds,
  storage,
  resizeTargets = [],
}) {
  const { client, extent } = AXES[axis];
  let chosen = storedSize(storageKey, storage);
  let drag = null;
  let frame = 0;

  const measured = () => pane.getBoundingClientRect()[extent];

  /// Puts the chosen size, clamped, into the layout and describes the result.
  /// With no choice the property is removed and the stylesheet's own sizing
  /// applies. That size is reported as measured and never clamped: the bounds
  /// hold a choice, not the stylesheet, which can give the pane more than
  /// `max` where a larger root font outgrows the window. The range reported
  /// then stretches to take that size in, because a value outside its own
  /// range is one a screen reader has no position for; the bounds a choice is
  /// held to are not moved by it.
  function show(limits = bounds()) {
    frame = 0;
    if (chosen === null) target.style.removeProperty(property);
    else target.style.setProperty(property, `${clampSize(chosen, limits)}px`);
    const now = Math.round(measured());
    handle.setAttribute(
      "aria-valuemin",
      String(Math.min(Math.round(limits.min), now)),
    );
    handle.setAttribute(
      "aria-valuemax",
      String(Math.max(Math.round(limits.max), now)),
    );
    handle.setAttribute("aria-valuenow", String(now));
  }

  function choose(size) {
    chosen = size;
    writeStored(storageKey, size === null ? "" : String(size), storage);
    show();
  }

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    // Stops the press from starting a text selection. It also stops the
    // press from moving the focus, which is wanted: a candidate who drags
    // while typing goes on typing, and the keyboard reaches the handle by Tab.
    event.preventDefault();
    // The bounds are read once here. Reading them per move would measure the
    // layout between two writes to it, and a window does not change size
    // under a pointer that is held down.
    drag = {
      id: event.pointerId,
      origin: event[client],
      size: measured(),
      limits: bounds(),
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    chosen = clampSize(
      movedSize(drag.size, event[client] - drag.origin, side),
      drag.limits,
    );
    // One layout per frame however many moves the pointer reports in it.
    frame ||= requestAnimationFrame(() => show(drag?.limits));
  });
  for (const ending of ["pointerup", "pointercancel"]) {
    handle.addEventListener(ending, (event) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      cancelAnimationFrame(frame);
      if (handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      // A press that never moved chose nothing, so it must not turn the
      // stylesheet's sizing into a saved pixel width.
      choose(chosen);
    });
  }
  handle.addEventListener("keydown", (event) => {
    // A chord is the page's or the browser's: Alt+Enter yields the turn and
    // Alt+ArrowLeft goes back, and neither is a request to move the divider.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      choose(null);
      return;
    }
    const limits = bounds();
    const size = keyedSize(
      event.key,
      axis,
      side,
      clampSize(chosen ?? measured(), limits),
      limits,
    );
    if (size === null) return;
    event.preventDefault();
    choose(size);
  });
  handle.addEventListener("dblclick", () => choose(null));
  window.addEventListener("resize", () => show());
  show();
  if (window.ResizeObserver && resizeTargets.length) {
    const observer = new ResizeObserver(() => {
      frame ||= requestAnimationFrame(() => show());
    });
    for (const element of resizeTargets) observer.observe(element);
  }
}
