import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutofillPlan,
  classifyFormField,
  CLASSIFICATIONS
} from "../lib/form-autofill.mjs";

const profile = {
  fullName: "Nicholas Tayag",
  email: "Nicholas.Tayag@Example.com",
  phone: "904-770-1251",
  linkedin: "linkedin.com/in/nicholastayag?tracking=bad",
  github: "https://github.com/nicholas-tayag/",
  location: "Gainesville, FL",
  workAuthorization: "do not use this",
  salary: "$999,999"
};

const applicationPackage = {
  resumePath: "/private/applications/example/general-swe.pdf",
  coverLetter: "This must not be used as an autofill value."
};

test("plans normalized values for the narrow safe-field allowlist", () => {
  const plan = buildAutofillPlan([
    { id: "first_name", label: "First Name", required: true },
    { id: "last_name", label: "Last Name", required: true },
    { name: "email", autocomplete: "email", required: true },
    { name: "phone", label: "Mobile phone" },
    { name: "linkedin", label: "LinkedIn profile URL" },
    { name: "github", label: "GitHub" },
    { name: "location", label: "Current location" },
    { name: "resume", label: "Resume upload", type: "file", accept: ".pdf" }
  ], profile, applicationPackage);

  assert.equal(plan.counts[CLASSIFICATIONS.SAFE], 8);
  assert.deepEqual(
    plan.fields.map((field) => field.proposedValue),
    [
      "Nicholas",
      "Tayag",
      "nicholas.tayag@example.com",
      "(904) 770-1251",
      "https://linkedin.com/in/nicholastayag",
      "https://github.com/nicholas-tayag",
      "Gainesville, FL",
      "/private/applications/example/general-swe.pdf"
    ]
  );
});

test("recognizes Greenhouse-style field names and Lever-style labels", () => {
  assert.equal(
    classifyFormField({ name: "job_application[first_name]" }, profile).kind,
    "firstName"
  );
  assert.equal(
    classifyFormField({ label: "GitHub profile", name: "urls[GitHub]" }, profile).kind,
    "github"
  );
});

test("never proposes work authorization, sponsorship, or citizenship answers", () => {
  for (const label of [
    "Are you legally authorized to work in the United States?",
    "Will you now or in the future require sponsorship?",
    "Country of citizenship",
    "Current visa status"
  ]) {
    const field = classifyFormField({ label, type: "select", required: true }, profile);
    assert.equal(field.classification, CLASSIFICATIONS.REVIEW);
    assert.equal(field.proposedValue, undefined);
    assert.equal(field.kind, "workAuthorization");
  }
});

test("never answers voluntary demographic questions", () => {
  const fields = [
    { label: "Gender", type: "select" },
    { label: "Race / ethnicity", type: "select" },
    { label: "Veteran status", type: "radio" },
    { label: "Voluntary disability disclosure", type: "checkbox" },
    { label: "Pronouns", type: "text" }
  ];
  for (const input of fields) {
    const field = classifyFormField(input, profile);
    assert.equal(field.classification, CLASSIFICATIONS.SENSITIVE);
    assert.equal(field.proposedValue, undefined);
  }
});

test("requires review for salary and legal attestations", () => {
  const salary = classifyFormField(
    { label: "Desired salary", type: "number", required: true },
    profile
  );
  const attestation = classifyFormField(
    { label: "I certify that this application is accurate", type: "checkbox" },
    profile
  );
  assert.equal(salary.kind, "salaryExpectation");
  assert.equal(attestation.kind, "legalAttestation");
  assert.equal(salary.proposedValue, undefined);
  assert.equal(attestation.proposedValue, undefined);
});

test("treats all long-form questions as review-required without drafting text", () => {
  for (const field of [
    { label: "Why do you want to work here?", type: "text" },
    { label: "Describe a difficult technical project", tagName: "textarea" },
    { placeholder: "Tell us about your experience with distributed systems" }
  ]) {
    const classified = classifyFormField(field, profile, applicationPackage);
    assert.equal(classified.classification, CLASSIFICATIONS.REVIEW);
    assert.equal(classified.kind, "longFormResponse");
    assert.equal(classified.proposedValue, undefined);
  }
});

test("blocks CAPTCHA and human-verification controls", () => {
  for (const field of [
    { name: "g-recaptcha-response", type: "hidden" },
    { id: "hcaptcha", label: "Human verification" },
    { label: "I am not a robot", type: "captcha" }
  ]) {
    const classified = classifyFormField(field, profile);
    assert.equal(classified.classification, CLASSIFICATIONS.UNSUPPORTED);
    assert.equal(classified.kind, "captcha");
  }
});

test("separates final submission from ordinary unsupported buttons", () => {
  const submit = classifyFormField({
    id: "submit_app",
    label: "Submit application",
    tagName: "button",
    type: "submit"
  });
  const next = classifyFormField({
    label: "Next step",
    tagName: "button",
    type: "button"
  });
  assert.equal(submit.classification, CLASSIFICATIONS.SUBMIT);
  assert.equal(next.classification, CLASSIFICATIONS.UNSUPPORTED);
  assert.equal(submit.proposedValue, undefined);
});

test("does not attach unknown files or non-PDF resume paths", () => {
  const portfolio = classifyFormField(
    { label: "Portfolio attachment", type: "file" },
    profile,
    applicationPackage
  );
  const invalidResume = classifyFormField(
    { label: "Resume", type: "file" },
    profile,
    { resumePath: "/tmp/resume.docx" }
  );
  assert.equal(portfolio.classification, CLASSIFICATIONS.UNSUPPORTED);
  assert.equal(invalidResume.classification, CLASSIFICATIONS.REVIEW);
  assert.equal(invalidResume.proposedValue, undefined);
});

test("normalizes only valid email, phone, profile URLs, and PDF paths", () => {
  const unsafeProfile = {
    fullName: "A",
    email: "not-an-email",
    phone: "123",
    linkedin: "https://evil.example/linkedin.com/person",
    github: "http://github.com/person"
  };
  const cases = [
    { label: "Email" },
    { label: "Phone" },
    { label: "LinkedIn" },
    { label: "GitHub" }
  ];
  for (const field of cases) {
    const classified = classifyFormField(field, unsafeProfile);
    assert.equal(classified.classification, CLASSIFICATIONS.REVIEW);
    assert.equal(classified.proposedValue, undefined);
  }
});

test("flags unknown required controls and unknown choices as blockers", () => {
  const plan = buildAutofillPlan([
    { id: "custom", label: "Internal candidate code", required: true },
    { id: "choice", label: "Choose one", type: "radio" },
    { id: "dropdown", label: "Preferred team", type: "select" }
  ], profile, applicationPackage);
  assert.equal(plan.blockers.length, 3);
  assert.equal(plan.fields[0].classification, CLASSIFICATIONS.UNSUPPORTED);
  assert.equal(plan.fields[1].classification, CLASSIFICATIONS.REVIEW);
  assert.equal(plan.fields[2].classification, CLASSIFICATIONS.REVIEW);
});

test("always returns a mandatory, non-submitting human review boundary", () => {
  const plan = buildAutofillPlan(
    [{ label: "Email", required: true }],
    profile,
    applicationPackage
  );
  assert.equal(plan.mode, "plan-only");
  assert.equal(plan.maySubmit, false);
  assert.equal(plan.reviewBoundary.mandatory, true);
  assert.equal(plan.reviewBoundary.finalSubmitExcluded, true);
  assert.equal(plan.readyForHumanReview, true);
});

test("handles malformed input without throwing or leaking arbitrary profile fields", () => {
  const plan = buildAutofillPlan([null, "email", { label: "Favorite framework" }], profile);
  assert.equal(plan.fields.length, 3);
  assert.ok(plan.fields.every((field) => field.proposedValue === undefined));
  assert.doesNotMatch(JSON.stringify(plan), /do not use this|\$999,999/);
});
