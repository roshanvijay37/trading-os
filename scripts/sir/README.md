# Karnataka SIR part-wise — daily snapshot + diff

Powers the page at **https://roshanvijay.com/sir.html** ([public/sir.html](../../public/sir.html)).

Each day a `Karnataka_SIR_PART_WISE.xlsx` is received (~4pm). It is the ECI **SIR
Enumeration-Form tracking** report, one row per polling **Part** within an Assembly
Constituency (AC 201 *Moodabidri*, parts 1–219). All columns are **aggregate counts**
(no personal data).

## What gets stored

- `public/data/sir/<YYYY-MM-DD>.json` — one normalized snapshot per day.
- `public/data/sir/index.json` — `{ "dates": [...], "latest": "..." }`.

Snapshot shape:

```json
{ "date":"2026-06-30", "source":"Karnataka_SIR_PART_WISE", "sheet":"EnumFormTracking",
  "key":["AC Number","Part Number"],
  "labels":["State Name","District Number","District Name","AC Number","Asmbly Name","Part Number"],
  "metrics":["Total Elector","Total EFs Printed", ... ,"EF Parts Downloaded"],
  "columns":[...all headers in order...],
  "rows":[ {"AC Number":201,"Part Number":1,"Total Elector":1368, ...}, ... ] }
```

The page reads `key`/`labels`/`metrics`/`columns` from the JSON, so if the ECI ever
adds/renames columns the page adapts without code changes.

## Daily procedure

```bash
# 1. parse the day's file (date = the day it was received)
scripts/sir/parse-xlsx.sh ~/Downloads/Karnataka_SIR_PART_WISE.xlsx 2026-07-01 \
  > public/data/sir/2026-07-01.json

# 2. add the date to the index (keep dates sorted ascending)
#    edit public/data/sir/index.json -> "dates":[...,"2026-07-01"], "latest":"2026-07-01"

# 3. commit + push -> GitHub Pages redeploys
git add public/data/sir && git commit -m "data(sir): 2026-07-01 snapshot" && git push origin main
```

The page shows the **latest** snapshot and the day-over-day **difference vs the
previous date** (added / removed parts, and every metric that changed, old→new with
deltas). The diff is computed in the browser, so adding one JSON per day is all that's
needed — `sir.html` itself never changes.

## Notes

- Key is `(AC Number, Part Number)` — robust if future files include more ACs.
- `parse_sir.pl` handles shared-strings, inline numbers (`1368.0` → `1368`), and XML
  entity unescaping.
- **Fallback:** if a future `.xlsx` ever fails to parse, open it and *Save As CSV* —
  a CSV is trivially convertible; ping for a one-off CSV path in `parse_sir.pl`.
- The diff only appears once there are **two** dates in `index.json` (Day 1 = baseline).
