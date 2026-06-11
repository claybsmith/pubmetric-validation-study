#!/usr/bin/env node
/**
 * Dual-AI Validation Script
 *
 * For each study: reads PubMetric's extracted values from the CSV, sends the
 * original PDF to Claude API for independent extraction, then compares field
 * by field and flags any discrepancies.
 *
 * Output: validation_comparison.csv  (full field-by-field table)
 *         validation_summary.csv     (per-study and per-field agreement rates)
 *
 * Usage:
 *   1. Add ANTHROPIC_API_KEY=sk-ant-... to your .env file
 *   2. node dual_ai_validation.cjs
 *   3. Optionally run a single study: node dual_ai_validation.cjs "Neeki 2018"
 */

require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const readline  = require('readline');
const Anthropic = require('@anthropic-ai/sdk');

// ── Configuration ─────────────────────────────────────────────────────────────

let PROJECT_ID, PDF_FOLDER, LOOKUP_FILE, PUBMETRIC_CSV, APPEND_MODE, COMPARISON_OUT, COMPARISON_LONG, SUMMARY_OUT;

async function promptConfig() {
  // Parse named flags: --project=<id> --folder=<name>
  const flags = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) flags[m[1]] = m[2];
  }

  const configBase   = `/path/to/your/pdf/folder`; // replace with the folder containing your PDF subfolders
  const savedConfigs = './validation_project_configs.json';
  const configs      = fs.existsSync(savedConfigs) ? JSON.parse(fs.readFileSync(savedConfigs, 'utf8')) : {};

  let projectId, folderName;

  if (flags.project && flags.folder) {
    // Fully non-interactive: both flags provided
    projectId  = flags.project;
    folderName = flags.folder;
  } else if (flags.project && configs[flags.project]) {
    // Project known from saved config
    projectId  = flags.project;
    folderName = configs[flags.project].folderName;
    console.log(`\nUsing saved config for project ${projectId} (folder: ${folderName})`);
  } else {
    // Interactive
    const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));
    console.log('\n── PubMetric Dual-AI Validation ──────────────────────────');
    projectId  = (await ask('Project ID: ')).trim() || 'YOUR_PROJECT_ID';
    folderName = (await ask('PDF subfolder name under "PubMetric Meta" (press Enter for TXA default): ')).trim() || 'TXA SR-MA';
    rl.close();
  }

  PROJECT_ID      = projectId;
  PDF_FOLDER      = `${configBase}/${folderName}`;
  PUBMETRIC_CSV   = `./validation_table_${projectId}.csv`;
  APPEND_MODE     = process.argv.includes('--append');
  COMPARISON_OUT  = APPEND_MODE ? `./validation_comparison_${projectId}_new.csv` : `./validation_comparison_${projectId}.csv`;
  COMPARISON_LONG = `./validation_comparison_long_${projectId}.csv`;
  SUMMARY_OUT     = APPEND_MODE ? `./validation_summary_${projectId}_new.csv` : `./validation_summary_${projectId}.csv`;

  // Resolve lookup file
  const defaultLookup = `./study_pdf_lookup_${projectId}.csv`;
  const legacyLookup  = './study_pdf_lookup.csv';
  if (fs.existsSync(defaultLookup)) {
    LOOKUP_FILE = defaultLookup;
  } else if (projectId === 'bN0b7Bmmz095W26sveYf' && fs.existsSync(legacyLookup)) {
    LOOKUP_FILE = legacyLookup;
  } else {
    // Build lookup interactively
    const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));
    console.log(`\nNo lookup file found. Let's build one.`);
    const pdfFiles = fs.readdirSync(PDF_FOLDER).filter(f => f.endsWith('.pdf')).sort();
    pdfFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    const pmRows = parseCsv(PUBMETRIC_CSV);
    const studies = [...new Set(pmRows.map(r => r.study_author).filter(Boolean))];
    const lookupLines = ['study_key,pdf_filename'];
    for (const study of studies) {
      const answer = (await ask(`  ${study}: `)).trim();
      const idx = parseInt(answer, 10) - 1;
      if (!isNaN(idx) && pdfFiles[idx]) lookupLines.push(`${study},"${pdfFiles[idx]}"`);
    }
    rl.close();
    fs.writeFileSync(defaultLookup, lookupLines.join('\n'), 'utf8');
    LOOKUP_FILE = defaultLookup;
  }

  // Save config for future runs
  configs[projectId] = { folderName, lookupFile: LOOKUP_FILE };
  fs.writeFileSync(savedConfigs, JSON.stringify(configs, null, 2), 'utf8');

  console.log(`\n  Project:     ${PROJECT_ID}`);
  console.log(`  PDF folder:  ${PDF_FOLDER}`);
  console.log(`  Lookup file: ${LOOKUP_FILE}`);
  console.log(`  Output:      ${COMPARISON_OUT}\n`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseCsvLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  return cols;
}

function parseCsv(filePath) {
  const raw   = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const row  = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
    return row;
  });
}

function esc(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${s}"`;
}

function writeCsv(filePath, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines   = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ];
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\n'), 'utf8');
}

function normalize(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\s+/g, ' ');
}

function valuesMatch(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === '' && nb === '') return 'BOTH_BLANK';
  if (na === '' || nb === '') return 'NO';
  // Numeric comparison: absolute ≤ 0.01 OR relative ≤ 0.5% (handles rounding differences)
  const fa = parseFloat(na), fb = parseFloat(nb);
  if (!isNaN(fa) && !isNaN(fb)) {
    if (Number.isInteger(fa) && Number.isInteger(fb)) return fa === fb ? 'YES' : 'NO';
    const absDiff = Math.abs(fa - fb);
    const relDiff = absDiff / Math.max(Math.abs(fa), Math.abs(fb), 1);
    return (absDiff <= 0.01 || relDiff <= 0.005) ? 'YES' : 'NO';
  }
  return na.toLowerCase() === nb.toLowerCase() ? 'YES' : 'NO';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Claude extraction prompt ───────────────────────────────────────────────────

// ── Extraction prompts ────────────────────────────────────────────────────────
// The full system and user prompts used for Claude-assisted extraction are
// available on request from the corresponding author (clay@journalfeed.org).
// They have been omitted here to prevent gaming of future validation studies.

function buildSystemPrompt(studyDesign) {
  // [REDACTED — available on request from corresponding author]
  throw new Error("Prompt redacted. Contact clay@journalfeed.org for access.");
}

function buildUserPrompt(pmOutcomeRows) {
  // [REDACTED — available on request from corresponding author]
  throw new Error("Prompt redacted. Contact clay@journalfeed.org for access.");
}


function buildRow(studyKey, studyDesign, pmRow, claudeOutcome) {
  const pm  = k => normalize(pmRow[k] ?? '');
  const cl  = k => claudeOutcome ? normalize(claudeOutcome[k] ?? '') : '';
  const dataType   = (pmRow.outcome_data_type || '').toLowerCase();
  const isPreCalc  = dataType === 'precalculated' || dataType === 'ordinal';
  const isCont     = dataType === 'continuous';
  const claudeFound = claudeOutcome !== null;

  // Zero-null equivalence for continuous fields: when one extractor reports 0 and
  // the other reports blank (null), both are saying "absent/zero quantity" — exclude
  // the match rather than penalising. Allows PM=0/Claude=0 to score as YES.
  const mZ = (a, b) => {
    if ((a === '0' && b === '') || (a === '' && b === '0')) return '';
    return m(a, b);
  };

  // Determine exclusion reasons — PM and Claude values are always preserved;
  // only the match fields are set to '' so excluded fields are not counted.
  const reasons = [];
  if (!claudeFound)
    reasons.push('Claude: outcome not found in paper');
  if (isPreCalc && (pm('n_intervention') === '1' || pm('n_control') === '1'))
    reasons.push('PM: Precalculated n=1 placeholder');
  if (isCont && (pm('events_intervention') !== '' || pm('events_control') !== ''))
    reasons.push('Continuous: events field not applicable');

  const excl_n  = !claudeFound || (isPreCalc && (pm('n_intervention') === '1' || pm('n_control') === '1'));
  const excl_ev = !claudeFound || isCont;

  return {
    study:                   studyKey,
    study_design:            studyDesign,
    outcome:                 pmRow.outcome_name || '',
    timepoint:               pmRow.outcome_timepoint || '',
    data_type:               pmRow.outcome_data_type || '',
    claude_found_outcome:    claudeFound ? 'YES' : 'NO',
    exclusion_reason:        reasons.join('; '),

    // ── n (PM values always preserved; match blank when excluded) ─────────────
    PM_n_intervention:       pm('n_intervention'),
    Claude_n_intervention:   cl('n_intervention'),
    match_n_intervention:    excl_n ? '' : m(pm('n_intervention'), cl('n_intervention')),

    PM_n_control:            pm('n_control'),
    Claude_n_control:        cl('n_control'),
    match_n_control:         excl_n ? '' : m(pm('n_control'), cl('n_control')),

    // ── events (PM values always preserved; match blank when excluded) ────────
    PM_events_intervention:  pm('events_intervention'),
    Claude_events_intervention: cl('events_intervention'),
    match_events_intervention: excl_ev ? '' : m(pm('events_intervention'), cl('events_intervention')),

    PM_events_control:       pm('events_control'),
    Claude_events_control:   cl('events_control'),
    match_events_control:    excl_ev ? '' : m(pm('events_control'), cl('events_control')),

    // ── continuous ────────────────────────────────────
    PM_mean_intervention:    pm('mean_intervention'),
    Claude_mean_intervention: cl('mean_intervention'),
    match_mean_intervention: mZ(pm('mean_intervention'), cl('mean_intervention')),

    PM_sd_intervention:      pm('sd_intervention'),
    Claude_sd_intervention:  cl('sd_intervention'),
    match_sd_intervention:   mZ(pm('sd_intervention'), cl('sd_intervention')),

    PM_median_intervention:      pm('median_intervention'),
    Claude_median_intervention:  cl('median_intervention'),
    match_median_intervention:   mZ(pm('median_intervention'), cl('median_intervention')),

    PM_iqr_lower_intervention:   pm('iqr_lower_intervention'),
    Claude_iqr_lower_intervention: cl('iqr_lower_intervention'),
    match_iqr_lower_intervention: mZ(pm('iqr_lower_intervention'), cl('iqr_lower_intervention')),

    PM_iqr_upper_intervention:   pm('iqr_upper_intervention'),
    Claude_iqr_upper_intervention: cl('iqr_upper_intervention'),
    match_iqr_upper_intervention: mZ(pm('iqr_upper_intervention'), cl('iqr_upper_intervention')),

    PM_mean_control:         pm('mean_control'),
    Claude_mean_control:     cl('mean_control'),
    match_mean_control:      mZ(pm('mean_control'), cl('mean_control')),

    PM_sd_control:           pm('sd_control'),
    Claude_sd_control:       cl('sd_control'),
    match_sd_control:        mZ(pm('sd_control'), cl('sd_control')),

    PM_median_control:       pm('median_control'),
    Claude_median_control:   cl('median_control'),
    match_median_control:    mZ(pm('median_control'), cl('median_control')),

    PM_iqr_lower_control:    pm('iqr_lower_control'),
    Claude_iqr_lower_control: cl('iqr_lower_control'),
    match_iqr_lower_control: mZ(pm('iqr_lower_control'), cl('iqr_lower_control')),

    PM_iqr_upper_control:    pm('iqr_upper_control'),
    Claude_iqr_upper_control: cl('iqr_upper_control'),
    match_iqr_upper_control: mZ(pm('iqr_upper_control'), cl('iqr_upper_control')),

    PM_range_lower_intervention:   pm('range_lower_intervention'),
    Claude_range_lower_intervention: cl('range_lower_intervention'),
    match_range_lower_intervention: mZ(pm('range_lower_intervention'), cl('range_lower_intervention')),

    PM_range_upper_intervention:   pm('range_upper_intervention'),
    Claude_range_upper_intervention: cl('range_upper_intervention'),
    match_range_upper_intervention: mZ(pm('range_upper_intervention'), cl('range_upper_intervention')),

    PM_range_lower_control:   pm('range_lower_control'),
    Claude_range_lower_control: cl('range_lower_control'),
    match_range_lower_control: mZ(pm('range_lower_control'), cl('range_lower_control')),

    PM_range_upper_control:   pm('range_upper_control'),
    Claude_range_upper_control: cl('range_upper_control'),
    match_range_upper_control: mZ(pm('range_upper_control'), cl('range_upper_control')),

    // ── precalculated only (R calculates these for dichotomous/continuous) ────
    PM_effect_size:       isPreCalc ? pm('effect_size') : '',
    Claude_effect_size:   isPreCalc ? cl('effect_size') : '',
    match_effect_size:    isPreCalc ? m(pm('effect_size'), cl('effect_size')) : '',

    PM_ci_lower:          isPreCalc ? pm('ci_lower') : '',
    Claude_ci_lower:      isPreCalc ? cl('ci_lower') : '',
    match_ci_lower:       isPreCalc ? m(pm('ci_lower'), cl('ci_lower')) : '',

    PM_ci_upper:          isPreCalc ? pm('ci_upper') : '',
    Claude_ci_upper:      isPreCalc ? cl('ci_upper') : '',
    match_ci_upper:       isPreCalc ? m(pm('ci_upper'), cl('ci_upper')) : '',

    // ── RoB (filled for study-level row, blank for outcomes) ──
    PM_rob_d1:               '',
    PM_rob_d2:               '',
    PM_rob_d3:               '',
    PM_rob_d4:               '',
    PM_rob_d5:               '',
    PM_rob_overall:          '',
    reviewer_rob:            '',

    // ── Study design (blank for outcome rows; populated in study-level row) ──
    PM_study_design:         '',
    Claude_study_design:     '',
    match_study_design:      '',
  };
}

function buildStudyLevelRow(studyKey, pmRow, claudeDesign) {
  const pm  = k => normalize(pmRow[k] ?? '');
  const isRCT = pmRow.study_design === 'RCT';

  const domainLabels = isRCT
    ? ['Randomization','Deviations','Missing data','Measurement','Reporting']
    : ['Confounding','Selection','Classification','Deviations','Missing data','Measurement','Reporting'];

  const domainVals = isRCT
    ? [pm('rob_randomization'), pm('rob_deviations'), pm('rob_missing_data'), pm('rob_measurement'), pm('rob_reporting')]
    : [pm('robins_confounding'), pm('robins_selection'), pm('robins_classification'), pm('robins_deviations'), pm('robins_missing'), pm('robins_measurement'), pm('robins_reporting')];

  return {
    study:                   studyKey,
    study_design:            pm('study_design'),
    outcome:                 '*** STUDY LEVEL ***',
    timepoint:               '',
    data_type:               '',
    claude_found_outcome:    '',
    exclusion_reason:        '',

    PM_n_intervention:       '', Claude_n_intervention: '', match_n_intervention: '',
    PM_n_control:            '', Claude_n_control: '',      match_n_control: '',
    PM_events_intervention:  '', Claude_events_intervention: '', match_events_intervention: '',
    PM_events_control:       '', Claude_events_control: '',  match_events_control: '',
    PM_mean_intervention:    '', Claude_mean_intervention: '', match_mean_intervention: '',
    PM_sd_intervention:      '', Claude_sd_intervention: '',  match_sd_intervention: '',
    PM_mean_control:         '', Claude_mean_control: '',     match_mean_control: '',
    PM_sd_control:           '', Claude_sd_control: '',       match_sd_control: '',
    PM_effect_size:          '', Claude_effect_size: '',      match_effect_size: '',
    PM_ci_lower:             '', Claude_ci_lower: '',         match_ci_lower: '',
    PM_ci_upper:             '', Claude_ci_upper: '',         match_ci_upper: '',

    PM_study_design:         pm('study_design'),
    Claude_study_design:     claudeDesign || '',
    match_study_design:      m(pm('study_design'), claudeDesign || ''),

    PM_rob_d1:               domainVals[0] || '',
    PM_rob_d2:               domainVals[1] || '',
    PM_rob_d3:               domainVals[2] || '',
    PM_rob_d4:               domainVals[3] || '',
    PM_rob_d5:               domainVals[4] || '',
    PM_rob_overall:          isRCT ? pm('rob_overall') : pm('robins_overall'),
    reviewer_rob:            '',
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }

  const targetStudy = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : null;

  // Load lookup table
  const lookup = {};
  parseCsv(LOOKUP_FILE).forEach(row => {
    if (!row.study_key) return;
    lookup[row.study_key.trim()] = (row.pdf_filename || '').trim();
  });

  // Load PubMetric CSV — group rows by study_key (author + year)
  const pmRows = parseCsv(PUBMETRIC_CSV);
  const studyMap = {};
  for (const row of pmRows) {
    const key = row.study_author.trim();
    if (!studyMap[key]) studyMap[key] = [];
    studyMap[key].push(row);
  }

  const studyKeys = Object.keys(studyMap).filter(k =>
    targetStudy ? k === targetStudy : true
  );

  if (targetStudy && studyKeys.length === 0) {
    console.error(`Study "${targetStudy}" not found in CSV. Keys available:`);
    Object.keys(studyMap).forEach(k => console.error(' ', k));
    process.exit(1);
  }

  console.log(`\nProcessing ${studyKeys.length} studies...\n`);

  const allRows = [];
  let studyNum  = 0;

  for (const studyKey of studyKeys) {
    studyNum++;
    const pdfName = lookup[studyKey];
    if (!pdfName) {
      console.warn(`[${studyNum}/${studyKeys.length}] SKIP — no PDF mapped for: ${studyKey}`);
      continue;
    }

    const pdfPath = path.join(PDF_FOLDER, pdfName);
    if (!fs.existsSync(pdfPath)) {
      console.warn(`[${studyNum}/${studyKeys.length}] SKIP — PDF file not found: ${pdfName}`);
      continue;
    }

    const pmStudyRows  = studyMap[studyKey];
    const studyDesign  = pmStudyRows[0].study_design;

    console.log(`[${studyNum}/${studyKeys.length}] ${studyKey} (${studyDesign}) — ${pdfName.substring(0, 60)}...`);

    const pmOutcomeRows = pmStudyRows.filter(r => r.outcome_name);

    // Send PDF + PubMetric outcome list to Claude — returns one entry per outcome, in order
    let claudeOutcomes = [];
    let claudeDesign   = '';
    try {
      const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
      const response  = await client.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 16000,
        system: buildSystemPrompt(studyDesign),
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: buildUserPrompt(pmOutcomeRows) }
          ]
        }]
      });

      const text     = response.content[0]?.text || '';
      const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      if (process.env.DEBUG) console.log('RAW CLAUDE:\n', text.substring(0, 800));

      const parsed   = JSON.parse(jsonText);
      claudeDesign   = parsed.study_design || '';
      claudeOutcomes = parsed.outcomes || [];
      console.log(`   ✓ Claude returned ${claudeOutcomes.length} outcomes (expected ${pmOutcomeRows.length})`);
      claudeOutcomes.forEach((o, i) => {
        const pm = pmOutcomeRows[i];
        const found = o.found ? '✓' : '✗ NOT FOUND';
        console.log(`     ${i+1}. [${found}] "${pm?.outcome_name}" → n:${o.n_intervention}/${o.n_control} events:${o.events_intervention}/${o.events_control}`);
      });
    } catch (err) {
      console.error(`   ✗ Claude extraction failed: ${err.message}`);
      if (process.env.DEBUG) console.error(err);
    }

    // Direct index match — no matching logic needed
    pmOutcomeRows.forEach((pmRow, i) => {
      const claudeOutcome = claudeOutcomes[i]?.found !== false ? claudeOutcomes[i] : null;
      allRows.push(buildRow(studyKey, studyDesign, pmRow, claudeOutcome));
    });

    // Study-level row: design + RoB — once per study
    allRows.push(buildStudyLevelRow(studyKey, pmStudyRows[0], claudeDesign));

    // Respect rate limits — pause between studies
    if (studyNum < studyKeys.length) await sleep(2000);
  }

  writeCsv(COMPARISON_OUT, allRows);
  writeLongFormat(allRows);
  writeSummary(allRows);
  console.log(`\nDone.\n  Wide table : ${COMPARISON_OUT}\n  Long table : ${COMPARISON_LONG}\n  Summary    : ${SUMMARY_OUT}`);
}

// ── Wilson 95% CI for a proportion ───────────────────────────────────────────
function wilson(agree, n) {
  if (n === 0) return { pct: 'N/A', ci: 'N/A' };
  const p  = agree / n;
  const z  = 1.96, z2 = z * z;
  const ctr = (p + z2 / (2 * n)) / (1 + z2 / n);
  const mar = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  const lo  = Math.max(0, ctr - mar), hi = Math.min(1, ctr + mar);
  return {
    pct: (p * 100).toFixed(1) + '%',
    ci:  (lo * 100).toFixed(1) + '–' + (hi * 100).toFixed(1) + '%'
  };
}

function tally(rows, key) {
  let agree = 0, n = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === 'YES' || v === 'NO ✗') { n++; if (v === 'YES') agree++; }
  }
  return { agree, n, ...wilson(agree, n) };
}

function writeSummary(allRows, outPath) {
  outPath = outPath || SUMMARY_OUT;
  const outcomeRows   = allRows.filter(r => r.outcome !== '*** STUDY LEVEL ***');
  const studyLevelRows = allRows.filter(r => r.outcome === '*** STUDY LEVEL ***');

  const FIELD_LABELS = {
    match_n_intervention:          'N (intervention arm)',
    match_n_control:               'N (control arm)',
    match_events_intervention:     'Events (intervention arm)',
    match_events_control:          'Events (control arm)',
    match_mean_intervention:       'Mean (intervention arm)',
    match_sd_intervention:         'SD (intervention arm)',
    match_median_intervention:     'Median (intervention arm)',
    match_iqr_lower_intervention:  'IQR lower (intervention arm)',
    match_iqr_upper_intervention:  'IQR upper (intervention arm)',
    match_mean_control:            'Mean (control arm)',
    match_sd_control:              'SD (control arm)',
    match_median_control:          'Median (control arm)',
    match_iqr_lower_control:       'IQR lower (control arm)',
    match_iqr_upper_control:       'IQR upper (control arm)',
    match_range_lower_intervention: 'Range lower (intervention arm)',
    match_range_upper_intervention: 'Range upper (intervention arm)',
    match_range_lower_control:      'Range lower (control arm)',
    match_range_upper_control:      'Range upper (control arm)',
    match_effect_size:             'Effect size',
    match_ci_lower:                '95% CI lower bound',
    match_ci_upper:                '95% CI upper bound',
  };

  const summaryRows = [];

  // ── Section 1: Overall ────────────────────────────────────────────────────
  summaryRows.push({ section: 'OVERALL', metric: '', n_comparisons: '', n_agree: '', agreement_pct: '', ci_95: '' });

  // Outcome identification
  const totalOutcomes = outcomeRows.length;
  const foundOutcomes = outcomeRows.filter(r => r.claude_found_outcome === 'YES').length;
  const foundW = wilson(foundOutcomes, totalOutcomes);
  summaryRows.push({
    section: '', metric: 'Outcome identification rate',
    n_comparisons: totalOutcomes, n_agree: foundOutcomes,
    agreement_pct: foundW.pct, ci_95: foundW.ci
  });

  // Study design
  const designRows = studyLevelRows.filter(r => r.match_study_design === 'YES' || r.match_study_design === 'NO ✗');
  const designAgree = designRows.filter(r => r.match_study_design === 'YES').length;
  const designW = wilson(designAgree, designRows.length);
  summaryRows.push({
    section: '', metric: 'Study design classification',
    n_comparisons: designRows.length, n_agree: designAgree,
    agreement_pct: designW.pct, ci_95: designW.ci
  });

  // All numeric fields combined
  const allFieldKeys = Object.keys(FIELD_LABELS);
  let totalAgree = 0, totalN = 0;
  for (const k of allFieldKeys) { const t = tally(outcomeRows, k); totalAgree += t.agree; totalN += t.n; }
  const overallW = wilson(totalAgree, totalN);
  summaryRows.push({
    section: '', metric: 'All numeric fields (combined)',
    n_comparisons: totalN, n_agree: totalAgree,
    agreement_pct: overallW.pct, ci_95: overallW.ci
  });

  summaryRows.push({ section: '', metric: '', n_comparisons: '', n_agree: '', agreement_pct: '', ci_95: '' });

  // ── Section 2: Per-field ──────────────────────────────────────────────────
  summaryRows.push({ section: 'BY FIELD', metric: '', n_comparisons: '', n_agree: '', agreement_pct: '', ci_95: '' });
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const t = tally(outcomeRows, key);
    summaryRows.push({ section: '', metric: label, n_comparisons: t.n, n_agree: t.agree, agreement_pct: t.pct, ci_95: t.ci });
  }

  summaryRows.push({ section: '', metric: '', n_comparisons: '', n_agree: '', agreement_pct: '', ci_95: '' });

  // ── Section 3: Per-study ──────────────────────────────────────────────────
  summaryRows.push({ section: 'BY STUDY', metric: '', n_comparisons: '', n_agree: '', agreement_pct: '', ci_95: '' });
  const studies = [...new Set(outcomeRows.map(r => r.study))];
  for (const study of studies) {
    const rows = outcomeRows.filter(r => r.study === study);
    const design = rows[0]?.study_design || '';
    let sa = 0, sn = 0;
    for (const k of allFieldKeys) { const t = tally(rows, k); sa += t.agree; sn += t.n; }
    const sw = wilson(sa, sn);
    summaryRows.push({ section: '', metric: `${study} (${design})`, n_comparisons: sn, n_agree: sa, agreement_pct: sw.pct, ci_95: sw.ci });
  }

  writeCsv(outPath, summaryRows);
}

// ── Long (tidy) format ────────────────────────────────────────────────────────
function writeLongFormat(allRows, outPath) {
  outPath = outPath || COMPARISON_LONG;
  const FIELDS = [
    { key: 'n_intervention',        label: 'N (intervention arm)' },
    { key: 'n_control',             label: 'N (control arm)' },
    { key: 'events_intervention',   label: 'Events (intervention arm)' },
    { key: 'events_control',        label: 'Events (control arm)' },
    { key: 'mean_intervention',     label: 'Mean (intervention arm)' },
    { key: 'sd_intervention',       label: 'SD (intervention arm)' },
    { key: 'median_intervention',   label: 'Median (intervention arm)' },
    { key: 'iqr_lower_intervention',label: 'IQR lower (intervention arm)' },
    { key: 'iqr_upper_intervention',label: 'IQR upper (intervention arm)' },
    { key: 'mean_control',          label: 'Mean (control arm)' },
    { key: 'sd_control',            label: 'SD (control arm)' },
    { key: 'median_control',        label: 'Median (control arm)' },
    { key: 'iqr_lower_control',     label: 'IQR lower (control arm)' },
    { key: 'iqr_upper_control',     label: 'IQR upper (control arm)' },
    { key: 'range_lower_intervention', label: 'Range lower (intervention arm)' },
    { key: 'range_upper_intervention', label: 'Range upper (intervention arm)' },
    { key: 'range_lower_control',   label: 'Range lower (control arm)' },
    { key: 'range_upper_control',   label: 'Range upper (control arm)' },
    { key: 'effect_size',           label: 'Effect size' },
    { key: 'ci_lower',              label: '95% CI lower' },
    { key: 'ci_upper',              label: '95% CI upper' },
  ];

  const longRows = [];
  for (const r of allRows) {
    if (r.outcome === '*** STUDY LEVEL ***') continue;
    for (const { key, label } of FIELDS) {
      const pmVal  = r[`PM_${key}`]     ?? '';
      const clVal  = r[`Claude_${key}`] ?? '';
      const match  = r[`match_${key}`]  ?? '';
      // Skip rows where both values are blank — nothing to show
      if (pmVal === '' && clVal === '') continue;
      longRows.push({
        study:            r.study,
        study_design:     r.study_design,
        outcome:          r.outcome,
        timepoint:        r.timepoint,
        data_type:        r.data_type,
        field:            label,
        PM_value:         pmVal,
        Claude_value:     clVal,
        match:            match,
        exclusion_reason: match === '' ? (r.exclusion_reason ?? '') : '',
      });
    }
  }

  writeCsv(outPath, longRows);
}

// ── Recompute from existing comparison CSV ────────────────────────────────────
// Reads validation_comparison.csv and re-applies current comparison rules
// without calling Claude again. Outputs *_recomputed.csv files.

const NUMERIC_FIELD_KEYS = [
  'n_intervention', 'n_control',
  'events_intervention', 'events_control',
  'mean_intervention', 'sd_intervention',
  'median_intervention', 'iqr_lower_intervention', 'iqr_upper_intervention',
  'mean_control', 'sd_control',
  'median_control', 'iqr_lower_control', 'iqr_upper_control',
  'range_lower_intervention', 'range_upper_intervention',
  'range_lower_control', 'range_upper_control',
  'effect_size', 'ci_lower', 'ci_upper',
];

async function recompute() {
  if (!fs.existsSync(COMPARISON_OUT)) {
    console.error(`ERROR: ${COMPARISON_OUT} not found — run validation first`);
    process.exit(1);
  }

  const rows = parseCsv(COMPARISON_OUT);

  const recomputedRows = rows.map(row => {
    if (row.outcome === '*** STUDY LEVEL ***') return { ...row, exclusion_reason: '' };

    const dataType   = (row.data_type || '').toLowerCase();
    const isPreCalc  = dataType === 'precalculated' || dataType === 'ordinal';
    const isCont     = dataType === 'continuous';
    const claudeFound = row.claude_found_outcome === 'YES';

    const nr = { ...row }; // PM and Claude values are NEVER modified

    // ── Step 1: recompute all match fields with updated valuesMatch ──────────
    // This applies the relative-tolerance rounding fix. Raw values unchanged.
    for (const key of NUMERIC_FIELD_KEYS) {
      const pmVal = nr[`PM_${key}`] ?? '';
      const clVal = nr[`Claude_${key}`] ?? '';
      nr[`match_${key}`] = m(pmVal, clVal);
    }

    // ── Step 2: apply exclusions — match fields set to '' only ───────────────
    // PM and Claude values remain in the CSV for full audit transparency.
    const reasons = [];

    // Exclusion A: Claude did not find this outcome in the paper.
    // Identification-rate metric already captures the miss; comparing numeric
    // fields against Claude's nulls would double-penalise.
    if (!claudeFound) {
      reasons.push('Claude: outcome not found in paper');
      for (const key of NUMERIC_FIELD_KEYS) nr[`match_${key}`] = '';
    }

    // Exclusion B: Precalculated/Ordinal outcomes — PM stores n=1 as a
    // placeholder (never real data). Claude correctly returns null. Not a mismatch.
    if (isPreCalc && (nr.PM_n_intervention === '1' || nr.PM_n_control === '1')) {
      reasons.push('PM: Precalculated n=1 placeholder');
      nr.match_n_intervention = '';
      nr.match_n_control      = '';
    }

    // Exclusion C: Events field is not applicable to Continuous outcomes.
    // PM stored events=0 as a side-effect of the mean/SD split; Claude correctly
    // left it null. Excluding prevents systematic false failures.
    if (isCont && (nr.PM_events_intervention !== '' || nr.PM_events_control !== '' ||
                   nr.Claude_events_intervention !== '' || nr.Claude_events_control !== '')) {
      reasons.push('Continuous: events field not applicable');
      nr.match_events_intervention = '';
      nr.match_events_control      = '';
    }

    // Exclusion D: Continuous measurement fields — PM stores 0 as null in Firestore.
    // When PM is blank and Claude returns 0 (or vice versa) for mean/SD/median/IQR lower,
    // both extractors are reporting the same result (no measurable quantity).
    // This is NOT a genuine disagreement; it is a storage representation difference.
    if (isCont) {
      const ZERO_NULL_FIELDS = [
        'mean_intervention', 'sd_intervention', 'median_intervention', 'iqr_lower_intervention',
        'mean_control',      'sd_control',      'median_control',      'iqr_lower_control',
      ];
      let zeroNullApplied = false;
      for (const field of ZERO_NULL_FIELDS) {
        const pmVal = nr[`PM_${field}`] ?? '';
        const clVal = nr[`Claude_${field}`] ?? '';
        if ((pmVal === '' && clVal === '0') || (pmVal === '0' && clVal === '')) {
          nr[`match_${field}`] = '';
          zeroNullApplied = true;
        }
      }
      if (zeroNullApplied) reasons.push('PM: zero stored as null for continuous measurement');
    }

    nr.exclusion_reason = reasons.join('; ');
    return nr;
  });

  const RC_COMPARISON = './validation_comparison_recomputed.csv';
  const RC_LONG       = './validation_comparison_long_recomputed.csv';
  const RC_SUMMARY    = './validation_summary_recomputed.csv';

  writeCsv(RC_COMPARISON, recomputedRows);
  writeLongFormat(recomputedRows, RC_LONG);
  writeSummary(recomputedRows, RC_SUMMARY);

  const nExcluded = recomputedRows.filter(r => r.exclusion_reason).length;
  console.log(`\nRecomputed with updated rules:`);
  console.log(`  Rows with documented exclusions: ${nExcluded}`);
  console.log(`  Wide table  : ${RC_COMPARISON}`);
  console.log(`  Long table  : ${RC_LONG}`);
  console.log(`  Summary     : ${RC_SUMMARY}`);
}

// ── Rebuild from current PM export + existing Claude data ────────────────────
// Reads current PM Firestore export (PUBMETRIC_CSV) and existing comparison CSV
// (for Claude_* values). Re-applies buildRow with current logic, fixing stale
// PM values (e.g. zeros blanked by old buildRow, NaN from pre-fix export).
// Outputs *_rebuilt.csv files. Does NOT call Claude.
async function rebuild() {
  if (!fs.existsSync(COMPARISON_OUT)) {
    console.error(`ERROR: ${COMPARISON_OUT} not found — run validation first`);
    process.exit(1);
  }
  if (!fs.existsSync(PUBMETRIC_CSV)) {
    console.error(`ERROR: ${PUBMETRIC_CSV} not found — re-run export_validation_table.cjs first`);
    process.exit(1);
  }

  // Index current PM export by (study_author, outcome_name, timepoint) key.
  // The comparison CSV may have duplicate rows (e.g. if APPEND_MODE was used to
  // re-run a single study). Always use the first PM row for a given key.
  const pmRows = parseCsv(PUBMETRIC_CSV);
  const pmIndex = new Map();
  for (const row of pmRows) {
    const key = [
      row.study_author.trim(),
      row.outcome_name.trim(),
      (row.outcome_timepoint || '').trim()
    ].join('\x00');
    if (!pmIndex.has(key)) pmIndex.set(key, row);
  }

  const compRows = parseCsv(COMPARISON_OUT);
  const rebuiltRows = [];

  for (const row of compRows) {
    // Study-level sentinel rows carry over unchanged
    if (row.outcome === '*** STUDY LEVEL ***') {
      rebuiltRows.push({ ...row });
      continue;
    }

    const key = [
      row.study.trim(),
      row.outcome.trim(),
      row.timepoint.trim()
    ].join('\x00');

    const pmRow = pmIndex.get(key);

    if (!pmRow) {
      console.warn(`  [WARN] No PM row matched: ${key.replace(/\x00/g, ' | ')}`);
      rebuiltRows.push({ ...row });
      continue;
    }

    const claudeFound = row.claude_found_outcome === 'YES';
    const claudeOutcome = claudeFound ? {
      n_intervention:          row.Claude_n_intervention,
      n_control:               row.Claude_n_control,
      events_intervention:     row.Claude_events_intervention,
      events_control:          row.Claude_events_control,
      mean_intervention:       row.Claude_mean_intervention,
      sd_intervention:         row.Claude_sd_intervention,
      median_intervention:     row.Claude_median_intervention,
      iqr_lower_intervention:  row.Claude_iqr_lower_intervention,
      iqr_upper_intervention:  row.Claude_iqr_upper_intervention,
      mean_control:            row.Claude_mean_control,
      sd_control:              row.Claude_sd_control,
      median_control:          row.Claude_median_control,
      iqr_lower_control:       row.Claude_iqr_lower_control,
      iqr_upper_control:       row.Claude_iqr_upper_control,
      range_lower_intervention: row.Claude_range_lower_intervention,
      range_upper_intervention: row.Claude_range_upper_intervention,
      range_lower_control:     row.Claude_range_lower_control,
      range_upper_control:     row.Claude_range_upper_control,
      effect_size:             row.Claude_effect_size,
      ci_lower:                row.Claude_ci_lower,
      ci_upper:                row.Claude_ci_upper,
    } : null;

    rebuiltRows.push(buildRow(row.study, row.study_design, pmRow, claudeOutcome));
  }

  const RC_COMPARISON = './validation_comparison_rebuilt.csv';
  const RC_LONG       = './validation_comparison_long_rebuilt.csv';
  const RC_SUMMARY    = './validation_summary_rebuilt.csv';

  writeCsv(RC_COMPARISON, rebuiltRows);
  writeLongFormat(rebuiltRows, RC_LONG);
  writeSummary(rebuiltRows, RC_SUMMARY);

  console.log(`\nRebuilt from current PM export + existing Claude data:`);
  console.log(`  Wide table  : ${RC_COMPARISON}`);
  console.log(`  Long table  : ${RC_LONG}`);
  console.log(`  Summary     : ${RC_SUMMARY}`);
}

async function run() {
  await promptConfig();

  if (process.argv[2] === '--recompute') {
    await recompute();
  } else if (process.argv[2] === '--rebuild') {
    await rebuild();
  } else {
    await main();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
