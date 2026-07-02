const CLASSIFICATIONS = Object.freeze({
  SAFE: "auto-fill-safe",
  REVIEW: "review-required",
  SENSITIVE: "sensitive/voluntary",
  UNSUPPORTED: "unsupported",
  SUBMIT: "final-submit"
});

const SENSITIVE_PATTERN =
  /\b(gender|sex|race|ethnic|ethnicity|veteran|disability|disabled|pronouns?|sexual orientation|transgender|demographic|eeo|equal employment|self[- ]identify|voluntary disclosure)\b/i;
const AUTHORIZATION_PATTERN =
  /\b(work authorization|authorized to work|legally authorized|right to work|visa|immigration|sponsor|sponsorship|citizen|citizenship|employment eligibility)\b/i;
const LEGAL_PATTERN =
  /\b(attest|attestation|certify|certification|acknowledge|acknowledgement|agree|agreement|terms|privacy policy|accurate|truthful|signature|electronic signature|background check|drug test|arbitration|conflict of interest|non[- ]compete)\b/i;
const SALARY_PATTERN =
  /\b(salary|compensation|pay expectation|expected pay|desired pay|desired rate|hourly rate)\b/i;
const CAPTCHA_PATTERN = /\b(captcha|recaptcha|hcaptcha|human verification|not a robot)\b/i;
const SUBMIT_PATTERN =
  /\b(submit|send application|apply now|complete application|finish application)\b/i;
const COVER_LETTER_PATTERN = /\b(cover letter|letter of interest)\b/i;

const SAFE_PATTERNS = [
  ["firstName", /\b(first|given)\s*name\b/i],
  ["lastName", /\b(last|family|sur)\s*name\b/i],
  ["fullName", /\b(full|legal|candidate|your)\s*name\b|^name$/i],
  ["email", /\b(e[- ]?mail|email address)\b/i],
  ["phone", /\b(phone|telephone|mobile|cell)(?:\s*(?:number|no))?\b/i],
  ["linkedin", /\b(linked\s*in|linkedin)(?:\s*(?:url|profile))?\b/i],
  ["github", /\b(git\s*hub|github)(?:\s*(?:url|profile))?\b/i],
  ["location", /\b(current\s*)?(location|city(?:\s*(?:and|\/)\s*state)?|address city|home base)\b/i],
  ["resumePath", /\b(r[eé]sum[eé]|cv|curriculum vitae)(?:\s*(?:upload|file|attachment))?\b/i]
];

/**
 * Classify one normalized or browser-observed form field without mutating it.
 * Values are returned only for the narrow safe-field allowlist.
 */
export function classifyFormField(field, profile = {}, applicationPackage = {}) {
  const normalized = normalizeField(field);
  const descriptor = fieldDescriptor(normalized);

  if (isCaptcha(normalized, descriptor)) {
    return result(normalized, CLASSIFICATIONS.UNSUPPORTED, "captcha", {
      blocker: "CAPTCHA or human verification must be completed manually."
    });
  }

  if (isFinalSubmit(normalized, descriptor)) {
    return result(normalized, CLASSIFICATIONS.SUBMIT, "finalSubmit", {
      blocker: "Final application submission always requires explicit human review and action."
    });
  }

  if (SENSITIVE_PATTERN.test(descriptor)) {
    return result(normalized, CLASSIFICATIONS.SENSITIVE, "voluntaryDemographic", {
      blocker: normalized.required
        ? "A sensitive or demographic question is marked required and must be reviewed manually."
        : "Voluntary demographic questions are never answered automatically."
    });
  }

  if (AUTHORIZATION_PATTERN.test(descriptor)) {
    return result(normalized, CLASSIFICATIONS.REVIEW, "workAuthorization", {
      blocker: "Work authorization, citizenship, visa, and sponsorship answers must be verified manually."
    });
  }

  if (SALARY_PATTERN.test(descriptor)) {
    return result(normalized, CLASSIFICATIONS.REVIEW, "salaryExpectation", {
      blocker: "Salary and compensation expectations are never supplied automatically."
    });
  }

  if (LEGAL_PATTERN.test(descriptor) || isLegalControl(normalized)) {
    return result(normalized, CLASSIFICATIONS.REVIEW, "legalAttestation", {
      blocker: "Legal attestations, signatures, acknowledgements, and consent controls require manual review."
    });
  }

  if (COVER_LETTER_PATTERN.test(descriptor)) {
    return result(normalized, CLASSIFICATIONS.REVIEW, "coverLetter", {
      blocker: "Cover letters and other narrative attachments require human review."
    });
  }

  if (isLongForm(normalized)) {
    return result(normalized, CLASSIFICATIONS.REVIEW, "longFormResponse", {
      blocker: "Long-form application questions require a truthful, job-specific human-reviewed response."
    });
  }

  const safeKey = detectSafeKey(normalized, descriptor);
  if (safeKey) {
    const value = safeCandidateValue(safeKey, profile, applicationPackage);
    if (value) {
      return result(normalized, CLASSIFICATIONS.SAFE, safeKey, {
        proposedValue: value
      });
    }
    return result(normalized, CLASSIFICATIONS.REVIEW, safeKey, {
      blocker: `${humanize(safeKey)} is missing from the local candidate profile or application package.`
    });
  }

  if (normalized.type === "file") {
    return result(normalized, CLASSIFICATIONS.UNSUPPORTED, "unknownFile", {
      blocker: "Only an explicitly labeled resume/CV file may be planned for automatic attachment."
    });
  }

  if (["checkbox", "radio"].includes(normalized.type)) {
    return result(normalized, CLASSIFICATIONS.REVIEW, "unrecognizedChoice", {
      blocker: "Unrecognized checkbox and radio answers require manual review."
    });
  }

  if (normalized.type === "select" || normalized.tagName === "select") {
    return result(normalized, CLASSIFICATIONS.REVIEW, "unrecognizedSelect", {
      blocker: "Unrecognized select fields require manual option review."
    });
  }

  return result(normalized, CLASSIFICATIONS.UNSUPPORTED, "unrecognizedField", {
    blocker: normalized.required
      ? "A required field could not be safely classified."
      : "Field is outside the safe autofill allowlist."
  });
}

/**
 * Produce a non-executable fill plan. Consumers must preserve the mandatory
 * review boundary and must not interpret this result as permission to submit.
 */
export function buildAutofillPlan(fields, profile = {}, applicationPackage = {}) {
  const input = Array.isArray(fields) ? fields : [];
  const plannedFields = input.map((field) =>
    classifyFormField(field, profile, applicationPackage)
  );
  const blockers = plannedFields
    .filter((field) => field.blocker)
    .map((field) => ({
      fieldId: field.fieldId,
      classification: field.classification,
      reason: field.blocker,
      required: field.required
    }));
  const counts = Object.fromEntries(
    Object.values(CLASSIFICATIONS).map((classification) => [
      classification,
      plannedFields.filter((field) => field.classification === classification).length
    ])
  );

  return {
    version: 1,
    mode: "plan-only",
    maySubmit: false,
    fields: plannedFields,
    blockers,
    counts,
    readyForHumanReview: plannedFields.length > 0,
    reviewBoundary: {
      mandatory: true,
      finalSubmitExcluded: true,
      statement:
        "Review every proposed value and manually answer all blocked, sensitive, eligibility, legal, compensation, narrative, and verification fields. This plan never submits an application."
    }
  };
}

export { CLASSIFICATIONS };

function normalizeField(field) {
  const source = field && typeof field === "object" && !Array.isArray(field) ? field : {};
  return {
    id: clean(source.id, 200),
    name: clean(source.name, 300),
    label: clean(source.label || source.ariaLabel, 1000),
    placeholder: clean(source.placeholder, 500),
    type: clean(source.type, 80).toLowerCase() || "text",
    tagName: clean(source.tagName || source.tag, 80).toLowerCase(),
    required: Boolean(source.required || source.ariaRequired === true || source.ariaRequired === "true"),
    autocomplete: clean(source.autocomplete || source.autoComplete, 120).toLowerCase(),
    options: Array.isArray(source.options)
      ? source.options.slice(0, 200).map((option) =>
          clean(typeof option === "object" ? option.label ?? option.value : option, 300)
        )
      : [],
    text: clean(source.text || source.context, 1000),
    accept: clean(source.accept, 200).toLowerCase()
  };
}

function fieldDescriptor(field) {
  return [
    field.id,
    field.name,
    field.label,
    field.placeholder,
    field.autocomplete,
    field.text,
    field.options.join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[_[\]().:/\\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function isCaptcha(field, descriptor) {
  return CAPTCHA_PATTERN.test(descriptor) ||
    field.type === "captcha" ||
    /\b(g-recaptcha-response|h-captcha-response)\b/i.test(field.name);
}

function isFinalSubmit(field, descriptor) {
  if (field.type === "submit") return true;
  return ["button", "input"].includes(field.tagName) &&
    field.type === "button" &&
    SUBMIT_PATTERN.test(descriptor);
}

function isLegalControl(field) {
  if (!["checkbox", "radio"].includes(field.type)) return false;
  return /\b(consent|authorization|policy|terms|certif|signature|acknowledg)\b/i.test(
    `${field.name} ${field.id}`
  );
}

function isLongForm(field) {
  return field.tagName === "textarea" ||
    field.type === "textarea" ||
    /\b(why|describe|explain|tell us|additional information|experience with|interest in)\b/i.test(
      `${field.label} ${field.placeholder} ${field.text}`
    );
}

function detectSafeKey(field, descriptor) {
  const autocompleteMap = {
    name: "fullName",
    "given-name": "firstName",
    "family-name": "lastName",
    email: "email",
    tel: "phone",
    "address-level2": "location"
  };
  if (autocompleteMap[field.autocomplete]) return autocompleteMap[field.autocomplete];
  for (const [key, pattern] of SAFE_PATTERNS) {
    if (!pattern.test(descriptor)) continue;
    if (key === "resumePath" && field.type !== "file") continue;
    if (key !== "resumePath" && field.type === "file") continue;
    return key;
  }
  return "";
}

function safeCandidateValue(key, profile, applicationPackage) {
  const safeProfile = profile && typeof profile === "object" ? profile : {};
  const safePackage =
    applicationPackage && typeof applicationPackage === "object" ? applicationPackage : {};
  const fullName = clean(safeProfile.fullName, 300);
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const values = {
    fullName,
    firstName: clean(safeProfile.firstName, 150) || nameParts[0] || "",
    lastName: clean(safeProfile.lastName, 150) || nameParts.slice(1).join(" "),
    email: normalizeEmail(safeProfile.email),
    phone: normalizePhone(safeProfile.phone),
    linkedin: normalizeProfileUrl(safeProfile.linkedin, "linkedin.com"),
    github: normalizeProfileUrl(safeProfile.github, "github.com"),
    location: clean(safeProfile.location, 300),
    resumePath: normalizeResumePath(
      safePackage.resumePath ||
      safePackage.resume?.path ||
      safePackage.files?.resume
    )
  };
  return values[key] || "";
}

function result(field, classification, kind, extra = {}) {
  return {
    fieldId: field.id || field.name || `unnamed-${kind}`,
    label: field.label,
    name: field.name,
    type: field.type,
    required: field.required,
    classification,
    kind,
    proposedValue: extra.proposedValue,
    blocker: extra.blocker
  };
}

function normalizeEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizePhone(value) {
  const phone = clean(value, 80);
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return "";
}

function normalizeProfileUrl(value, expectedHost) {
  const raw = clean(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || !hostMatches(url.hostname, expectedHost)) return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function hostMatches(hostname, expectedHost) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === expectedHost || host.endsWith(`.${expectedHost}`);
}

function normalizeResumePath(value) {
  const path = clean(value, 4000);
  if (!path || path.includes("\0") || !/\.pdf$/i.test(path)) return "";
  return path;
}

function clean(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function humanize(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}
