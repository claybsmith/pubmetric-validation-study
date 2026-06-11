# =============================================================================
# PubMetric Reitsma/SROC Engine — Standalone Reproduction Script
# =============================================================================
#
# This script is the verbatim R logic that PubMetric generates and executes
# in-browser via WebAssembly R (WebR) for bivariate diagnostic meta-analysis.
# It is exported directly from PubMetric's "Export Bundle" feature and adapted
# here as a standalone script to demonstrate reproducibility of results.
#
# Source dataset:
#   Drum B, La Course B, Kelly M, York A, Worrall E, Martins J, Johnson S,
#   Liles EA Jr. Does This Patient Have Volume Overload?: The Rational Clinical
#   Examination. JAMA. 2026 Apr 7;335(13):1159-1168.
#   doi: 10.1001/jama.2026.0446. PMID: 41729549.
#
# The 2x2 table data (TP, FP, FN, TN) were imported into PubMetric via CSV
# and the Reitsma bivariate model was fit using the mada package. This script
# reproduces that analysis exactly.
#
# Required packages: mada
# install.packages("mada")
# =============================================================================

library(mada)

# ── Data ──────────────────────────────────────────────────────────────────────
# 2x2 diagnostic accuracy data extracted from Drum et al. 2026 (Table 2)
dat <- data.frame(
  TP       = as.numeric(c(36, 18, 71, 37, 21, 40)),
  FP       = as.numeric(c(15,  3, 26, 19, 16, 12)),
  FN       = as.numeric(c(12, 10, 15,  7,  4,  6)),
  TN       = as.numeric(c(61, 12, 64, 37, 31, 18)),
  studlab  = c("Albaeni", "Siva", "Vaidya", "Wang", "Vaidya", "Simon")
)

cat("Studies included:", nrow(dat), "\n")
cat("Study labels:", paste(dat$studlab, collapse = ", "), "\n\n")

# ── Reitsma bivariate model ───────────────────────────────────────────────────
fit <- tryCatch(reitsma(dat), error = function(e) {
  cat("Reitsma model failed:", conditionMessage(e), "\n"); NULL
})

# Initialise output containers
sens_res           <- list(pooled = NA, lower = NA, upper = NA)
spec_res           <- list(pooled = NA, lower = NA, upper = NA)
dor_res            <- list(pooled = NA, lower = NA, upper = NA)
auc_val            <- NA
sroc_fpr           <- numeric(0)
sroc_sens          <- numeric(0)
conf_ellipse_params <- numeric(0)
pred_ellipse_params <- numeric(0)

if (!is.null(fit)) {

  # ── Pooled sensitivity and specificity (logit scale → back-transform) ───────
  cfs <- tryCatch(coef(fit), error = function(e) NULL)
  vcv <- tryCatch(vcov(fit), error = function(e) NULL)

  if (!is.null(cfs) && length(cfs) >= 2) {
    tsens    <- as.numeric(cfs[1])
    tfpr     <- as.numeric(cfs[2])
    tsens_se <- 0; tfpr_se <- 0; cov_val <- 0

    if (!is.null(vcv) && nrow(vcv) >= 2) {
      tsens_se <- sqrt(max(0, as.numeric(vcv[1, 1])))
      tfpr_se  <- sqrt(max(0, as.numeric(vcv[2, 2])))
      cov_val  <- as.numeric(vcv[1, 2])
    }

    tsens_ci <- tsens + c(-1.96, 1.96) * tsens_se
    tfpr_ci  <- tfpr  + c(-1.96, 1.96) * tfpr_se

    inv_logit <- function(x) exp(x) / (1 + exp(x))

    sens_res <- list(
      pooled = inv_logit(tsens),
      lower  = inv_logit(tsens_ci[1]),
      upper  = inv_logit(tsens_ci[2])
    )
    # Specificity = 1 − FPR; CI bounds flip on subtraction from 1
    spec_res <- list(
      pooled = 1 - inv_logit(tfpr),
      lower  = 1 - inv_logit(tfpr_ci[2]),
      upper  = 1 - inv_logit(tfpr_ci[1])
    )

    # ── Diagnostic Odds Ratio ─────────────────────────────────────────────────
    log_dor    <- tsens - tfpr
    se_log_dor <- sqrt(max(0, tsens_se^2 + tfpr_se^2 - 2 * cov_val))
    dor_ci     <- log_dor + c(-1.96, 1.96) * se_log_dor
    dor_res    <- list(
      pooled = exp(log_dor),
      lower  = exp(dor_ci[1]),
      upper  = exp(dor_ci[2])
    )
  }

  # ── SROC curve points ────────────────────────────────────────────────────────
  tryCatch({
    sr <- sroc(fit)
    if (is.matrix(sr) && ncol(sr) >= 2) {
      sroc_fpr  <- as.numeric(sr[, 1])
      sroc_sens <- as.numeric(sr[, 2])
    }
  }, error = function(e) {})

  # ── Confidence and prediction ellipse parameters ──────────────────────────
  # Sent as [mu_sens, mu_fpr, v11, v12, v22] — frontend renders as SVG <ellipse>
  tryCatch({
    center   <- c(as.numeric(cfs[1]), as.numeric(cfs[2]))
    conf_cov <- vcv[1:2, 1:2]
    conf_ellipse_params <- c(center[1], center[2],
                             as.numeric(conf_cov[1, 1]),
                             as.numeric(conf_cov[1, 2]),
                             as.numeric(conf_cov[2, 2]))

    sigma_btwn <- tryCatch(fit$Sigma, error = function(e) NULL)
    if (is.null(sigma_btwn) || !is.matrix(sigma_btwn) || nrow(sigma_btwn) < 2)
      sigma_btwn <- tryCatch(fit$Psi, error = function(e) NULL)

    if (!is.null(sigma_btwn) && is.matrix(sigma_btwn) && nrow(sigma_btwn) >= 2) {
      pred_cov <- conf_cov + sigma_btwn
      pred_ellipse_params <- c(center[1], center[2],
                               as.numeric(pred_cov[1, 1]),
                               as.numeric(pred_cov[1, 2]),
                               as.numeric(pred_cov[2, 2]))
    }
  }, error = function(e) {})

  # ── AUC ──────────────────────────────────────────────────────────────────────
  tryCatch({
    auc_calc <- as.numeric(ROCAUC(fit))
    if (!is.na(auc_calc[1])) auc_val <- auc_calc[1]
  }, error = function(e) {})
}

# ── Heterogeneity via univariate DOR (DL method) ─────────────────────────────
uni_mada <- tryCatch(
  madauni(dat, type = "DOR", method = "DL"),
  error = function(e) NULL
)

if (!is.null(uni_mada) && !is.null(uni_mada$weights)) {
  i2_val      <- uni_mada$I2
  q_val       <- uni_mada$Q
  tau2_val    <- uni_mada$tau2
  df_val      <- uni_mada$df
  weights_val <- uni_mada$weights / sum(uni_mada$weights) * 100
} else {
  i2_val <- 0; q_val <- 0; tau2_val <- 0; df_val <- 0
  weights_val <- rep(100 / nrow(dat), nrow(dat))
}

# ── Results ───────────────────────────────────────────────────────────────────
cat("=== Pooled Diagnostic Accuracy (Reitsma Bivariate Model) ===\n")
cat(sprintf("Sensitivity : %.3f (95%% CI %.3f – %.3f)\n",
            sens_res$pooled, sens_res$lower, sens_res$upper))
cat(sprintf("Specificity : %.3f (95%% CI %.3f – %.3f)\n",
            spec_res$pooled, spec_res$lower, spec_res$upper))
cat(sprintf("DOR         : %.2f (95%% CI %.2f – %.2f)\n",
            dor_res$pooled, dor_res$lower, dor_res$upper))
cat(sprintf("AUC (SROC)  : %.3f\n", auc_val))
cat(sprintf("I²          : %.1f%%\n", i2_val))
cat(sprintf("Q (df=%d)    : %.2f\n", df_val, q_val))

# ── SROC plot (saved to output/) ─────────────────────────────────────────────
dir.create("../output", showWarnings = FALSE)
pdf("../output/sroc_plot_drum2026.pdf", width = 6, height = 6)

plot(fit,
     main      = "SROC — Volume Overload (Drum et al. 2026)",
     xlab      = "1 – Specificity (FPR)",
     ylab      = "Sensitivity",
     xlim      = c(0, 1),
     ylim      = c(0, 1))

if (length(sroc_fpr) > 0 && length(sroc_sens) > 0)
  lines(sroc_fpr, sroc_sens, col = "steelblue", lwd = 2)

points(x   = 1 - spec_res$pooled,
       y   = sens_res$pooled,
       pch = 15, cex = 1.8, col = "steelblue")

legend("bottomright",
       legend = c("SROC curve", "Pooled operating point"),
       col    = c("steelblue", "steelblue"),
       lty    = c(1, NA), pch = c(NA, 15), lwd = 2,
       bty    = "n", cex = 0.85)

invisible(dev.off())
cat("\nSROC plot saved to output/sroc_plot_drum2026.pdf\n")
