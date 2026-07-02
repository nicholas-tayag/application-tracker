# Safe form-autofill planner

`lib/form-autofill.mjs` is a dependency-free, plan-only boundary between a
prepared application package and a future browser integration. It classifies
observed fields and proposes normalized values only for:

- candidate name
- email
- phone
- LinkedIn
- GitHub
- location
- an explicitly labeled PDF resume path

It does not interact with a browser or mutate third-party pages. It never
submits, clicks a submit control, solves CAPTCHA, generates narrative answers,
answers demographic questions, infers authorization or sponsorship, accepts
legal terms, supplies compensation expectations, or fabricates experience.

## Classification contract

- `auto-fill-safe`: allowlisted identity/contact/location/resume field with a
  valid local value.
- `review-required`: eligibility, legal, salary, long-form, unknown choice, or
  missing allowlisted value.
- `sensitive/voluntary`: demographic and self-identification fields.
- `unsupported`: CAPTCHA, unknown attachment, or field outside the allowlist.
- `final-submit`: final application action, always excluded from execution.

`buildAutofillPlan()` always returns `maySubmit: false` and a mandatory review
boundary. A future browser adapter must treat every blocker as unresolved,
present all proposed values for review, and require the person applying to take
the final submission action.
