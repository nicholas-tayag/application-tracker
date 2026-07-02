const SAFE_CLASSIFICATION = "auto-fill-safe";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "scan-fields") {
    sendResponse({ fields: scanFields(), url: location.href });
    return;
  }
  if (message?.type === "apply-plan") {
    sendResponse(applyPlan(message.plan));
  }
});

function scanFields() {
  return [...document.querySelectorAll("input, select, textarea, button")]
    .filter((element) => isVisible(element))
    .slice(0, 300)
    .map((element, index) => {
      const fieldId = element.id || element.name || `apply-safe-${index}`;
      element.dataset.applySafeFieldId = fieldId;
      return {
        id: fieldId,
        name: element.name || "",
        label: labelFor(element),
        placeholder: element.placeholder || "",
        type: element.type || element.tagName.toLowerCase(),
        tagName: element.tagName.toLowerCase(),
        required: element.required || element.getAttribute("aria-required") === "true",
        autocomplete: element.autocomplete || "",
        text: element.innerText || "",
        accept: element.accept || "",
        options: element instanceof HTMLSelectElement
          ? [...element.options].map((option) => option.textContent || option.value)
          : []
      };
    });
}

function applyPlan(plan) {
  let filled = 0;
  const skipped = [];
  for (const field of plan?.fields || []) {
    if (field.classification !== SAFE_CLASSIFICATION || !field.proposedValue) continue;
    const element = [...document.querySelectorAll("[data-apply-safe-field-id]")]
      .find((candidate) => candidate.dataset.applySafeFieldId === field.fieldId);
    if (!element || element.type === "file" || element.tagName === "SELECT") {
      skipped.push(field.fieldId);
      continue;
    }
    setNativeValue(element, field.proposedValue);
    filled += 1;
  }
  return { filled, skipped, blockers: plan?.blockers?.length || 0, maySubmit: false };
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function labelFor(element) {
  const explicit = element.id
    ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
    : null;
  return explicit?.innerText ||
    element.closest("label")?.innerText ||
    element.getAttribute("aria-label") ||
    element.getAttribute("aria-labelledby") ||
    "";
}

function isVisible(element) {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" &&
    element.getBoundingClientRect().width > 0;
}
