#!/usr/bin/env python3
"""Offline deltas from CSV: timestamp_seconds,device,counter,value.
No hardware access. Explicit units required. Resets/wraps and duplicate samples fail closed.
"""
import argparse,csv,io,sys
from decimal import Decimal,InvalidOperation,localcontext
from collections import defaultdict

def calculate(source,unit_bytes):
    if unit_bytes<=0:raise ValueError('unit-bytes must be positive')
    rows=csv.DictReader(source)
    if rows.fieldnames!=['timestamp_seconds','device','counter','value']:raise ValueError('Unexpected CSV header')
    samples=defaultdict(dict)
    for r in rows:
        if None in r or any(r[k] is None for k in rows.fieldnames):raise ValueError('Malformed CSV row')
        t=Decimal(r['timestamp_seconds']);v=int(r['value']);key=(r['device'],r['counter'])
        if not t.is_finite() or t<0 or v<0 or not all(key):raise ValueError('Invalid sample')
        if t in samples[key]:raise ValueError('Duplicate timestamp for '+repr(key))
        samples[key][t]=v
    if not samples:raise ValueError('No samples')
    out=[]
    with localcontext() as ctx:
        ctx.prec=70
        for (device,counter),group in sorted(samples.items()):
            ordered=sorted(group.items())
            if len(ordered)<2:raise ValueError('At least two samples required for '+device+'/'+counter)
            for (t0,v0),(t1,v1) in zip(ordered,ordered[1:]):
                if v1<v0:raise ValueError('Counter decreased: possible reset/wrap; no rate emitted for '+device+'/'+counter)
                dt=t1-t0;delta=v1-v0;bps=Decimal(delta)*unit_bytes/dt
                out.append([device,counter,str(t0),str(t1),str(delta),str(unit_bytes),format(bps,'.6f'),format(bps/Decimal(1073741824),'.6f')])
    return out

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('csv');p.add_argument('--unit-bytes',type=int,required=True,help='Bytes represented by one counter unit; verify the counter definition');a=p.parse_args()
    try:
        with open(a.csv,newline='') as f:rows=calculate(f,a.unit_bytes)
    except (OSError,ValueError,InvalidOperation,csv.Error) as e:p.exit(1,'No rates emitted: '+str(e)+'\n')
    w=csv.writer(sys.stdout);w.writerow(['device','counter','start_seconds','end_seconds','delta_units','bytes_per_unit','bytes_per_second','gib_per_second']);w.writerows(rows)
if __name__=='__main__':main()
