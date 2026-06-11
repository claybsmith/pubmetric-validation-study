# install.packages(c("irr", "psych", "dplyr"))
library(irr)
library(psych)
library(dplyr)

INPUT_CSV  <- "../data/txa_validation_comparison.csv"
OUTPUT_CSV <- "../output/txa_validation_stats_full.csv"

df <- read.csv(INPUT_CSV, stringsAsFactors = FALSE, na.strings = "")

# ── Adjudication mapping ─────────────────────────────────────────────────────
agreement_comments <- c(
  "PM is correct",
  "PM appears correct",
  "PM has plausible calculated value",
  "Not incorrect compares 128 vs 64 slice CT",
  "rounding difference, not incorrect",
  "This is correct but no SD in PDF"
)

# Derive pre- and post-adjudication match columns (exclude blank/NA = n=1 placeholders)
df <- df %>%
  mutate(
    clay_comment = trimws(coalesce(Clay.comments, "")),
    # Pre-adjudication: YES or NO; blank/NA (n=1 placeholders) → excluded
    match_pre  = case_when(
      match == "YES"                                        ~ "YES",
      match == "NO ✗"                                       ~ "NO",
      TRUE                                                  ~ NA_character_
    ),
    # Post-adjudication: resolved NO ✗ rows become YES
    match_post = case_when(
      match == "YES"                                          ~ "YES",
      match == "NO ✗" & clay_comment %in% agreement_comments ~ "YES",
      match == "NO ✗"                                        ~ "NO",
      TRUE                                                    ~ NA_character_
    ),
    # Recode data_type for display
    field_group = recode(data_type,
      "Precalculated" = "Effect / CI",
      .default = data_type
    )
  )

# ── Helper functions ─────────────────────────────────────────────────────────
wilson_ci <- function(x, n, conf = 0.95) {
  z      <- qnorm(1 - (1 - conf) / 2)
  p      <- x / n
  denom  <- 1 + z^2 / n
  centre <- (p + z^2 / (2 * n)) / denom
  margin <- z * sqrt(p * (1 - p) / n + z^2 / (4 * n^2)) / denom
  paste0(round((centre - margin) * 100, 1), "%-", round((centre + margin) * 100, 1), "%")
}

safe_kappa <- function(v1, v2) {
  k_obj <- tryCatch(psych::cohen.kappa(cbind(as.character(v1), as.character(v2))),
                    error = function(e) NULL)
  if (is.null(k_obj)) return(list(k = "N/A", ci = "N/A"))
  k <- round(k_obj$kappa, 4)
  if (!is.null(k_obj$confid) && nrow(k_obj$confid) > 0) {
    row <- k_obj$confid[1, ]
    ci  <- paste0(round(min(row), 4), "-", round(max(row), 4))
  } else { ci <- "N/A" }
  list(k = k, ci = ci)
}

safe_icc <- function(n1, n2) {
  valid <- !is.na(n1) & !is.na(n2)
  if (sum(valid) < 2) return(list(val = "N/A", ci = "N/A"))
  res <- tryCatch(
    irr::icc(cbind(n1[valid], n2[valid]), model = "twoway", type = "agreement", unit = "single"),
    error = function(e) NULL
  )
  if (is.null(res)) return(list(val = "N/A", ci = "N/A"))
  list(
    val = round(res$value, 4),
    ci  = paste0(round(res$lbound, 4), "-", round(res$ubound, 4))
  )
}

make_row <- function(section, label, sub, match_col, include_kappa_icc = TRUE) {
  comp <- sub %>% filter(.data[[match_col]] %in% c("YES", "NO"))
  n      <- nrow(comp)
  agreed <- sum(comp[[match_col]] == "YES")
  pct    <- round(agreed / n * 100, 1)
  ci     <- wilson_ci(agreed, n)

  if (include_kappa_icc) {
    kap <- safe_kappa(comp$PM_value, comp$Claude_value)
    n1  <- suppressWarnings(as.numeric(comp$PM_value))
    n2  <- suppressWarnings(as.numeric(comp$Claude_value))
    ic  <- safe_icc(n1, n2)
    k_val <- kap$k;  k_ci <- kap$ci
    i_val <- ic$val; i_ci <- ic$ci
  } else {
    k_val <- "N/A"; k_ci <- "N/A"; i_val <- "N/A"; i_ci <- "N/A"
  }

  data.frame(
    section       = section,
    label         = label,
    agreed        = agreed,
    n_comparable  = n,
    pct_agreement = paste0(pct, "%"),
    CI_95_Wilson  = ci,
    kappa         = k_val,
    kappa_CI_95   = k_ci,
    icc           = i_val,
    icc_CI_95     = i_ci,
    stringsAsFactors = FALSE
  )
}

results <- data.frame()

# ── 1. Key results ───────────────────────────────────────────────────────────
# Numeric rows only (exclude n=1 placeholders)
num_df <- df %>% filter(is.na(exclusion_reason) | exclusion_reason == "")

# Post-adjudication overall (numeric + study/outcome rows, all of which agreed)
n_extra   <- 31 + 539
post_n    <- sum(num_df$match_post %in% c("YES","NO"), na.rm = TRUE) + n_extra
post_agr  <- sum(num_df$match_post == "YES", na.rm = TRUE) + n_extra
post_pct  <- round(post_agr / post_n * 100, 1)
results <- rbind(results, data.frame(
  section = "Key result", label = "Post-adjudication overall agreement",
  agreed = post_agr, n_comparable = post_n,
  pct_agreement = paste0(post_pct, "%"),
  CI_95_Wilson  = wilson_ci(post_agr, post_n),
  kappa = "N/A", kappa_CI_95 = "N/A", icc = "N/A", icc_CI_95 = "N/A",
  stringsAsFactors = FALSE
))

# ── 2. Overview by category ──────────────────────────────────────────────────
# Study design and outcome identification (hardcoded — not in this CSV)
for (row in list(
  list("Overview", "Study design classification",    31,  31),
  list("Overview", "Outcome identification",        539, 539)
)) {
  agr <- row[[3]]; n <- row[[4]]
  results <- rbind(results, data.frame(
    section = row[[1]], label = row[[2]],
    agreed = agr, n_comparable = n,
    pct_agreement = paste0(round(agr/n*100,1), "%"),
    CI_95_Wilson  = wilson_ci(agr, n),
    kappa = "N/A", kappa_CI_95 = "N/A", icc = "N/A", icc_CI_95 = "N/A",
    stringsAsFactors = FALSE
  ))
}

results <- rbind(results,
  make_row("Overview", "Numeric fields - pre-adjudication",  num_df, "match_pre"),
  make_row("Overview", "Numeric fields - post-adjudication", num_df, "match_post")
)

# ── 3. By field type (pre-adjudication) ─────────────────────────────────────
for (ftype in c("Dichotomous", "Continuous", "Effect / CI")) {
  sub <- num_df %>% filter(field_group == ftype)
  results <- rbind(results, make_row("By field type (pre-adj)", ftype, sub, "match_pre"))
}

# ── 4. By individual field name (pre-adjudication) ──────────────────────────
field_counts <- num_df %>%
  filter(match_pre %in% c("YES","NO")) %>%
  group_by(field) %>%
  summarise(n = n(), .groups = "drop") %>%
  filter(n >= 1) %>%
  arrange(desc(n))

for (fn in field_counts$field) {
  sub <- num_df %>% filter(field == fn)
  results <- rbind(results, make_row("By field name (pre-adj)", fn, sub, "match_pre",
                                     include_kappa_icc = FALSE))
}

# ── 5. By study (pre-adjudication, numeric fields) ──────────────────────────
study_order <- num_df %>%
  filter(match_pre %in% c("YES","NO")) %>%
  count(study, sort = TRUE) %>%
  pull(study)

for (s in study_order) {
  sub <- num_df %>% filter(study == s)
  results <- rbind(results, make_row("By study (pre-adj)", s, sub, "match_pre",
                                     include_kappa_icc = FALSE))
}

print(results, row.names = FALSE)
write.csv(results, OUTPUT_CSV, row.names = FALSE)
cat("\nWritten:", OUTPUT_CSV, "\n")
