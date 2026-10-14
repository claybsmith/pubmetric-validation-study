# Evaluating the Data Extraction Accuracy of PubMetric — Data and Analysis Code

Replication materials for:

> Smith C, et al. "Evaluating the Data Extraction Accuracy of PubMetric: A Conditional Accuracy Assessment." *[Journal TBD]* [Year TBD]. doi: [TBD]

PubMetric is described in: Smith C, et al. (2026). *Academic Emergency Medicine*. doi:[10.1111/acem.70326](https://doi.org/10.1111/acem.70326)

---

## Repository Structure

```
pubmetric-validation-study/
├── analysis/
│   ├── 01_txa_validation_analysis.R        # Primary TXA accuracy analysis (PM vs Claude, vs human)
│   ├── 02_tnk_ground_truth_analysis.R      # TNK accuracy vs ground truth
│   ├── dual_ai_validation_redacted.cjs     # Claude API extraction script (prompts redacted)
│   └── [03_pubmetric_export_reitsma.R]     # Reitsma/SROC analysis — see note below
├── data/
│   ├── txa_validation_comparison.csv       # TXA: PM vs Claude side-by-side comparison (long format)
│   └── tnk_ground_truth.csv               # TNK: PM vs ground truth (long format)
├── supplementary/
│   ├── pubmetric_extraction_report_txa.html  # Full PM extraction report — TXA SR-MA
│   └── pubmetric_extraction_report_tnk.html  # Full PM extraction report — TNK SR-MA
└── session_info.txt                        # R session info for reproducibility
```

---

## Data

### `data/txa_validation_comparison.csv`
Long-format comparison table for the TXA (tranexamic acid) evaluation. Each row is one outcome field from one study. Columns include:
- `study_id` — study identifier
- `outcome_name`, `outcome_data_type`, `outcome_timepoint`
- `pm_*` — values extracted by PubMetric
- `claude_*` — values extracted independently by Claude (Anthropic)
- `match_pre`, `match_post` — agreement before and after adjudication
- `clay_comment` — adjudicator notes

### `data/tnk_ground_truth.csv`
Long-format comparison table for the TNK (tenecteplase) evaluation against an adjudicated ground truth (three-physician consensus). Columns follow the same structure with `ground_truth_*` fields.

---

## Analysis Scripts

### `01_txa_validation_analysis.R`
Computes:
- Overall PM vs Claude agreement rate with Wilson 95% CI
- Numeric-only and post-adjudication agreement
- Study-level agreement by trial (Walker, Morrison, Moore)
- Cohen's kappa and weighted kappa for categorical fields
- Saves results to `output/txa_validation_stats_full.csv`

**Required packages:** `irr`, `psych`, `dplyr`

### `02_tnk_ground_truth_analysis.R`
Computes PM accuracy vs the adjudicated ground truth for the TNK SR-MA dataset.

**Required packages:** `irr`, `psych`, `dplyr`

### `dual_ai_validation_redacted.cjs`
Node.js script that exports study data from Firestore, sends PDFs to the Claude API for independent extraction, and produces the side-by-side comparison CSV. The extraction prompts have been redacted and are available on request from the corresponding author (clay@journalfeed.org) to prevent gaming of future validation studies.

**Requirements:** Node.js ≥ 18, `@anthropic-ai/sdk`, Firebase service account credentials.

---

## How to Run

```r
# Install required packages (once)
install.packages(c("irr", "psych", "dplyr", "mada"))

# Create output directory
dir.create("output", showWarnings = FALSE)

# Run TXA analysis
source("analysis/01_txa_validation_analysis.R")

# Run TNK analysis
source("analysis/02_tnk_ground_truth_analysis.R")
```

Scripts expect to be run from the `pubmetric-validation-study/` root directory. Output CSVs will be written to `output/` (not tracked in git).

---

## Supplementary HTML Reports

The `.html` files in `supplementary/` are the full PubMetric extraction reports generated at the time of extraction (May 2026). They show every outcome extracted, source quotes, risk-of-bias assessments, and AI confidence flags as they appeared in the PubMetric interface.

---

## Citation

If you use these materials, please cite:

> Smith C, et al. *[Full citation — TBD upon acceptance]*

And the PubMetric platform paper:

> Smith C, Rouleau S, Smith J, Long B. (2026). PubMetric: AI-assisted systematic review and meta-analysis. *Academic Emergency Medicine*. doi:10.1111/acem.70326

---

## Contact

Clay Smith — clay@journalfeed.org  
Corresponding author for data access and prompt availability requests.

---

## TNK run 1 (added October 2026)

PubMetric extracted the four TNK trials twice. **Run 1** (May 6, 2026) used prompt version P1, the same prompt as the final TXA extraction. After run 1, the denominator rule in the extraction prompt was rewritten, and **run 2** (May 7, 2026) used the revised prompt (P2). Run 2 is the run originally reported. Both runs are now provided so readers can see the effect of the prompt revision.

The run 1 project was later deleted from the application; the file below is the extraction export saved at the time (created May 6, 2026, 20:27 CDT) and is included unchanged.

| File | Contents |
|---|---|
| `data/tnk_run1_validation_table_s1eXSMfUh2LF28hgzCoV.csv` | Run 1 extraction export, unchanged (70 outcomes). Rows marked `was_edited = YES` are the application's automatic n = 1 placeholders on precalculated outcomes; no values were changed by hand. |
| `data/tnk_run1_vs_adjudicated_ground_truth.csv` | Run 1 scored cell by cell against the adjudicated ground truth (`data/tnk_ground_truth.csv`), on the same 247 cells used for run 2. |
| `data/tnk_side_by_side.csv` | For each of the 247 cells: adjudicated ground truth, both human extractors, PubMetric run 1, PubMetric run 2, and Claude, with match flags. |
| `analysis/04_tnk_run1_score.py` | Reproduces the run 1 score (Python 3, standard library only): `python3 analysis/04_tnk_run1_score.py` |

**Results against the adjudicated ground truth (three-physician consensus), 247 cells:**

| Extractor | Correct |
|---|---|
| PubMetric run 1 (P1) | 237 (96.0%) |
| PubMetric run 2 (P2) | 245 (99.2%) |
| Human extractor (B. Long) | 239 (96.8%) |
| Human extractor (S. Rouleau) | 232 (93.9%) |
| Claude | 247 (100%) |

All 10 run 1 errors were denominators in Albers et al.: run 1 applied the randomized N (228/230) to every efficacy outcome. Run 2 corrected 8 of the 10; the median modified Rankin scale denominator (228/230 vs 226/229) remained incorrect. Run 1 and run 2 agreed on 239 of 247 cells; the 8 differences are the corrected Albers denominators. Run 1 also extracted 15 outcomes (subgroups and hemorrhage-severity categories) that are not in the adjudicated ground truth and are not scored.

TXA and TNK were development sets: the extraction prompt was revised using them, so accuracy on these sets is in-sample and may overestimate performance on new articles. Gemini temperature was not specified for these extractions (API default, 1.0).
