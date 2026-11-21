Wirewalk public lab toolkit — version 1.0 (2026-11-21)
https://www.wirewalk.com/lab/

Python 3.9+; standard library only. MIT license; see LICENSE.txt.
Download, inspect source, then run locally. No email signup or automatic upload.

1. inventory.py
   python3 inventory.py --out baseline.json
   Read-only Linux baseline; optional local nvidia-smi query with an 8-second timeout.
   No privilege escalation, commands through a shell, network requests or config changes.
   A new output file is created with mode0600. Existing files are not overwritten.
   Addresses, hostnames, serials and GPU UUIDs are omitted; review all output before sharing.
   Missing tool/query errors are distinct from an observed device list.
   This is not a complete health check or performance test.

2. counter-delta.py
   python3 counter-delta.py counter-samples.csv --unit-bytes 4
   Offline CSV processing. Header: timestamp_seconds,device,counter,value
   Each device/counter requires at least two samples. Units must be verified explicitly.
   Rejects bad samples, duplicate timestamps and decreasing counters (possible reset/wrap).
   Raw counter values are integers; rates use Decimal arithmetic.
   Included values are synthetic, not hardware measurements. Result: rail-a 1 GiB/s, rail-b 0.5 GiB/s.

3. validate-manifest.py
   python3 validate-manifest.py benchmark-manifest.json
   Checks required structure, selected field types/ranges and result-state consistency.
   Does not run benchmarks, inspect referenced evidence files, verify placeholder replacement,
   attest scientific correctness, approve an acceptance criterion or certify a result.
   The sample is intentionally not_run/not_measured. Fill in actual evidence before use.

4. acceptance-checklist.csv
   Local worksheet with ownership, evidence and explicit not_run state.
   Adapt to the accepted scope. It does not replace a written acceptance plan.

Read the guides and each script's --help before use. The site includes complete explanations,
version-sensitive command caveats and related primary documentation.
