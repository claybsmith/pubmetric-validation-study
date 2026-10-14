# TXA rerun on prompt P2: results (post hoc, run 2026-10-14)

Plan: PLAN.md (written before the run). All 31 articles extracted on gemini-3.1-pro-preview (01-2026), P2 code from commit 87b0d0d, temperature unset (default 1.0). Five articles timed out once and succeeded on the permitted retry; one was uploaded from an ASCII-named copy (as production did). Raw outputs: raw/ (one JSON file per article, plus raw/run_log.txt). Scoring: score_p2.py -> results/. The extraction script is not included because it contains the full extraction prompt, which is proprietary; it is available on request, consistent with the redaction of prompts elsewhere in this repository.

Reference: the paper's TXA post-adjudication reference (P1 and Claude agreement plus 33 adjudicated cells); 7 ambiguous cells excluded. Note this reference is largely AI agreement, not independent human extraction.

## Outcome selection
- Reference outcomes found in the P2 run: 417 of 527 (79%). The P2 run also extracted 40 outcomes not in the reference.
- Outcome selection varied between runs (temperature 1.0): e.g., P2 omitted Khan cause-of-death categories, Howard subsample analyses, Valle transfusion volumes.

## Accuracy on matched outcomes (2,043 cells)
| | Correct |
|---|---|
| P1 (reported run), same cells | 2,031 (99.4%) |
| P2 rerun | 1,975 (96.7%) |

The 68 P2 differences:
- 50 cells in two multi-arm trials (Rowell 48, Morrison 2013 2): P1 summed two TXA arms (e.g., 657 = 312 + 345); P2 used a single TXA arm (312). Arm choice, not misreading.
- 16 cells left blank by P2 (Guyette INR medians/IQR 6, Harvin day-count N 6, Shiraishi means 4).
- 2 cells incorrect: Guyette INR N, 447/453 (column header) vs 422/433 (table footnote e). Footnote-denominator miss.

Excluding the two multi-arm trials: P2 1,913 / 1,931 (99.1%); P1 1,931 / 1,931 (100%).

## Outcome matching
Outcomes were matched one-to-one within each study by name, timepoint and data type; renamed outcomes were also accepted when all of their numbers agreed (at least 2). Every pairing is listed in results/outcome_matching.csv for review. Because number agreement can confirm a match, unmatched outcomes may include a few true matches whose numbers differ.
