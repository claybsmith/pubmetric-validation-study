# PubMetric Validation Study — Data and Analysis Code

Replication materials for:

> Smith C, et al. "Accuracy of AI-assisted systematic review data extraction using PubMetric: a prospective validation study." *[Journal TBD]* [Year TBD]. doi: [TBD]

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
Long-format comparison table for the TXA (tranexamic acid) validation. Each row is one outcome field from one study. Columns include:
- `study_id` — study identifier
- `outcome_name`, `outcome_data_type`, `outcome_timepoint`
- `pm_*` — values extracted by PubMetric
- `claude_*` — values extracted independently by Claude (Anthropic)
- `match_pre`, `match_post` — agreement before and after adjudication
- `clay_comment` — adjudicator notes

### `data/tnk_ground_truth.csv`
Long-format comparison table for the TNK (tenecteplase) validation against a pre-specified ground truth. Columns follow the same structure with `ground_truth_*` fields.

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
Computes PM accuracy vs pre-specified ground truth for the TNK SR-MA dataset.

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

The `.html` files in `supplementary/` are the full PubMetric extraction reports generated at the time of the validation study. They show every outcome extracted, source quotes, risk-of-bias assessments, and AI confidence flags as they appeared in the PubMetric interface.

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
