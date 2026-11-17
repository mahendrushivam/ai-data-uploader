# DataDesk: Competitor analysis (CSV import and validation)

> **Sources and confidence.** This comes from my knowledge of each product's public website, docs and
> positioning. It was written **without live internet access**, so nothing could be checked against the
> vendors' sites today. Products in this market change quickly: features ship, companies rebrand, and
> pricing moves. Treat every cell as *"to be confirmed"* before this is shared outside the team or used
> for a pricing decision. Cells I'm least sure about are marked **?**. Prices are deliberately left out.

## 1. The market in one paragraph
Most "CSV importer" products are **developer tools**. A SaaS company embeds an import widget in its own
app, and that company's *end users* upload files into it. The developer defines the schema, usually
in code and sometimes in a dashboard. The end user maps columns, fixes errors in the widget, and submits.
**DataDesk is different:** a standalone app where the *same person* defines templates, uploads files and
reads the results, with no developer in the loop. The closest match is the dashboard side of the simpler
importers (CSVBox, UseCSV), combined with a self-serve importer. The other option people use today is
"Excel plus manual checking", which is what DataDesk replaces.

## 2. Who's out there

| Product | What it is | Who configures the schema | Notes |
|---|---|---|---|
| **Flatfile** | Enterprise data onboarding platform. Embeddable importer plus collaborative "Spaces" for customer onboarding | Mostly **developers, in code** (Blueprints/config plus event listeners for custom logic) | Market leader and the most feature-rich. AI-assisted mapping and transforms. Enterprise compliance (SOC 2, HIPAA, GDPR). Sales-led pricing. |
| **OneSchema** | Embeddable CSV importer, plus "FileFeeds" for automated recurring file ingestion | **No-code template dashboard**, plus API | Strong on validation breadth and in-app bulk fixing. Markets speed on large files. Sales-led pricing. |
| **Dromo** | Embeddable importer and headless import API | Code, or a no-code schema builder **?** | AI column matching, in-app fixing, custom hooks. A "private mode" processes data in the browser so it never reaches their servers. |
| **CSVBox** | Lightweight embeddable importer for SMB SaaS | **No-code dashboard** ("sheets" with columns and validations) | Type, required, unique, regex and dropdown validations. Users fix errors in the widget. Import history in the dashboard. Sends data to webhooks, DBs, Sheets and so on. Low entry price, with a free tier. |
| **UseCSV** | Lightweight embeddable importer | **No-code dashboard** ("importers" with columns) | Similar scope to CSVBox: column validation, in-widget fixing, webhook delivery. Free tier. |
| **nuvo** (rebranded **Ingestro** **?**) | Embeddable importer SDK (React/Angular/Vue/JS) | **Developers, in code** (a "target data model") | ML column matching, custom "cleaning functions", review step with fixing. Processes data in the browser, with a GDPR/EU focus. |
| *react-spreadsheet-import* (open source) | MIT React component: upload → map → validate → edit table | Developers, in code | Front end only: no backend, history or templates UI. A useful build-vs-buy reference. |
| *Excel / Google Sheets* | What users actually do today | Each user, per sheet (data validation ranges) | Validation isn't reusable across files, there's no import history and no shareable error report. Power Query can do it, but it's hard to learn. |

## 3. Feature comparison

Legend: ✓ has it · ◐ partly, or needs developer code · ✗ no · **?** unconfirmed.
The last two columns are **DataDesk Phase 1 as scoped**, and what the existing prototype already has.

| Capability | Flatfile | OneSchema | Dromo | CSVBox | UseCSV | nuvo | **DataDesk P1** | Prototype today |
|---|---|---|---|---|---|---|---|---|
| Reusable templates / schemas | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** | ✗ |
| **No-code** template builder for business users | ◐ | ✓ | ◐ **?** | ✓ | ✓ | ✗ | **✓** | ✗ |
| Template versioning, and knowing which version checked a file | ◐ **?** | **?** | **?** | ✗ **?** | ✗ **?** | ✗ **?** | **✓** | ✗ |
| Built-in type checks (number, date, email…) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** (9 types) | ✓ |
| Required / unique / regex / allowed values | ✓ | ✓ | ✓ | ✓ | ◐ **?** | ✓ | **✓** | required only |
| Min/max, length rules | ✓ | ✓ | ✓ | ◐ **?** | **?** | ✓ | **✓** | ✗ |
| Warnings (non-blocking) as well as errors | ✓ | ✓ | ✓ | **?** | **?** | ✓ **?** | **✓** | ✗ |
| Custom logic in code (hooks, webhooks) | ✓ | ✓ | ✓ | ◐ | ◐ | ✓ | ✗ (by design) | ✗ |
| Automatic column matching | ✓ AI | ✓ AI | ✓ AI | ✓ | ✓ | ✓ ML | **✓** name + alias + fuzzy | ✗ |
| **End user adds rules during upload** (ad-hoc) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | ✗ |
| Live validation preview before submitting | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** (whole file) | ✓ |
| **Fix errors inside the app** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✗ (phase 2)** | ✓ grid editing exists |
| Bulk / AI-suggested fixes | ✓ | ✓ | ✓ **?** | ✗ **?** | ✗ **?** | ◐ | ✗ | ✗ |
| Downloadable error report | ◐ **?** | ◐ **?** | **?** | **?** | **?** | **?** | **✓** (2 formats) | ✗ |
| Upload history with status per file | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ **?** | **✓** | ◐ dataset list |
| Server-side validation after upload | ✓ | ✓ | ◐ (optional) | ✓ **?** | **?** | ✗ (browser) | **✓** | ✗ |
| Embeddable in another product | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (standalone) | ✗ |
| Send data to destinations (DB, webhook, Sheets) | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ | CSV export |
| Self-hostable (Docker) | ✗ **?** | ✗ **?** | ✗ **?** | ✗ | ✗ | ✗ | **✓** | n/a |
| Large files | ✓ (millions of rows) | ✓ | ✓ | ◐ | ◐ | ◐ | ✗ (5 MB cap) | ✗ (~5 MB browser storage) |
| Teams and shared templates | ✓ | ✓ | ✓ | ✓ | ✓ **?** | ✓ | ✗ (personal, phase 1) | ✗ |
| SSO, audit, compliance certifications | ✓ | ✓ | ✓ | ◐ | ◐ | ✓ | ✗ | ✗ |

## 4. What this means for DataDesk Phase 1

### Table stakes: Phase 1 covers them
Templates, type checks, required/unique/regex/allowed values, automatic column matching, a clear
error view, and an upload history with statuses. Every competitor has these, and Phase 1 does too.

### The one gap that matters: fixing errors in the app
**Every product in this comparison lets the user fix invalid cells inside the importer.** Phase 1's
agreed flow (download errors → fix in Excel → upload again as a new entry) is simpler to build, but it is
**below the market norm**, and users who have used Flatfile or CSVBox will notice. This is fine for
Phase 1 as long as the flow is smooth:
1. **Catch errors before upload.** Because files are ≤ 5 MB, the browser pre-checks the *whole* file,
   not a sample, using the same rules code as the server (mockups 06 and 07). Most users will see and
   fix their problems before they upload at all.
2. **Make the download do the work.** The *file with errors marked* (mockup 10) is the user's own file
   with an `__errors` column. It can be fixed in Excel and uploaded again **unchanged**, because that
   column is ignored automatically.
3. **Phase 2 is cheap.** The prototype already has a full Excel-style editing grid with validation,
   undo and paste (`src/components/Grid.tsx`). Adding "fix in app and re-validate" mostly means wiring
   that grid to the API. **Recommendation: make this the first Phase 2 item.**

### Where DataDesk can be different
| Angle | Why it's credible |
|---|---|
| **Self-serve for non-developers** | Competitors are mostly sold to engineering teams and need integration work. DataDesk is usable on day one by an analyst or ops person. |
| **Rules added on the fly during upload** | No competitor lets the *uploader* add a rule mid-import and see its effect live (mockup 07). It's useful for one-off files that don't justify a template. |
| **Traceability** | Immutable template versions plus a schema snapshot per upload answer "which rules checked this file?" months later, which suits audit-minded teams. |
| **Self-hosted / data stays in-house** | One `docker compose up` with only Postgres. The SaaS importers store customer data on their servers, except Dromo's and nuvo's browser-only modes. |

### Where not to compete (yet)
Embeddable SDKs, AI transformations, destinations and integrations, enterprise compliance, and very large
files. These are the leaders' strengths, and each is a large investment.

## 5. Ideas to borrow for Phase 2+ (ordered by value ÷ effort)

| # | Idea | Seen in | Effort for DataDesk |
|---|---|---|---|
| 1 | Fix errors in the app, then re-validate | all | **Low to medium**: the grid exists. It needs editable `upload_rows` and a "re-validate" job. |
| 2 | Remember header matches. When a user overrides a match, offer "add 'Ticket #' as an alias?" (saved as a new template version) | Flatfile, OneSchema (learned mappings) | Low |
| 3 | Bulk fixes: find and replace in a column, or "map 'Germany' → 'DE'" for allowed-value errors | OneSchema, Flatfile | Medium |
| 4 | Password reset and email verification, then SSO | all | Low for reset; medium for SSO |
| 5 | Shared templates for teams | all | Medium: `organizations` + `memberships` (see DATABASE.md §8) |
| 6 | Deliver accepted data to a webhook, a database or Google Sheets | CSVBox, UseCSV, Flatfile | Medium |
| 7 | AI-suggested column matches and transformations | Flatfile, OneSchema, Dromo | High. Only worth it once there's real usage data. |

## 6. Before sharing this externally
- [ ] Check each **?** cell against the vendor's current docs.
- [ ] Confirm nuvo's rebrand and current name.
- [ ] Add current list prices if pricing strategy is in scope (deliberately left out here).
- [ ] Add any competitor the team already knows customers are comparing against.
