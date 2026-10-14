# Score the TXA P2 rerun against the TXA post-adjudication reference used in the paper.
# Reference (same rules as TXA-validation-stats-full.R):
#   match YES                         -> PubMetric P1 value (P1 and Claude agreed)
#   NO + "PubMetric correct" comment  -> P1 value
#   NO + "PubMetric incorrect" comment-> Claude value
#   NO + ambiguous comment            -> excluded (reported separately)
import csv, json, glob, os, re, difflib
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', '..', 'data', 'txa_validation_comparison_adjudicated.csv')
PM_CORRECT = {"PM is correct", "PM appears correct", "PM has plausible calculated value",
              "Not incorrect compares 128 vs 64 slice CT", "rounding difference, not incorrect",
              "This is correct but no SD in PDF"}
CLAUDE_CORRECT = {"PM incorrect", "PM does not store median in multi-arm study. This exposes a deficiency."}
FIELD = {'N (intervention arm)': 'n_intervention', 'N (control arm)': 'n_control',
         'Events (intervention arm)': 'events_intervention', 'Events (control arm)': 'events_control',
         'Mean (intervention arm)': 'mean_intervention', 'Mean (control arm)': 'mean_control',
         'SD (intervention arm)': 'sd_intervention', 'SD (control arm)': 'sd_control',
         'Median (intervention arm)': 'median_intervention', 'Median (control arm)': 'median_control',
         'IQR lower (intervention arm)': 'iqr_lower_intervention', 'IQR upper (intervention arm)': 'iqr_upper_intervention',
         'IQR lower (control arm)': 'iqr_lower_control', 'IQR upper (control arm)': 'iqr_upper_control',
         'Range lower (intervention arm)': 'range_lower_intervention', 'Range upper (intervention arm)': 'range_upper_intervention',
         'Range lower (control arm)': 'range_lower_control', 'Range upper (control arm)': 'range_upper_control',
         'Effect size': 'precalc_effect', '95% CI lower': 'precalc_ci_lower', '95% CI upper': 'precalc_ci_upper'}

def num(v):
    try: return float(str(v).replace(',', ''))
    except: return None
def norm(s): return re.sub(r'[^a-z0-9<>=%]+', ' ', str(s).lower()).strip()

lookup = {r['study_key']: r['pdf_filename'] for r in csv.DictReader(open(os.path.join(HERE, 'study_pdf_lookup.csv'), encoding='utf-8-sig'))}
p2 = {}
for f in glob.glob(os.path.join(HERE, 'raw', 'p2txa-*.json')):
    d = json.load(open(f)); p2[d['pdf']] = d['data'].get('available_outcomes', []) if d.get('data') else []

ref = list(csv.DictReader(open(REF, encoding='utf-8-sig')))
cells, ambiguous = [], []
for r in ref:
    if r['match'] not in ('YES', 'NO ✗'): continue
    c = r.get('Clay comments', '').strip()
    if r['match'] == 'YES' or c in PM_CORRECT: truth = r['PM_value']
    elif c in CLAUDE_CORRECT: truth = r['Claude_value']
    else: ambiguous.append(r); continue
    cells.append((r, truth))

# outcome matching (one-to-one per study). Score = name similarity + containment + timepoint + data type,
# with numeric agreement on N/events as a tie-breaker only (weight 0.3). Every pairing is written to
# results/outcome_matching.csv for human review.
STOP = set('the a an of in at and or with for to vs versus day days post trauma rate'.split())
def toks(s): return {t for t in norm(s).split() if t not in STOP}
ref_by_study = defaultdict(dict)
for r, t in cells + [(a, None) for a in ambiguous]:
    ref_by_study[r['study']].setdefault((r['study'], r['outcome'], r['timepoint'], r['data_type']), {})[FIELD[r['field']]] = r['PM_value']
match_log, best = [], {}
for study, refs in ref_by_study.items():
    outs = p2.get(lookup[study])
    if outs is None:
        for k in refs: best[k] = None; match_log.append([study, k[1], k[2], '', '', 'PDF not extracted'])
        continue
    pairs = []
    for k, vals in refs.items():
        for j, o in enumerate(outs):
            on = o.get('name', '')
            sim = difflib.SequenceMatcher(None, norm(on), norm(k[1])).ratio()
            rt, ot = toks(k[1]), toks(on)
            cont = 1.0 if rt and rt <= ot else (len(rt & ot) / len(rt) if rt else 0)
            # guard against qualifier mismatches ("Shock" vs "No shock", "Adjusted" vs unadjusted)
            for q in ('no', 'adjusted', 'unadjusted'):
                if (q in norm(k[1]).split()) != (q in norm(on).split()): cont *= 0.5; sim *= 0.8
            tp = 0.15 if norm(o.get('timepoint', '')) == norm(k[2]) else 0
            dt = 0.1 if (o.get('data_type') or '').lower() == k[3].lower() else 0
            nv = [(num(v), num(o.get(f))) for f, v in vals.items() if num(v) is not None and num(v) != 1]
            va = (sum(1 for a, b in nv if b is not None and a == b) / len(nv)) if nv else 0
            nfull = len(nv) if va == 1 else 0
            score = 0.5 * sim + 0.5 * cont + tp + dt + 0.3 * va
            pairs.append((score, k, j, sim, cont, va, nfull))
    pairs.sort(key=lambda x: -x[0]); used_k, used_j = set(), set()
    for score, k, j, sim, cont, va, nfull in pairs:
        if k in used_k or j in used_j: continue
        # accept on name, or on a different name whose numbers all agree (>= 2 numbers; same outcome, renamed)
        if cont < 0.6 and sim < 0.6 and nfull < 2: continue
        used_k.add(k); used_j.add(j); best[k] = outs[j]
        match_log.append([study, k[1], k[2], outs[j].get('name', ''), round(score, 2), f'matched (name {sim:.2f}, words {cont:.2f}, numbers {va:.2f})'])
    for k in refs:
        if k not in used_k: best[k] = None; match_log.append([study, k[1], k[2], '', '', 'NOT FOUND in P2'])
    for j, o in enumerate(outs):
        if j not in used_j: match_log.append([study, '', '', o.get('name', ''), '', 'P2 only (not in reference)'])

rows, tally = [], Counter()
for r, truth in cells:
    o = best[(r['study'], r['outcome'], r['timepoint'], r['data_type'])]
    v = o.get(FIELD[r['field']]) if o else None
    a, b = num(v), num(truth)
    if o is None: status = 'outcome not found'
    elif a is None: status = 'value missing'
    else: status = 'correct' if b is not None and abs(a - b) < 1e-9 else 'incorrect'
    p1_ok = num(r['PM_value']) is not None and b is not None and abs(num(r['PM_value']) - b) < 1e-9
    tally[status] += 1; tally['p1_correct'] += p1_ok
    rows.append([r['study'], r['outcome'], r['timepoint'], r['field'], truth, r['PM_value'], 'YES' if p1_ok else 'NO', '' if v is None else v, status, o.get('name', '') if o else '', (o.get('source_quote', '') if o else '')[:400]])

out = os.path.join(HERE, 'results')
os.makedirs(out, exist_ok=True)
w = csv.writer(open(os.path.join(out, 'p2_vs_txa_reference.csv'), 'w', newline=''))
w.writerow(['study', 'outcome', 'timepoint', 'field', 'reference_value', 'P1_value', 'P1_correct', 'P2_value', 'P2_status', 'P2_outcome_name', 'P2_source_quote']); w.writerows(rows)
w = csv.writer(open(os.path.join(out, 'outcome_matching.csv'), 'w', newline=''))
w.writerow(['study', 'reference_outcome', 'timepoint', 'best_P2_outcome', 'match_score', 'result']); w.writerows(match_log)
n = len(cells)
print(f'Scored cells: {n} (excluded as ambiguous: {len(ambiguous)})')
print(f'P1 (reported run) correct: {tally["p1_correct"]}/{n} = {100*tally["p1_correct"]/n:.1f}%')
print(f'P2 correct: {tally["correct"]}/{n} = {100*tally["correct"]/n:.1f}%  | incorrect {tally["incorrect"]} | value missing {tally["value missing"]} | outcome not found {tally["outcome not found"]}')
print(f'PDFs extracted: {len(p2)}/31; reference outcomes matched: {sum(1 for m in match_log if m[5].startswith("matched"))}/{len(best)}; P2-only outcomes: {sum(1 for m in match_log if m[5].startswith("P2 only"))}')
