#!/usr/bin/env python3
"""Boundary checks for the public lab tools; uses only local fixtures."""
import csv,importlib.util,io,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1];LAB=ROOT/'assets/lab-tools'
def module(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
counter=module('counter',LAB/'counter-delta.py');manifest=module('manifest',LAB/'validate-manifest.py');inventory=module('inventory',LAB/'inventory.py')
class LabTools(unittest.TestCase):
 def test_counter_preserves_large_integer_delta(self):
  s='timestamp_seconds,device,counter,value\n10,a,c,9007199254740993\n14,a,c,9007199254740994\n';r=counter.calculate(io.StringIO(s),4);self.assertEqual(r[0][4],'1');self.assertEqual(r[0][6],'1.000000')
 def test_synthetic_rates(self):
  with (LAB/'counter-samples.csv').open() as f:r=counter.calculate(f,4)
  self.assertEqual([x[-1] for x in r],['1.000000','0.500000'])
 def test_reset_rejected(self):
  with self.assertRaisesRegex(ValueError,'decreased'):counter.calculate(io.StringIO('timestamp_seconds,device,counter,value\n1,a,c,100\n2,a,c,3\n'),4)
 def test_duplicate_timestamp_rejected(self):
  with self.assertRaisesRegex(ValueError,'Duplicate'):counter.calculate(io.StringIO('timestamp_seconds,device,counter,value\n1,a,c,1\n1,a,c,2\n'),1)
 def test_nonfinite_timestamp_rejected(self):
  with self.assertRaises(ValueError):counter.calculate(io.StringIO('timestamp_seconds,device,counter,value\nNaN,a,c,1\n2,a,c,2\n'),1)
 def test_incomplete_series_rejected(self):
  with self.assertRaisesRegex(ValueError,'two samples'):counter.calculate(io.StringIO('timestamp_seconds,device,counter,value\n1,a,c,1\n'),1)
 def test_counter_cli_emits_no_partial_rates_on_error(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'reset.csv';p.write_text('timestamp_seconds,device,counter,value\n1,a,c,10\n2,a,c,2\n');r=subprocess.run([sys.executable,str(LAB/'counter-delta.py'),str(p),'--unit-bytes','4'],capture_output=True,text=True)
   self.assertNotEqual(r.returncode,0);self.assertEqual(r.stdout,'')
 def test_manifest_not_run_is_explicit(self):
  d=json.loads((LAB/'benchmark-manifest.json').read_text());self.assertEqual(manifest.validate(d),[]);d['result']['value']=10;self.assertTrue(manifest.validate(d))
 def test_manifest_pass_requires_value_and_evidence(self):
  d=json.loads((LAB/'benchmark-manifest.json').read_text());d['result']={'status':'pass','value':'NaN'};d['evidence']=[];self.assertTrue(manifest.validate(d))
 def test_manifest_incomplete_and_bad_ranges(self):
  d=json.loads((LAB/'benchmark-manifest.json').read_text());d['measurement']['duration_seconds']=0;del d['placement']['gpu_nic_map'];self.assertTrue(manifest.validate(d))
 def test_inventory_missing_tool_does_not_claim_gpu_absence(self):
  with tempfile.TemporaryDirectory() as td,patch.object(inventory.shutil,'which',return_value=None):
   d=inventory.collect(Path(td));self.assertEqual(d['gpu']['status'],'tool_missing');self.assertNotIn('hostname',json.dumps(d));self.assertEqual(d['rdma'],[])
 def test_inventory_query_failure_is_distinct(self):
  r=subprocess.CompletedProcess([],1,stdout='',stderr='private host diagnostic')
  with tempfile.TemporaryDirectory() as td,patch.object(inventory.shutil,'which',return_value='/example/nvidia-smi'),patch.object(inventory.subprocess,'run',return_value=r):
   d=inventory.collect(Path(td));self.assertEqual(d['gpu']['status'],'query_failed');self.assertNotIn('private host',json.dumps(d))
 def test_inventory_writes_new_private_file_and_refuses_overwrite(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'baseline.json';r=subprocess.run([sys.executable,str(LAB/'inventory.py'),'--out',str(p)],capture_output=True,text=True);self.assertEqual(r.returncode,0);first=p.read_bytes();self.assertEqual(p.stat().st_mode&0o777,0o600);r=subprocess.run([sys.executable,str(LAB/'inventory.py'),'--out',str(p)],capture_output=True,text=True);self.assertNotEqual(r.returncode,0);self.assertEqual(p.read_bytes(),first)
if __name__=='__main__':unittest.main(verbosity=2)
