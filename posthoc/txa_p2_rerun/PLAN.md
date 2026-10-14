# TXA rerun on prompt P2: pre-specified plan

Written 2026-10-14 11:54 CDT, before any extraction was run. Approved by Clay Smith ("We should run this," 2026-10-14).

**Question:** How does PubMetric's TXA extraction on prompt P2 (the prompt used for the reported TNK run 2) compare with the reported TXA run on prompt P1?

**Articles:** the same 31 TXA PDFs as the reported run (Research/TXA SR-MA PDFs).

**Prompt and code:** exactly as deployed May 7, 2026, commit 87b0d0d: the same system instruction, design classification text, JSON template, PDF upload method, and server post-processing (n = 1 placeholder removal, mean/median outcome split, hollow-extraction retry with 2 attempts). Run by a standalone script that reuses that code verbatim. It does not touch the live app, production data, or any user account.

**Model and settings:** gemini-3.1-pro-preview; temperature not specified (API default, 1.0), matching TNK run 2; design not forced (automatic classification, the default upload path). If gemini-3.1-pro-preview is no longer available, stop and report before using any other model.

**Runs:** one extraction per article. An article that fails after the code's own 2 attempts is retried once more and the failure is recorded; no other reruns, and no outcomes are added or edited by hand.

**Scoring:** each numeric cell compared with the TXA post-adjudication values in the public repo (data/txa_validation_comparison.csv), matched by study, outcome and field. Outcomes are matched by name and timepoint, with a written mapping for any matched by hand. Reported: cells correct / cells compared, cells not found in the P2 run, and P2 outcomes not in the reference, alongside the reported P1 figures on the same cells.

**Reporting:** the result is reported whatever it shows. This is a post hoc analysis, run October 2026, and will be labeled as such.

**Expected cost:** about USD 7–10 in Gemini API usage.
2026-10-14 11:57 CDT Model check: models/gemini-3.1-pro-preview, version 3.1-pro-preview-01-2026 (available). Run started.
2026-10-14 11:57 CDT Attempt 1 aborted: wrapper bug (missing 'path' import in the local wrapper) failed every article before any API call; no extractions occurred. Fixed and restarted. Log kept in aborted_attempt_1/.
2026-10-14 11:57 CDT Also removed one copied server line that names the cloud-storage file (not used locally; it does not affect the prompt or model call).
2026-10-14 11:57 CDT Run restarted.
2026-10-14 12:31 CDT p2txa-11 failed both attempts before reaching the model: its file name contains a curly apostrophe (U+2019) that the upload header cannot encode. Production avoided this by renaming uploads to ASCII (the removed safeName line). Rerunning that article from an ASCII-named copy, matching production behavior.
2026-10-14 12:41 CDT Run complete: 31/31 extracted. Results in RESULTS.md.
