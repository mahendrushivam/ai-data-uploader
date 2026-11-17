# Test fixtures

Exported from the dev seed (`db/seeds/dev_seed.sql`), so tests, the demo data and the mockups all use
identical bytes.

| File | Used for | Expected result against "Support tickets v2" |
|---|---|---|
| `tickets_oct.csv` | the file with the 4 planted mistakes | `failed_validation`: 4 errors (rows 4, 12, 18, 26), 7 low-confidence warnings |
| `tickets_oct_fixed.csv` | the corrected re-upload | `passed_with_warnings`: 0 errors, 7 warnings |
| `legacy_latin1.csv` | a file that isn't UTF-8 | `error`: "The file is not valid UTF-8" |
