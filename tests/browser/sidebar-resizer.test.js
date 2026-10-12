// Run with: node --test tests/browser/sidebar-resizer.test.js
//
// The divider between the sidebar and the editor. Whether a drag lands, where
// it stops and what the editor looks like at either end are questions about
// layout, so they are asked of a real browser: the grid, the media query and
// pointer capture are all things a document stub does not have.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RUNTIME_CONFIG,
  launchChromium,
  startStaticServer,
} from "./source.js";

// At 1280 by 720 and a 16px root: the sidebar may not go below 17.5rem, and
// half the window is tighter than what the editor's own minimum leaves.
const MIN = 280;
const MAX = 640;
const STORAGE_KEY = "codetrial:sidebarWidth";

let browser = null;
let server = null;
let base = "";

before(async () => {
  browser = await launchChromium();
  if (!browser) return;
  ({ server, base } = await startStaticServer({
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
  }));
});

after(async () => {
  await browser?.close();
  await new Promise((closed) => (server ? server.close(closed) : closed()));
});

/// The interview page with the media preflight out of the way, as in
/// editor-font-size.test.js: hidden rather than clicked through, and only
/// after `init()` has run far enough to have attached the divider.
async function openInterview(page, query = "", rootFontPx = null) {
  if (rootFontPx !== null) {
    // The browser's own default font size, as its settings page changes it,
    // so every rem on the page grows while the window stays the size it was.
    const session = await page.context().newCDPSession(page);
    await session.send("Page.setFontSizes", {
      fontSizes: { standard: rootFontPx },
    });
  }
  await page.goto(`${base}/interview.html${query}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => document.querySelector("#sidebar-resizer").ariaValueNow !== null,
  );
  await page.evaluate(() => {
    document.querySelector("#audio-check").hidden = true;
  });
}

const layout = (page) =>
  page.evaluate((key) => {
    const rect = (selector) =>
      document.querySelector(selector)?.getBoundingClientRect();
    const handle = document.querySelector("#sidebar-resizer");
    return {
      sidebar: rect("#interview-sidebar").width,
      editorLeft: rect("#editor")?.left,
      highlightLeft: rect("#editor-highlight")?.left,
      gutterRight: rect("#editor-lines")?.right,
      runTestsRight: rect("#run-tests")?.right,
      panelRight: rect(".editor-panel")?.right,
      handleShown: getComputedStyle(handle).display !== "none",
      avatarShown:
        getComputedStyle(document.querySelector("#jim-avatar")).display !==
        "none",
      captionsShown:
        getComputedStyle(document.querySelector("#captions-bar")).display !==
        "none",
      now: Number(handle.ariaValueNow),
      min: Number(handle.ariaValueMin),
      max: Number(handle.ariaValueMax),
      stored: localStorage.getItem(key),
      scrolls:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  }, STORAGE_KEY);

/// The window at a new width, once the page has heard about it: the resize
/// event is delivered with the next frame, not with the call.
async function resizeWindow(page, width) {
  await page.setViewportSize({ width, height: 720 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/// Presses the divider and carries it `dx` pixels, leaving the button down.
/// The width is applied on the next animation frame, so one is waited out.
async function carry(page, dx) {
  const box = await page.locator("#sidebar-resizer").boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

function assertEditorIntact(metrics, label) {
  assert.equal(metrics.editorLeft, metrics.highlightLeft, label);
  assert.equal(metrics.editorLeft, metrics.gutterRight, label);
  assert.ok(
    metrics.runTestsRight <= metrics.panelRight,
    `${label}: Run tests is cut off`,
  );
  assert.equal(metrics.scrolls, false, `${label}: the page scrolls sideways`);
}

test("a drag resizes the sidebar, stops at both bounds, and is remembered", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    const initial = await layout(page);
    assert.equal(initial.stored, null);
    assert.deepEqual([initial.min, initial.max], [MIN, MAX]);
    assert.equal(initial.now, Math.round(initial.sidebar));

    await carry(page, 100);
    await page.mouse.up();
    const wider = await layout(page);
    assert.equal(wider.sidebar, Math.round(initial.sidebar) + 100);
    assert.equal(wider.now, wider.sidebar);
    assert.equal(wider.stored, String(wider.sidebar));

    await carry(page, 2000);
    await page.mouse.up();
    const widest = await layout(page);
    assert.equal(widest.sidebar, MAX);
    assertEditorIntact(widest, "widest sidebar");

    await carry(page, -2000);
    await page.mouse.up();
    const narrowest = await layout(page);
    assert.equal(narrowest.sidebar, MIN);
    assertEditorIntact(narrowest, "narrowest sidebar");

    await carry(page, 60);
    await page.mouse.up();
    await openInterview(page);
    const reloaded = await layout(page);
    assert.equal(reloaded.sidebar, MIN + 60);
    assert.equal(reloaded.now, MIN + 60);
  } finally {
    await page.close();
  }
});

test("releasing or cancelling the pointer ends the drag", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    const captured = () =>
      page.evaluate(() =>
        document.querySelector("#sidebar-resizer").hasPointerCapture(1),
      );
    const moveOn = async () => {
      await page.mouse.move(900, 300, { steps: 2 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      return (await layout(page)).sidebar;
    };

    await carry(page, 50);
    assert.equal(await captured(), true, "the handle holds the pointer");
    await page.mouse.up();
    assert.equal(await captured(), false);
    const released = (await layout(page)).sidebar;
    assert.equal(await moveOn(), released, "a released pointer moves nothing");

    // Chromium cancels a mouse pointer only from outside the page, so the
    // event is dispatched here; the capture it has to give up is a real one.
    await carry(page, 30);
    await page.evaluate(() =>
      document
        .querySelector("#sidebar-resizer")
        .dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })),
    );
    assert.equal(await captured(), false);
    const cancelled = (await layout(page)).sidebar;
    assert.equal(cancelled, released + 30);
    assert.equal(await moveOn(), cancelled, "a cancelled drag moves nothing");
    await page.mouse.up();
  } finally {
    await page.close();
  }
});

test("the divider works from the keyboard and says where it is", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    const initial = await layout(page);
    await page.focus("#sidebar-resizer");

    await page.keyboard.press("ArrowRight");
    const stepped = await layout(page);
    assert.equal(stepped.sidebar, Math.round(initial.sidebar) + 16);
    assert.equal(stepped.now, stepped.sidebar);
    assert.equal(stepped.stored, String(stepped.sidebar));

    await page.keyboard.press("ArrowLeft");
    assert.equal((await layout(page)).sidebar, Math.round(initial.sidebar));

    await page.keyboard.press("End");
    assert.equal((await layout(page)).sidebar, MAX);
    await page.keyboard.press("ArrowRight");
    assert.equal((await layout(page)).now, MAX, "no step past the bound");
    await page.keyboard.press("Home");
    assert.equal((await layout(page)).sidebar, MIN);

    await page.keyboard.press("Enter");
    const reset = await layout(page);
    assert.equal(reset.sidebar, initial.sidebar, "back to the default width");
    assert.equal(reset.stored, null);
    assert.equal(reset.now, initial.now);
  } finally {
    await page.close();
  }
});

test("the divider leaves key chords to the page", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    await page.focus("#sidebar-resizer");
    await page.keyboard.press("ArrowRight");
    const chosen = await layout(page);
    // What the page's own Alt+Enter handler is given once the divider has
    // seen the key: a press the divider claimed would not yield the turn.
    await page.evaluate(async () => {
      const { isYieldShortcut } = await import("./lib.js");
      const editor = document.querySelector("#editor");
      window.yields = [];
      document.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          window.yields.push(isYieldShortcut(event, editor));
        }
      });
    });

    await page.keyboard.press("Alt+Enter");
    assert.deepEqual(await page.evaluate(() => window.yields), [true]);
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Control+ArrowRight");
    await page.keyboard.press("Meta+ArrowRight");
    const after = await layout(page);
    assert.equal(after.sidebar, chosen.sidebar);
    assert.equal(after.stored, chosen.stored, "the saved width is kept");
  } finally {
    await page.close();
  }
});

test("a drag leaves the focus where the candidate was typing", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    await page.click("#editor");
    const initial = await layout(page);

    await carry(page, 100);
    await page.mouse.up();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("typed");
    const after = await layout(page);
    assert.equal(after.sidebar, Math.round(initial.sidebar) + 100);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "editor",
    );
    assert.match(await page.inputValue("#editor"), /typed/);
  } finally {
    await page.close();
  }
});

test("a focused divider can be seen, in forced colors too", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    const focusedStyle = async () => {
      await page.focus("#sidebar-resizer");
      // A key press, because a scripted focus alone is not :focus-visible.
      await page.keyboard.press("Home");
      return page.evaluate(() => {
        const style = getComputedStyle(
          document.querySelector("#sidebar-resizer"),
        );
        return { line: style.backgroundImage, ring: style.outlineStyle };
      });
    };
    const usual = await focusedStyle();
    assert.match(usual.line, /^linear-gradient/);

    // Forced colors remove the gradient the line is drawn with.
    await page.emulateMedia({ forcedColors: "active" });
    const forced = await focusedStyle();
    assert.equal(forced.line, "none");
    assert.equal(forced.ring, "solid");
  } finally {
    await page.close();
  }
});

test("a smaller window clamps the sidebar without forgetting the choice", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    await page.focus("#sidebar-resizer");
    await page.keyboard.press("End");
    assert.equal((await layout(page)).sidebar, MAX);

    // Half of a 1100px window, which is tighter than the 572 the editor's
    // own minimum would allow.
    await resizeWindow(page, 1100);
    const smaller = await layout(page);
    assert.equal(smaller.max, 550);
    assert.equal(smaller.sidebar, 550);
    assert.equal(smaller.now, 550);
    assert.equal(smaller.stored, String(MAX));
    assertEditorIntact(smaller, "after the window shrank");

    await resizeWindow(page, 1280);
    assert.equal((await layout(page)).sidebar, MAX);
  } finally {
    await page.close();
  }
});

test("a single-column page has no divider and ignores the saved width", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    await page.focus("#sidebar-resizer");
    await page.keyboard.press("Home");
    await resizeWindow(page, 1000);
    const narrow = await layout(page);
    assert.equal(narrow.handleShown, false);
    assert.ok(narrow.sidebar > 900, `sidebar is ${narrow.sidebar} wide`);
    assert.equal(narrow.stored, String(MIN), "kept for a wider window");
  } finally {
    await page.close();
  }
});

test("the avatar leaves an editor the sidebar has made narrow", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page);
    const settled = async () => {
      // The panel's resize observer reports with the frame after the layout.
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      return layout(page);
    };
    assert.equal((await settled()).avatarShown, true, "default width");

    // 49rem is 784px, and 1232px are shared out, so 448 is the widest
    // sidebar that still leaves the avatar its panel.
    await page.focus("#sidebar-resizer");
    await page.keyboard.press("Home");
    for (let width = 280; width < 440; width += 16) {
      await page.keyboard.press("ArrowRight");
    }
    const beside = await settled();
    assert.equal(beside.sidebar, 440);
    assert.equal(beside.avatarShown, true, "784px or more of editor");

    await page.keyboard.press("ArrowRight");
    const narrow = await settled();
    assert.equal(narrow.sidebar, 456);
    assert.equal(narrow.avatarShown, false, "776px of editor");
    assert.equal(narrow.captionsShown, true, "the captions stay");

    await page.keyboard.press("ArrowLeft");
    assert.equal((await settled()).avatarShown, true, "and it comes back");
  } finally {
    await page.close();
  }
});

test("a larger default font keeps the separator's report true", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const context = await browser.newContext({
    viewport: { width: 1024, height: 720 },
  });
  try {
    // At 20px the stylesheet's own range gives the sidebar 22.5rem, which is
    // more than the 364px the editor's 30rem leaves a choice. Nothing is
    // chosen yet, so the separator reports the width on show, inside a range
    // stretched to hold it.
    const unchosen = await context.newPage();
    await openInterview(unchosen, "", 20);
    const wide = await layout(unchosen);
    assert.equal(wide.sidebar, 450);
    assert.deepEqual([wide.min, wide.now, wide.max], [350, 450, 450]);

    // A choice is still held to the bounds, and the range goes back to them.
    await unchosen.focus("#sidebar-resizer");
    await unchosen.keyboard.press("End");
    const chosen = await layout(unchosen);
    assert.equal(chosen.sidebar, 364);
    assert.deepEqual([chosen.min, chosen.now, chosen.max], [350, 364, 364]);
    await unchosen.close();

    // At 24px the editor's 30rem leaves less than the sidebar's own 17.5rem,
    // and the range must not be announced upside down.
    const cramped = await context.newPage();
    await openInterview(cramped, "", 24);
    const tight = await layout(cramped);
    assert.deepEqual([tight.min, tight.max], [420, 420]);
    await cramped.focus("#sidebar-resizer");
    await cramped.keyboard.press("End");
    const ended = await layout(cramped);
    assert.equal(ended.sidebar, 420);
    assert.equal(ended.stored, "420");
  } finally {
    await context.close();
  }
});

test("the whiteboard gets the same divider as the editor", async (t) => {
  if (!browser) return t.skip("playwright chromium unavailable");
  const page = await browser.newPage();
  try {
    await openInterview(page, "?mode=whiteboard");
    const initial = await layout(page);
    assert.deepEqual([initial.min, initial.max], [MIN, MAX]);
    await carry(page, 80);
    await page.mouse.up();
    assert.equal(
      (await layout(page)).sidebar,
      Math.round(initial.sidebar) + 80,
    );
  } finally {
    await page.close();
  }
});
