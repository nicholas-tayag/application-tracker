# Nick's Job List

Local new-grad application operating system for SWE, AI/ML, cloud, and platform
roles. It combines a curated role catalog with durable application state,
funnel analytics, and CSV interoperability.

## Run

```powershell
npm start
```

Then open http://localhost:4177.

## What It Does

- Ranks roles by pay, location, fit, chance, company signal, and freshness.
- Tracks status, application and response dates, deadlines, follow-ups, resume versions, and notes.
- Persists tracker state through a revisioned local API with atomic writes and
  browser fallback.
- Imports existing CSV trackers by URL or exact company/title/location and
  reports unmatched rows instead of inventing roles.
- Exports the complete application history.
- Measures submitted applications, OA/screen conversion, rejection rate,
  pending responses, median response latency, and upcoming follow-ups.
- Filters by role-derived tags, state, location text, pay, chance, status, remote, and known pay.
- Includes a dream-company tab and notification badge for future automation updates.
- Prepares human-reviewed application packages from the General SWE or AI
  Engineer master resume using evidence-backed claims and job keywords.
- Batch-prepares the next three highest-ranked, unprepared direct-link roles.
- Requires four explicit review checks before an application can enter the
  approved-for-manual-submit stage.
- Tracks application-agent stages, stale submissions, and funnel conversion
  without guessing why an employer rejected an application.

## Apply Prep Scanner

The local scanner is the fastest safe workflow for tailoring a resume before a
manual application:

1. Open http://localhost:4177.
2. In **Apply prep scanner**, upload a `.txt`, `.md`, or `.tex` resume, or paste
   resume text directly.
3. Save the resume locally if you want the browser to reuse it on future scans.
4. Paste a direct employer/ATS job link and choose **Scan and tailor**.
5. Use the **Top changes** card and exact line edits to update your own master
   resume before applying manually.
6. Copy or download the deterministic tailoring brief when you want a smaller
   context packet for an LLM/recruiter judge.

Resume text is stored only in browser `localStorage` when you click save. The
scanner produces recommendations, keyword gaps, ATS/readability checks,
evidence-backed claims, and a compact `contextAgent` packet; it does not edit,
upload, or submit resumes.

For a terminal-only deterministic brief:

```bash
npm run tailoring:brief -- \
  --resume-file /path/to/master-resume.md \
  --url "https://company.example/jobs/123"
```

Generated briefs are written under `qa/tailoring-briefs/` by default. They are
designed to be small enough to pass to an LLM without sending the full job page,
full resume, and full claim registry.

## Application Agent Safety

The application agent is intentionally human-in-the-loop:

- It can select a master resume, produce a local review package, identify
  keywords, surface eligibility blockers, and prepare safe autofill plans.
- It never submits an application automatically.
- Submission and downstream stages cannot bypass the review-approval gate.
- Work authorization, sponsorship, legal attestations, salary expectations,
  demographic questions, CAPTCHA, and final submission always require review.
- Screening diagnoses are labeled as hypotheses unless direct recruiter
  evidence confirms a reason.

Prepared application state and packages are stored under
`~/.application-tracker/` by default and are never served as static files.

## Safe Autofill Extension

The unpacked Chrome extension in `extension/` connects only to the local
tracker. In `chrome://extensions`, enable Developer mode, choose **Load
unpacked**, and select that directory.

On a prepared direct employer/ATS page, it can inspect visible fields and fill
only basic contact information allowed by the local plan. Browsers prohibit
automatic file-input assignment, so resume upload remains manual. It never
answers eligibility, compensation, legal, demographic, CAPTCHA, or narrative
questions and never clicks a submit control.

## Verify

```bash
npm test
npm run check
npm run benchmark
npm run import:audit -- /path/to/application_tracker.csv
curl http://localhost:4177/api/health
```

The benchmark writes reproducible raw results to
`benchmarks/latest-results.json`. It measures the checked-in catalog,
deterministic CSV imports, synthetic funnel analytics, and local atomic-write
behavior; it does not claim users, production traffic, or distributed scale.

The default state file is `~/.application-tracker/tracker-state.json`; personal
application notes remain outside the repository.
