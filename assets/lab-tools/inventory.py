#!/usr/bin/env python3
"""Read-only, local Linux baseline. No identifiers, addresses, package dumps or uploads.
Python 3.9+. Output is operational information: review before sharing.
"""
import argparse, csv, datetime, io, json, os, platform, shutil, subprocess
from pathlib import Path

def read(path):
    try:return path.read_text().strip()
    except (OSError, UnicodeError):return None

def collect(sys_root=Path('/sys')):
    report={'schema_version':1,'collected_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'local read-only baseline; no network requests','platform':{'system':platform.system(),'kernel':platform.release(),'architecture':platform.machine(),'logical_cpu_count':os.cpu_count()},'network':[],'rdma':[],'gpu':{'status':'tool_missing','devices':[]}}
    os_release={}
    try:
        for line in Path('/etc/os-release').read_text().splitlines():
            key,sep,val=line.partition('=')
            if sep and key in ('ID','VERSION_ID'):os_release[key]=val.strip('"')
    except OSError:pass
    report['platform']['os_release']=os_release
    for net in sorted((sys_root/'class/net').glob('*')):
        report['network'].append({'interface':net.name,'state':read(net/'operstate'),'mtu':read(net/'mtu')})
    for dev in sorted((sys_root/'class/infiniband').glob('*')):
        ports=[]
        for port in sorted((dev/'ports').glob('*')):
            ports.append({'port':port.name,'state':read(port/'state'),'physical_state':read(port/'phys_state'),'rate':read(port/'rate'),'link_layer':read(port/'link_layer')})
        report['rdma'].append({'device':dev.name,'ports':ports})
    exe=shutil.which('nvidia-smi')
    if exe:
        try:
            result=subprocess.run([exe,'--query-gpu=name,driver_version,memory.total','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=8,check=False)
            report['gpu']['status']='available' if result.returncode==0 else 'query_failed'
            report['gpu']['return_code']=result.returncode
            if result.returncode==0:
                for row in csv.reader(io.StringIO(result.stdout)):
                    if len(row)!=3:report['gpu']['status']='unexpected_output';continue
                    report['gpu']['devices'].append(dict(zip(('model','driver','memory_mib'),(x.strip() for x in row))))
        except subprocess.TimeoutExpired:report['gpu']['status']='query_timed_out'
        except OSError:report['gpu']['status']='query_failed'
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',help='New JSON file; refuses to overwrite an existing file');args=parser.parse_args();text=json.dumps(collect(),indent=2)+'\n'
    if args.out:
        try:
            fd=os.open(args.out,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,'w') as f:f.write(text)
        except OSError as e:parser.exit(1,'Cannot create output: '+str(e)+'\n')
    else:print(text,end='')
if __name__=='__main__':main()
