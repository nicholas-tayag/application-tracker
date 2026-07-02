# Deterministic resume-strength scanner

## Boundary and purpose

`lib/resume-agent.mjs` is an analysis-only, dependency-free local scanner. It
accepts resume text, a job description, role metadata, and a claim registry. It
returns transparent findings and recommendations. It never edits a resume,
submits an application, calls an LLM/API, predicts an employer decision, or
claims to reproduce a proprietary ATS.

The user remains the author: the scanner should be called only after the user
provides or updates a resume.

## Public API

```js
analyzeResumeQuality({
  jobDescription,
  role: { title, company, location, department },
  masterResume: "general_swe" | "ai_engineer",
  claimRegistry: claimObjectsOrCsv,
  resumeText,
  resumeBullets,
  lineLimit,
  maxRecommendations,
  resumeHash,
  previousResumeHash
})
```

The output contains:

- role-family classification and matched signals;
- explicit job-description keyword coverage;
- verified, review-only, and excluded claim groups;
- accomplishment-measurement-method (XYZ) findings;
- weak lead verbs and redundant bullets;
- conservative character-based one-line estimates;
- unsupported metrics and skills;
- hard exclusion of internal-only and PR Review Agent content;
- a component-by-component 100-point writing/evidence rubric;
- recommendations only; and
- SHA-256 cache metadata.

Additional exports:

- `analyzeBullets`
- `analyzeKeywordCoverage`
- `classifyRoleFamily`
- `detectUnsupportedAssertions`
- `parseClaimRegistryCsv`
- `validateBulletAgainstClaim`
- `hashResumeContent`
- `hashResumeFile`
- `shouldAnalyzeResume`

## Evidence policy

| Registry status | Treatment |
| --- | --- |
| `verified` | Eligible for recommendation with measurement and caveat intact. |
| `confirm` | Review queue only. |
| `partial` | Review queue only. |
| `internal-only` | Hard-excluded. |

PR Review Agent, `pr_review_agent`, and NYL-oriented internal architecture
prototype text are hard-excluded regardless of a caller-provided status.

Candidate bullets may not introduce numeric tokens absent from the associated
verified claim. Metric comparison canonicalizes commas, whitespace,
`percent`/`%`, and multiplication symbols. It intentionally does not infer that
different values are equivalent. Causal verbs are also rejected when the
registered claim does not contain the same causal statement.

Unsupported-skill findings mean only that a skill appears in the supplied
resume but not in a verified registry claim. They are prompts for human
verification, not assertions that the person lacks the skill. Job keywords
without verified evidence receive an explicit “do not add” warning.

## Rubric

The score is a reproducible writing/evidence rubric:

| Component | Points |
| --- | ---: |
| Evidence integrity | 30 |
| Explicit keyword coverage | 25 |
| Accomplishment-measurement-method structure | 20 |
| Likely one-line discipline | 15 |
| Master-resume/role-family fit | 10 |

Weak verbs and redundant bullets can deduct up to 15 points. Missing resume
bullets receive no structure or line-fit credit. A prohibited internal claim
removes evidence-integrity credit. The result always exposes component values
and sets `isProbability: false`.

## Hashing and cache behavior

`hashResumeContent(text)` and `hashResumeFile(path)` return SHA-256 hashes.
Callers can persist the previous hash and use
`shouldAnalyzeResume(currentHash, previousHash)` to skip an unchanged resume.
The main result includes `cache.changed` and a versioned `cache.cacheKey`.

Content hashing is exact: whitespace or formatting changes produce a new hash.
When a caller already hashed a source file, it may pass that value as
`resumeHash`; the analyzer still reports its own supplied-text hash for audit.
No cache is written by the module.

## Known limitations

- Keyword recognition uses a finite explicit catalog.
- Claim relevance is lexical and requires human judgment.
- Registry quality depends on the supplied evidence.
- Character counts do not model fonts, margins, LaTeX macros, or glyph widths.
- A rendered PDF remains the authority for page and line fit.
- The scanner cannot infer why an application was rejected.
- The score must not be represented as an ATS rating, hiring probability, or
  causal predictor of application outcomes.
