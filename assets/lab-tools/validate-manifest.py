#!/usr/bin/env python3
"""Validate a benchmark run record locally. Does not run a benchmark or attest a result."""
import argparse,json
from decimal import Decimal
REQUIRED=('run_id','purpose','workload','hardware','software','placement','data','measurement','acceptance','evidence','result')
def validate(d):
    errors=[]
    if not isinstance(d,dict):return ['Manifest must be a JSON object']
    for key in REQUIRED:
        if key not in d or d[key] in ('',None,{},[]):errors.append('Missing '+key)
    for key in ('workload','hardware','software','placement','data','measurement','acceptance','result'):
        if not isinstance(d.get(key),dict):errors.append(key+' must be an object')
    for section,keys in {'workload':['name','command','input_identity'],'hardware':['node_count','gpu_count','topology_reference'],'software':['os','driver','communication_library','container_digest'],'placement':['ranks','cpu_binding','gpu_nic_map'],'data':['size_bytes','cache_policy'],'measurement':['warmup_seconds','duration_seconds','repetitions','metric','unit'],'acceptance':['criterion','approved_by'],'result':['status','value']}.items():
        value=d.get(section)
        if isinstance(value,dict):
            for key in keys:
                if key not in value or value[key] in ('',None,[],{}):errors.append('Missing '+section+'.'+key)
    for section,key,minimum in [('hardware','node_count',1),('hardware','gpu_count',0),('placement','ranks',1),('data','size_bytes',0),('measurement','warmup_seconds',0),('measurement','duration_seconds',1),('measurement','repetitions',1)]:
        value=d.get(section,{});v=value.get(key) if isinstance(value,dict) else None
        if type(v) is not int or v<minimum:errors.append(section+'.'+key+' must be an integer >= '+str(minimum))
    result=d.get('result',{})
    if isinstance(result,dict):
        status=result.get('status')
        if status not in ('not_run','pass','fail','inconclusive'):errors.append('Invalid result.status')
        v=result.get('value')
        if status=='not_run' and v!='not_measured':errors.append('not_run requires value not_measured')
        if status in ('pass','fail'):
            try:
                if isinstance(v,bool) or not Decimal(str(v)).is_finite():raise ValueError()
            except Exception:errors.append('pass/fail requires a finite numeric result.value')
            if not isinstance(d.get('evidence'),list) or not d['evidence']:errors.append('pass/fail requires evidence file references')
    if not isinstance(d.get('evidence'),list):errors.append('evidence must be a list')
    return errors

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('manifest');a=p.parse_args()
    try:
        with open(a.manifest) as f:d=json.load(f)
        errors=validate(d)
    except (OSError,ValueError) as e:p.exit(1,str(e)+'\n')
    print(json.dumps({'valid':not errors,'benchmark_executed':False,'errors':errors},indent=2));return bool(errors)
if __name__=='__main__':raise SystemExit(main())
