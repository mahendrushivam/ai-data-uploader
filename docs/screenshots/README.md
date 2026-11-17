# Screenshots of the tested flows (v0.1.0)

Every image here was captured **by the end-to-end tests while they ran** (`npm run e2e:screenshots`), with a
real browser, API, background worker and PostgreSQL. Each one shows a state the test had just verified.
Regenerate them at any time with the same command.

| # | Screen | What the test verified at this point | Spec |
|---|---|---|---|
| 01 | ![](01-sign-up.png) | Sign-up form (name, email, password ≥ 8 characters) | d1-login |
| 02 | ![](02-home-no-uploads-yet.png) | Signed in → "My uploads", empty state | d1-login |
| 03 | ![](03-sign-in-wrong-password.png) | Wrong password → generic "Incorrect email or password." | d1-login |
| 04 | ![](04-template-builder-validation.png) | Builder catches "Minimum is greater than maximum." next to the rule, before saving | d2-default-template |
| 05 | ![](05-template-builder.png) | Fixed: min 0.6 as a **warning** with a custom message; the error cleared live | d2-default-template |
| 06 | ![](06-templates-with-default.png) | Template saved (6 columns · 4 rules) and marked **★ Default** | d2-default-template |
| 07 | ![](07-upload-step1-default-preselected.png) | New upload: the default template is preselected, and its expected columns are listed | d2-default-template |
| 08 | ![](08-upload-step2-mapping-and-precheck.png) | Headers matched; pre-check of every row: 4 errors in 4 rows · 7 warnings | d2-default-template |
| 09 | ![](09-result-failed-validation.png) | Worker finished: Failed validation, 4 errors + 7 warnings, errors filter, fix-and-reupload banner | d3-errors |
| 10 | ![](10-result-data-tab.png) | Data tab: extracted rows, "rows with issues" = 11, error and warning cells marked | d3-errors |
| 11 | ![](11-result-passed-with-warnings.png) | The downloaded "errors marked" file, fixed and re-uploaded → Passed with warnings (opens on Data) | d3-errors |
| 12 | ![](12-upload-no-template-live-rule.png) | No template: type set to Email, "Allowed values" rule added, cells flagged live (3 errors) | d3-errors |
| 13 | ![](13-result-no-template-rule-errors.png) | The worker reports the same rule errors after upload | d3-errors |
| 14 | ![](14-result-parse-errors.png) | Parsing problems: unclosed quote, short row, missing required column | d3-errors |
| 15 | ![](15-result-couldnt-read-file.png) | Non-UTF-8 file → "Couldn't read file" with the exact byte and line | d3-errors |
| 16 | ![](16-list-with-queued-upload.png) | Worker paused: queued upload visible with banner, spinner and "waiting" timer | listing |
| 17 | ![](17-list-all-finished.png) | Worker resumed: the queued row finished without a page reload | listing |
| 18 | ![](18-list-filtered-failed.png) | Status filter "Failed validation" → 1 upload | listing |
| 19 | ![](19-remove-upload-dialog.png) | Remove → centred confirmation dialog (Cancel focused; Escape cancels) | listing |
| 20 | ![](20-delete-template-dialog.png) | Template delete uses the same dialog and says uploads keep their results | listing |
| 21 | ![](21-other-users-upload-not-found.png) | Another user opening someone else's upload → "Upload not found." with a way back | listing |
