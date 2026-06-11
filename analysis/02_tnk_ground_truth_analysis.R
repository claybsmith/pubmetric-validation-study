# install.packages(c("irr", "psych", "dplyr"))
library(irr)
library(psych)
library(dplyr)

df <- read.csv("../data/tnk_ground_truth.csv",
               stringsAsFactors = FALSE, na.strings = "")

# Wilson 95% CI for a proportion
wilson_ci <- function(x, n, conf = 0.95) {
  z <- qnorm(1 - (1 - conf) / 2)
  p <- x / n
  denom <- 1 + z^2 / n
  centre <- (p + z^2 / (2 * n)) / denom
  margin <- z * sqrt(p * (1 - p) / n + z^2 / (4 * n^2)) / denom
  round(c(centre - margin, centre + margin) * 100, 1)
}

# Safe kappa CI extraction
safe_kappa <- function(v1, v2) {
  k_obj <- tryCatch(cohen.kappa(cbind(as.character(v1), as.character(v2))),
                    error = function(e) NULL)
  if (is.null(k_obj)) return(list(k = NA, lo = NA, hi = NA))
  k <- round(k_obj$kappa, 4)
  if (!is.null(k_obj$confid) && nrow(k_obj$confid) > 0) {
    row <- k_obj$confid[1, ]
    lo <- round(min(row), 4)
    hi <- round(max(row), 4)
  } else {
    lo <- NA; hi <- NA
  }
  list(k = k, lo = lo, hi = hi)
}

# Safe ICC on numeric pairs
safe_icc <- function(n1, n2) {
  valid <- !is.na(n1) & !is.na(n2)
  if (sum(valid) < 2) return(list(val = NA, lo = NA, hi = NA))
  res <- tryCatch(
    icc(cbind(n1[valid], n2[valid]), model = "twoway", type = "agreement", unit = "single"),
    error = function(e) NULL
  )
  if (is.null(res)) return(list(val = NA, lo = NA, hi = NA))
  list(val = round(res$value, 4), lo = round(res$lbound, 4), hi = round(res$ubound, 4))
}

groups <- list(
  list("All fields",   c("Dichotomous", "Continuous", "Effect/CI")),
  list("Dichotomous",  c("Dichotomous")),
  list("Continuous",   c("Continuous")),
  list("Effect / CI",  c("Effect/CI"))
)

# ── 6 pairwise comparisons ──────────────────────────────────────────────────
pairwise <- list(
  list("Sam vs Brit",    "SvBr",  "Sam_value",   "Brit_value"),
  list("Sam vs PM",      "SvPM",  "Sam_value",   "PM_value"),
  list("Sam vs Claude",  "SvCl",  "Sam_value",   "Claude_value"),
  list("Brit vs PM",     "BvPM",  "Brit_value",  "PM_value"),
  list("Brit vs Claude", "BvCl",  "Brit_value",  "Claude_value"),
  list("PM vs Claude",   "PMvCl", "PM_value",    "Claude_value")
)

# ── 4 vs ground truth comparisons ───────────────────────────────────────────
vs_truth <- list(
  list("Sam vs Ground Truth",    "Sam_truth",    "Sam_value",    "Ground.Truth"),
  list("Brit vs Ground Truth",   "Brit_truth",   "Brit_value",   "Ground.Truth"),
  list("PM vs Ground Truth",     "PM_truth",     "PM_value",     "Ground.Truth"),
  list("Claude vs Ground Truth", "Claude_truth", "Claude_value", "Ground.Truth")
)

results <- data.frame()

process_comparison <- function(label, agree_col, v1_col, v2_col) {
  for (grp in groups) {
    grp_label <- grp[[1]]
    cats      <- grp[[2]]

    sub <- df %>%
      filter(field_category %in% cats) %>%
      filter(.data[[agree_col]] %in% c("YES", "NO"))

    n      <- nrow(sub)
    agreed <- sum(sub[[agree_col]] == "YES")
    pct    <- round(agreed / n * 100, 1)
    ci     <- wilson_ci(agreed, n)

    kap <- safe_kappa(sub[[v1_col]], sub[[v2_col]])

    n1 <- suppressWarnings(as.numeric(sub[[v1_col]]))
    n2 <- suppressWarnings(as.numeric(sub[[v2_col]]))
    ic <- safe_icc(n1, n2)

    results <<- rbind(results, data.frame(
      comparison    = label,
      field_group   = grp_label,
      n_comparable  = n,
      agreed        = agreed,
      pct_agreement = paste0(pct, "%"),
      pct_CI_95     = paste0(ci[1], "-", ci[2], "%"),
      kappa         = kap$k,
      kappa_CI_95   = paste0(kap$lo, "-", kap$hi),
      icc           = ic$val,
      icc_CI_95     = paste0(ic$lo, "-", ic$hi),
      stringsAsFactors = FALSE
    ))
  }
}

for (p in pairwise) process_comparison(p[[1]], p[[2]], p[[3]], p[[4]])

# vs ground truth: restrict to common 247-row set (rows where PMvCl was comparable)
common_set <- df %>% filter(SvBr %in% c("YES", "NO"))

for (p in vs_truth) {
  label     <- p[[1]]
  agree_col <- p[[2]]
  v1_col    <- p[[3]]
  v2_col    <- p[[4]]
  for (grp in groups) {
    grp_label <- grp[[1]]
    cats      <- grp[[2]]
    # Within common set, N/A means failed to extract = wrong (count as NO)
    sub <- common_set %>%
      filter(field_category %in% cats) %>%
      filter(.data[[agree_col]] %in% c("YES", "NO") | grepl("N/A", .data[[agree_col]]))
    n      <- nrow(sub)
    agreed <- sum(sub[[agree_col]] == "YES")
    pct    <- round(agreed / n * 100, 1)
    ci     <- wilson_ci(agreed, n)
    kap <- safe_kappa(sub[[v1_col]], sub[[v2_col]])
    n1 <- suppressWarnings(as.numeric(sub[[v1_col]]))
    n2 <- suppressWarnings(as.numeric(sub[[v2_col]]))
    ic <- safe_icc(n1, n2)
    results <<- rbind(results, data.frame(
      comparison    = label,
      field_group   = grp_label,
      n_comparable  = n,
      agreed        = agreed,
      pct_agreement = paste0(pct, "%"),
      pct_CI_95     = paste0(ci[1], "-", ci[2], "%"),
      kappa         = kap$k,
      kappa_CI_95   = paste0(kap$lo, "-", kap$hi),
      icc           = ic$val,
      icc_CI_95     = paste0(ic$lo, "-", ic$hi),
      stringsAsFactors = FALSE
    ))
  }
}

print(results, row.names = FALSE)
write.csv(results, "../output/tnk_ground_truth_stats.csv", row.names = FALSE)
cat("\nWritten: FINAL-TNK-ground-truth-stats.csv\n")
