# Score TNK run 1 (P1 prompt) against the TNK adjudicated ground truth (three-physician consensus), on the same 247 cells used for the reported run 2.
import csv
import os
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data')
GT=os.path.join(D,'tnk_ground_truth.csv')  # adjudicated ground truth (three-physician consensus)
gt=list(csv.DictReader(open(GT,encoding='utf-8-sig')))
r1=list(csv.DictReader(open(os.path.join(D,'tnk_run1_validation_table_s1eXSMfUh2LF28hgzCoV.csv'),encoding='utf-8-sig')))
# ground-truth outcome order per study -> run-1 outcome_index (verified by hand, names/timepoints align)
MAP={'Albers':list(range(1,13)),'Cheng':[1,2,3,4,5,6,7,9,10,11,12,13],'Wang':list(range(1,17)),'Xiong':list(range(1,14))+[18,19,20]}
order={}
for x in gt:
  if x['PM_truth'] in('YES','NO'):
    order.setdefault(x['study'],[])
    k=(x['outcome'],x['timepoint'])
    if k not in order[x['study']]: order[x['study']].append(k)
r1i={(x['study_author'],int(x['outcome_index'])):x for x in r1}
def num(v):
  try: return float(v)
  except: return None
rows=[];ok=0;tot=0
for x in gt:
  if x['PM_truth'] not in('YES','NO'): continue
  truth=x['Ground Truth'] if x['Ground Truth']!='' else x['PM_value']
  idx=MAP[x['study']][order[x['study']].index((x['outcome'],x['timepoint']))]
  o=r1i[(x['study'],idx)]
  v=o.get(x['field'],'')
  a,b=num(v),num(truth)
  match = (a is not None and b is not None and abs(a-b)<1e-9)
  tot+=1; ok+=match
  rows.append([x['study'],x['outcome'],x['field'],truth,x['PM_value'],v,'YES' if match else 'NO',o['outcome_name']])
w=csv.writer(open(os.path.join(D,'tnk_run1_vs_adjudicated_ground_truth.csv'),'w',newline=''))
w.writerow(['study','outcome (adjudicated ground truth)','field','adjudicated_ground_truth','run2_value','run1_value','run1_match','run1_outcome_name']); w.writerows(rows)
print(f'Run 1: {ok}/{tot} = {100*ok/tot:.1f}%')
for r in rows:
  if r[6]=='NO': print(r[0],'|',r[1][:55],'|',r[2],'| truth',r[3],'| run2',r[4],'| run1',r[5])
