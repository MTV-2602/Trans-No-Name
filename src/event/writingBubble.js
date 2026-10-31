/**
 * writingBubble.js - Quick Chat Translation Floating Button & In-Place Text Replacement
 * Part of TransNoName with Chat Translation feature
 */
import browser from "webextension-polyfill";
import * as util from "/src/util";
import * as dom_util from "/src/util/dom";

const POSITION_STORAGE_KEY = "mttWritingBubblePosition";
const EDITABLE_SELECTOR = [
  "textarea",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="url"]',
  'input[type="tel"]',
  "input:not([type])",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[spellcheck="true"]'
].join(",");

const COLOR_GRADIENTS = {
  teal: "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
  blue: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
  green: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
  purple: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
  orange: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
  red: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
  dark: "linear-gradient(135deg, #374151 0%, #1f2937 100%)",
};

const COLOR_SHADOWS = {
  teal: "0 6px 18px rgba(15, 118, 110, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)",
  blue: "0 6px 18px rgba(37, 99, 235, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)",
  green: "0 6px 18px rgba(22, 163, 74, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)",
  purple: "0 6px 18px rgba(124, 58, 237, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)",
  orange: "0 6px 18px rgba(234, 88, 12, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)",
  red: "0 6px 18px rgba(220, 38, 38, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)",
  dark: "0 6px 18px rgba(55, 65, 81, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)",
};

const SIZES = {
  small: {
    minWidth: "42px",
    height: "32px",
    padding: "0 10px",
    fontSize: "11px",
    borderRadius: "11px"
  },
  medium: {
    minWidth: "52px",
    height: "38px",
    padding: "0 14px",
    fontSize: "13px",
    borderRadius: "14px"
  },
  large: {
    minWidth: "62px",
    height: "46px",
    padding: "0 18px",
    fontSize: "15px",
    borderRadius: "18px"
  }
};

let activeEditable = null;
let currentSetting = null;
let host = null;
let shadow = null;
let quickTranslateButton = null;
let bubbleLabel = null;
let statusBox = null;
let dragState = null;
let bubblePointerState = null;
let visualResetTimer = 0;
let isTranslating = false;

export function isBubbleEnabled(setting = currentSetting) {
  if (!setting) return false;
  const val = setting["showWritingBubble"];
  if (
    val === false ||
    val === "false" ||
    val === "off" ||
    val === "0" ||
    val === 0 ||
    val === "null" ||
    val === null
  ) {
    return false;
  }
  return true;
}

export function removeAllBubbleHosts() {
  try {
    const existing = document.querySelectorAll("#mtt-writing-bubble-host, [id*='writing-bubble']");
    existing.forEach((el) => {
      try {
        el.remove();
      } catch (e) {
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    });
  } catch (e) {}
}

export function initWritingBubble(setting) {
  // CRITICAL: NEVER inject floating bubble in sub-iframes, only top-level page!
  if (window.self !== window.top) {
    return;
  }

  currentSetting = setting;

  // Always keep focusin and pointerdown active so resolveEditableTarget works for hotkey translation
  document.removeEventListener("focusin", handleFocusIn, true);
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("focusin", handleFocusIn, true);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);

  // If bubble is turned off, ensure DOM is 100% clean and do NOT create host
  if (!isBubbleEnabled(setting)) {
    removeAllBubbleHosts();
    destroyWritingBubble();
    // Re-attach editable tracking for keyboard shortcuts
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return;
  }

  removeAllBubbleHosts();
  createBubbleElement();
  applyBubbleAppearance();
  loadSavedPosition();

  window.removeEventListener("resize", handleResize);
  window.addEventListener("resize", handleResize);

  // If body wasn't ready yet, re-attach when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (isBubbleEnabled(currentSetting)) {
        attachHost();
        applyBubbleAppearance();
      }
    });
  }
  window.addEventListener("load", () => {
    if (isBubbleEnabled(currentSetting)) {
      attachHost();
      applyBubbleAppearance();
    }
  });
}

export function updateWritingBubbleSetting(newSetting) {
  currentSetting = newSetting;

  if (!isBubbleEnabled(newSetting)) {
    // Thoroughly remove ALL traces of the bubble from the DOM
    destroyWritingBubble();
    removeAllBubbleHosts();
    // Keep focusin/pointerdown active for hotkey support
    document.removeEventListener("focusin", handleFocusIn, true);
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return;
  }

  // If enabled:
  if (!host) {
    removeAllBubbleHosts();
    createBubbleElement();
    loadSavedPosition();
    window.removeEventListener("resize", handleResize);
    window.addEventListener("resize", handleResize);
  } else {
    attachHost();
    applyBubbleVisibility();
  }
  applyBubbleAppearance();
}

export function destroyWritingBubble() {
  window.removeEventListener("resize", handleResize);
  removeAllBubbleHosts();
  if (host && host.parentNode) {
    host.parentNode.removeChild(host);
  }
  host = null;
  shadow = null;
  quickTranslateButton = null;
  bubbleLabel = null;
  statusBox = null;
}

function attachHost() {
  if (!host) return;
  if (!isBubbleEnabled(currentSetting)) {
    removeAllBubbleHosts();
    return;
  }
  const container = document.body || document.documentElement;
  if (container && host.parentNode !== container) {
    container.appendChild(host);
  }
}

function createBubbleElement() {
  if (host) return;
  if (!isBubbleEnabled(currentSetting)) return;

  host = document.createElement("div");
  host.id = "mtt-writing-bubble-host";
  host.style.cssText = `
    all: initial !important;
    position: fixed !important;
    bottom: 80px !important;
    right: 24px !important;
    z-index: 2147483647 !important;
    display: block !important;
    visibility: visible !important;
    transition: opacity 0.2s ease !important;
  `;

  shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial !important;
        display: block !important;
      }
      .root {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .bubble {
        min-width: 52px;
        height: 38px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
        color: #ffffff;
        box-shadow: 0 6px 18px rgba(15, 118, 110, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease, opacity 0.15s ease;
      }
      .bubble:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 8px 22px rgba(15, 118, 110, 0.55), 0 3px 8px rgba(0, 0, 0, 0.25);
      }
      .bubble:active {
        transform: translateY(1px) scale(0.97);
      }
      .bubble:disabled {
        opacity: 0.85;
        cursor: wait;
      }
      .bubble.is-loading {
        background: linear-gradient(135deg, #0c6660 0%, #0c5350 100%) !important;
      }
      .bubble.is-success {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
        box-shadow: 0 6px 18px rgba(16, 185, 129, 0.5) !important;
      }
      .status {
        max-width: 220px;
        padding: 6px 12px;
        border-radius: 8px;
        background: rgba(17, 24, 39, 0.94);
        backdrop-filter: blur(4px);
        color: #f9fafb;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.25);
        font: 600 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;
      }
      .status[hidden] {
        display: none;
      }
      .status.error {
        background: rgba(220, 38, 38, 0.95);
      }
    </style>
    <div class="root">
      <button class="bubble" id="quickTranslate" type="button" title="Dịch nhanh nội dung đang gõ">
        <span id="bubbleLabel">EN</span>
      </button>
      <div class="status" id="status" hidden></div>
    </div>
  `;

  attachHost();

  quickTranslateButton = shadow.getElementById("quickTranslate");
  bubbleLabel = shadow.getElementById("bubbleLabel");
  statusBox = shadow.getElementById("status");

  quickTranslateButton.addEventListener("click", handleBubbleClick);
  quickTranslateButton.addEventListener("dblclick", handleBubbleDblClick);
  quickTranslateButton.addEventListener("pointerdown", startBubblePointer);

  // Restore opacity on hover
  host.addEventListener("mouseenter", () => {
    if (host) host.style.opacity = "1";
  });
  host.addEventListener("mouseleave", () => {
    if (host && currentSetting?.["writingBubbleOpacity"]) {
      host.style.opacity = currentSetting["writingBubbleOpacity"];
    }
  });
}

function applyBubbleVisibility() {
  if (!host) return;
  const isEnabled = isBubbleEnabled(currentSetting);
  if (isEnabled) {
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("visibility", "visible", "important");
    host.style.removeProperty("pointer-events");
  } else {
    host.style.setProperty("display", "none", "important");
    host.style.setProperty("visibility", "hidden", "important");
    host.style.setProperty("pointer-events", "none", "important");
    if (host.parentNode) {
      host.parentNode.removeChild(host);
    }
    removeAllBubbleHosts();
  }
}

function applyBubbleAppearance() {
  if (!quickTranslateButton || !host) return;

  const customColor = (currentSetting?.["writingBubbleCustomColor"] || "").trim();
  const colorKey = currentSetting?.["writingBubbleColor"] || "teal";
  const sizeKey = currentSetting?.["writingBubbleSize"] || "medium";
  const opacityVal = currentSetting?.["writingBubbleOpacity"] || "1";

  const size = SIZES[sizeKey] || SIZES.medium;
  quickTranslateButton.style.minWidth = size.minWidth;
  quickTranslateButton.style.height = size.height;
  quickTranslateButton.style.padding = size.padding;
  quickTranslateButton.style.fontSize = size.fontSize;
  quickTranslateButton.style.borderRadius = size.borderRadius;

  if (customColor && customColor !== "#00000000") {
    quickTranslateButton.style.background = customColor;
    quickTranslateButton.style.boxShadow = `0 6px 18px ${customColor}80, 0 2px 6px rgba(0, 0, 0, 0.2)`;
  } else {
    const bg = COLOR_GRADIENTS[colorKey] || COLOR_GRADIENTS.teal;
    const shadowStyle = COLOR_SHADOWS[colorKey] || COLOR_SHADOWS.teal;
    quickTranslateButton.style.background = bg;
    quickTranslateButton.style.boxShadow = shadowStyle;
  }

  host.style.opacity = opacityVal;

  refreshBubbleLabel();
}

function refreshBubbleLabel() {
  if (!bubbleLabel || !quickTranslateButton) return;
  const customText = (currentSetting?.["writingBubbleCustomText"] || "").trim();
  const iconStyle = currentSetting?.["writingBubbleIcon"] || "lang";
  const target = currentSetting?.["writingLanguage"] || "en";
  const targetCode = String(target).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "EN";

  if (customText) {
    bubbleLabel.textContent = customText;
  } else if (iconStyle === "translate") {
    bubbleLabel.textContent = "文A";
  } else if (iconStyle === "chat") {
    bubbleLabel.textContent = "💬";
  } else if (iconStyle === "sparkle") {
    bubbleLabel.textContent = "✨";
  } else {
    bubbleLabel.textContent = targetCode;
  }
  quickTranslateButton.title = `Dịch nhanh ô chat sang ${targetCode} (Nhấp đúp để đặt lại vị trí)`;
}

function handleFocusIn(event) {
  const editable = getEditableCandidate(event.target);
  if (editable) {
    activeEditable = editable;
  }
}

function handleDocumentPointerDown(event) {
  if (host && host.contains(event.target)) return;
  const editable = findEditableFromPoint(event.clientX, event.clientY) || getEditableCandidate(event.target);
  if (editable) {
    activeEditable = editable;
  }
}

function startBubblePointer(event) {
  if (event.button !== 0) return;

  // CRITICAL: Prevent stealing focus from input so dynamic dropdowns (GitHub search, Messenger, Slack) do NOT close!
  event.preventDefault();

  bubblePointerState = {
    startX: event.clientX,
    startY: event.clientY,
    moved: false
  };

  startDrag(event, quickTranslateButton);
}

function handleBubbleClick(event) {
  event.preventDefault();
  if (bubblePointerState?.moved) {
    bubblePointerState = null;
    return;
  }
  translateCurrentDraft();
}

function handleBubbleDblClick(event) {
  event.preventDefault();
  event.stopPropagation();
  resetHostPosition();
}

function resetHostPosition() {
  if (!host) return;
  host.style.removeProperty("left");
  host.style.removeProperty("top");
  host.style.bottom = "80px";
  host.style.right = "24px";
  browser.storage.local.remove(POSITION_STORAGE_KEY).catch(() => undefined);
  showStatus("Đã đặt lại vị trí nút", false);
}

export async function translateCurrentDraft() {
  if (isTranslating) return;

  const editable = resolveEditableTarget(false);
  const text = getEditableText(editable);

  if (!text) {
    showStatus("Chưa có nội dung để dịch", true);
    return;
  }

  isTranslating = true;
  setBusy(true);
  setBubbleVisual("loading");
  showStatus("", false);

  try {
    const targetLang = currentSetting?.["writingLanguage"] || "en";
    const { targetText, isBroken } = await util.requestTranslate(
      text,
      "auto",
      targetLang,
      currentSetting?.["translateTarget"]
    );

    if (isBroken || !targetText) {
      throw new Error("Không thể dịch lúc này");
    }

    const inserted = await insertTextIntoEditable(editable, targetText, { replaceAll: true });
    if (!inserted.ok) {
      throw new Error(inserted.reason || "Không thể thay đổi nội dung");
    }

    setBubbleVisual("success");
    showStatus("", false);
  } catch (error) {
    setBubbleVisual("idle");
    showStatus(error.message || "Dịch thất bại", true);
  } finally {
    setBusy(false);
    isTranslating = false;
  }
}

async function insertTextIntoEditable(element, text, options = {}) {
  const editable = normalizeEditable(element);
  const replaceAll = Boolean(options.replaceAll);

  if (!text || !editable) {
    return { ok: false, reason: "Không tìm thấy ô nhập" };
  }

  // Google Doc support
  if (util.isGoogleDoc()) {
    try {
      pasteTextGoogleDoc(text);
      return { ok: true };
    } catch (e) {
      // fallback
    }
  }

  focusEditable(editable, { placeCaret: !replaceAll });

  // Standard input or textarea
  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
    if (replaceAll) {
      editable.value = text;
      editable.selectionStart = editable.selectionEnd = editable.value.length;
    } else {
      const start = typeof editable.selectionStart === "number" ? editable.selectionStart : editable.value.length;
      const end = typeof editable.selectionEnd === "number" ? editable.selectionEnd : editable.value.length;
      editable.setRangeText(text, start, end, "end");
    }
    dispatchEditableEvents(editable, text, { replaceAll });
    return { ok: true };
  }

  // Rich editable / contenteditable
  return insertIntoRichEditable(editable, text, { replaceAll });
}

async function insertIntoRichEditable(editable, text, options = {}) {
  const replaceAll = Boolean(options.replaceAll);

  if (replaceAll) {
    selectAllEditableContents(editable);
  } else {
    placeCaretAtEnd(editable);
  }

  // Try execCommand insertText
  const execResult = tryExecCommandInsert(editable, text);
  if (execResult.ok) {
    if (!replaceAll || getEditableText(editable) === text.trim()) {
      dispatchEditableEvents(editable, text, { replaceAll });
      return execResult;
    }
  }

  // Try paste event
  try {
    pasteTextEvent(editable, text);
    if (!replaceAll || getEditableText(editable) === text.trim()) {
      dispatchEditableEvents(editable, text, { replaceAll });
      return { ok: true };
    }
  } catch (e) {}

  // Fallback to DOM Range replace
  const rangeResult = replaceWithRange(editable, text, { replaceAll });
  if (rangeResult.ok) {
    dispatchEditableEvents(editable, text, { replaceAll });
    return rangeResult;
  }

  return { ok: false, reason: "Không ghi được vào ô nhập" };
}

function tryExecCommandInsert(editable, text) {
  try {
    if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
      const inserted = document.execCommand("insertText", false, text);
      if (inserted) {
        placeCaretAtEnd(editable);
        return { ok: true };
      }
    }
  } catch (error) {}
  return { ok: false };
}

function replaceWithRange(editable, text, options = {}) {
  const replaceAll = Boolean(options.replaceAll);
  const selection = window.getSelection();
  if (!selection) {
    return { ok: false, reason: "Không mở được con trỏ" };
  }

  if (replaceAll) {
    selectAllEditableContents(editable);
  } else if (!selection.rangeCount || !editable.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    placeCaretAtEnd(editable);
  }

  const activeSelection = window.getSelection();
  if (!activeSelection || !activeSelection.rangeCount) {
    return { ok: false, reason: "Không tạo được vùng thay thế" };
  }

  const range = activeSelection.getRangeAt(0);
  range.deleteContents();

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  const caretRange = document.createRange();
  caretRange.setStartAfter(textNode);
  caretRange.collapse(true);
  activeSelection.removeAllRanges();
  activeSelection.addRange(caretRange);

  return { ok: true };
}

function pasteTextEvent(ele, text) {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  const paste = new ClipboardEvent("paste", {
    clipboardData,
    data: text,
    dataType: "text/plain",
    bubbles: true,
    cancelable: true,
  });
  paste.docs_plus_ = true;
  ele.dispatchEvent(paste);
  clipboardData.clearData();
}

function pasteTextGoogleDoc(text) {
  const el = document.getElementsByClassName("docs-texteventtarget-iframe")?.[0];
  const target = el?.contentDocument?.querySelector("[contenteditable=true]");
  if (target) {
    pasteTextEvent(target, text);
  }
}

function dispatchEditableEvents(element, text, options = {}) {
  const inputType = options.replaceAll ? "insertReplacementText" : "insertText";
  try {
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: text }));
  } catch (error) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function focusEditable(element, options = {}) {
  const placeCaret = options.placeCaret !== false;
  element.focus({ preventScroll: true });

  if (placeCaret && !(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLInputElement)) {
    placeCaretAtEnd(element);
  }
}

function selectAllEditableContents(element) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtEnd(element) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getEditableText(element) {
  const editable = normalizeEditable(element);
  if (!editable) return "";

  const selection = window.getSelection();
  if (selection && selection.type !== "Caret" && selection.toString().trim().length > 0) {
    if (editable.contains(selection.anchorNode) || editable === selection.anchorNode) {
      return selection.toString().trim();
    }
  }

  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
    return editable.value.trim();
  }

  return (editable.innerText || editable.textContent || "").trim();
}

function resolveEditableTarget(shouldFocus) {
  const current = normalizeEditable(activeEditable);
  if (current && isVisible(current)) {
    if (shouldFocus) focusEditable(current);
    return current;
  }

  const focusedBox = dom_util.getFocusedWritingBox();
  if (focusedBox && isVisible(focusedBox)) {
    activeEditable = focusedBox;
    return focusedBox;
  }

  const fallback = findBestEditable();
  if (fallback) {
    activeEditable = fallback;
    if (shouldFocus) focusEditable(fallback);
    return fallback;
  }

  return null;
}

function findBestEditable() {
  const candidates = Array.from(document.querySelectorAll(EDITABLE_SELECTOR))
    .map((element) => normalizeEditable(element))
    .filter((element, index, array) => element && array.indexOf(element) === index)
    .filter((element) => !host?.contains(element) && isVisible(element));

  if (!candidates.length) return null;

  return candidates
    .map((element) => ({ element, score: scoreEditable(element) }))
    .sort((left, right) => right.score - left.score)[0]?.element || null;
}

function scoreEditable(element) {
  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLowerCase();
  const hint = [
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    element.getAttribute("data-placeholder"),
    element.getAttribute("title")
  ]
    .filter(Boolean)
    .join(" ");

  let score = 0;
  score += Math.min(180, rect.width * 0.35);
  score += rect.top > window.innerHeight * 0.4 ? 100 : 0;
  score += tag === "textarea" ? 70 : 0;
  score += element.isContentEditable ? 90 : 0;
  score += /\b(message|chat|reply|send|tin nhan|nhap|write|typing|comment)\b/i.test(hint) ? 140 : 0;
  score += document.activeElement && element.contains(document.activeElement) ? 200 : 0;
  return score;
}

function findEditableFromPoint(clientX, clientY) {
  if (typeof document.elementsFromPoint !== "function") return null;

  const elements = document.elementsFromPoint(clientX, clientY);
  for (const element of elements) {
    if (host && host.contains(element)) continue;
    const candidate = getEditableCandidate(element);
    if (candidate) return candidate;
  }
  return null;
}

function getEditableCandidate(node) {
  if (!(node instanceof Element)) return null;

  const closest = node.closest(EDITABLE_SELECTOR);
  if (closest && isSupportedEditable(closest) && isVisible(closest)) {
    return normalizeEditable(closest);
  }

  let current = node;
  while (current && current !== document.body) {
    if (isSupportedEditable(current) && isVisible(current)) {
      return normalizeEditable(current);
    }
    current = current.parentElement;
  }

  return null;
}

function normalizeEditable(element) {
  if (!(element instanceof Element)) return null;

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return isSupportedEditable(element) ? element : null;
  }

  const role = element.getAttribute("role");
  if (role === "textbox" && isVisible(element)) {
    return element;
  }

  const hostEditable = element.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"]');
  if (hostEditable && isVisible(hostEditable)) {
    return hostEditable;
  }

  return element.isContentEditable && isVisible(element) ? element : null;
}

function isSupportedEditable(element) {
  if (!(element instanceof Element)) return false;

  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }

  if (element instanceof HTMLInputElement) {
    return (
      !element.disabled &&
      !element.readOnly &&
      ["text", "search", "email", "url", "tel", ""].includes(element.type)
    );
  }

  return element.getAttribute("role") === "textbox" || Boolean(element.isContentEditable);
}

function isVisible(element) {
  if (!(element instanceof Element)) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 30 &&
    rect.height > 14 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    style.pointerEvents !== "none"
  );
}

function showStatus(message, isError) {
  if (!statusBox) return;
  if (!message) {
    statusBox.hidden = true;
    statusBox.textContent = "";
    statusBox.classList.remove("error");
    return;
  }

  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.classList.toggle("error", Boolean(isError));

  window.clearTimeout(showStatus.timerId);
  showStatus.timerId = window.setTimeout(() => {
    if (statusBox) {
      statusBox.hidden = true;
    }
  }, isError ? 2600 : 1600);
}

function setBusy(isBusy) {
  if (quickTranslateButton) {
    quickTranslateButton.disabled = isBusy;
  }
}

function setBubbleVisual(mode, customLabel) {
  if (!quickTranslateButton || !bubbleLabel) return;
  window.clearTimeout(visualResetTimer);
  quickTranslateButton.classList.remove("is-loading", "is-success");

  if (mode === "loading") {
    quickTranslateButton.classList.add("is-loading");
    bubbleLabel.textContent = customLabel || "...";
    return;
  }

  if (mode === "success") {
    quickTranslateButton.classList.add("is-success");
    bubbleLabel.textContent = customLabel || "✓";
    visualResetTimer = window.setTimeout(() => {
      applyBubbleAppearance();
    }, 1000);
    return;
  }

  applyBubbleAppearance();
}

function startDrag(event, sourceElement) {
  if (event.button !== 0 || !host) return;

  const rect = host.getBoundingClientRect();
  dragState = {
    sourceElement,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originLeft: rect.left,
    originTop: rect.top
  };

  sourceElement.setPointerCapture(event.pointerId);
  sourceElement.addEventListener("pointermove", onDragMove);
  sourceElement.addEventListener("pointerup", stopDrag);
  sourceElement.addEventListener("pointercancel", stopDrag);
}

function onDragMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  if (bubblePointerState) {
    const movedDist = Math.abs(event.clientX - bubblePointerState.startX) + Math.abs(event.clientY - bubblePointerState.startY);
    if (movedDist > 5) {
      bubblePointerState.moved = true;
    }
  }

  setHostPosition(
    dragState.originLeft + (event.clientX - dragState.startX),
    dragState.originTop + (event.clientY - dragState.startY)
  );
}

function stopDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  const { sourceElement } = dragState;
  sourceElement.releasePointerCapture(event.pointerId);
  sourceElement.removeEventListener("pointermove", onDragMove);
  sourceElement.removeEventListener("pointerup", stopDrag);
  sourceElement.removeEventListener("pointercancel", stopDrag);
  dragState = null;
  saveCurrentPosition();

  if (bubblePointerState && bubblePointerState.moved) {
    window.setTimeout(() => {
      bubblePointerState = null;
    }, 0);
  }
}

function handleResize() {
  if (!host) return;
  // If user has a custom saved left/top, keep it in bounds
  if (host.style.left) {
    setHostPosition(parseFloat(host.style.left || "0"), parseFloat(host.style.top || "0"));
  }
}

async function loadSavedPosition() {
  try {
    const res = await browser.storage.local.get(POSITION_STORAGE_KEY);
    const saved = res?.[POSITION_STORAGE_KEY];
    if (
      Number.isFinite(saved?.left) &&
      Number.isFinite(saved?.top) &&
      saved.left > 0 &&
      saved.top > 0 &&
      window.innerWidth > 200
    ) {
      setHostPosition(saved.left, saved.top);
    }
  } catch (e) {
    // Default right/bottom in CSS will apply
  }
}

function setHostPosition(left, top) {
  if (!host) return;
  const hostWidth = 80;
  const hostHeight = 50;
  const maxLeft = Math.max(12, window.innerWidth - hostWidth - 12);
  const maxTop = Math.max(12, window.innerHeight - hostHeight - 12);

  host.style.removeProperty("bottom");
  host.style.removeProperty("right");
  host.style.left = `${Math.min(maxLeft, Math.max(12, left))}px`;
  host.style.top = `${Math.min(maxTop, Math.max(12, top))}px`;
}

function saveCurrentPosition() {
  if (!host || !host.style.left) return;
  browser.storage.local.set({
    [POSITION_STORAGE_KEY]: {
      left: parseFloat(host.style.left || "0"),
      top: parseFloat(host.style.top || "0")
    }
  }).catch(() => undefined);
}

// Live reactive storage listener: immediately remove or update bubble when settings change
try {
  if (typeof browser !== "undefined" && browser?.storage?.onChanged) {
    browser.storage.onChanged.addListener((changes, namespace) => {
      if (
        changes?.showWritingBubble ||
        changes?.writingBubbleIcon ||
        changes?.writingBubbleColor ||
        changes?.writingBubbleSize ||
        changes?.writingBubbleOpacity ||
        changes?.writingBubbleCustomColor ||
        changes?.writingBubbleCustomText ||
        changes?.writingLanguage
      ) {
        if (!currentSetting) currentSetting = {};
        for (const [key, change] of Object.entries(changes)) {
          currentSetting[key] = change.newValue;
        }
        updateWritingBubbleSetting(currentSetting);
      }
    });
  }
} catch (e) {}
