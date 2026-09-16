---
title: "Ninety-seven percent of an annotation pipeline was annotating nothing"
date: 2026-06-24 10:00:00 -0400
category: Genomics
tags: [Genomics, Profiling, Annotation, Performance, Correctness]
summary: >-
  How to find out that the expensive stage of a variant annotation pipeline is
  spending almost all of its time on records with nothing to annotate, how to
  remove that work in the right order so you do not silently lose sites, and how
  to prove the fast output is identical to the slow one.
---

A variant annotation pipeline takes per-sample genomic VCF files in and produces annotated
variants out. It is slow. The obvious response is to make the annotator faster: more forks, faster
storage for the cache, a different annotation tool, a bigger node. All of those are real levers and
all of them are the wrong place to start.

The right place to start is a stopwatch on each stage, because the shape of this problem recurs: the
annotator is not slow, it is being asked to do roughly thirty-eight times more work than the
question requires. The records it spends its time on carry no alternate allele at all. There is
nothing to annotate, so it annotates nothing, carefully, twenty-five million times per sample.

What follows is the pattern — how to measure it, the pipeline that removes the waste, the
correctness trap that eats sites without telling you, the two tuning parameters that only showed up
in a sweep, and the caveat that limits the whole result to one file format.

## Measure the stages before touching anything

The first number you need is the split of wall time across stages. For a shell pipeline this does
not need a profiler. It needs timestamps that survive into the log:

```bash
stamp() { printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$TIMING"; }

stamp "start"
bcftools index -t "$GVCF"                                   ; stamp "index"
run_annotator "$GVCF" "$OUT"                                ; stamp "annotate"
postprocess "$OUT"                                          ; stamp "postprocess"
```

If the work runs under Slurm, take the per-step figures from the accounting database rather than
from the job script, and take them from the job steps, not the allocation:

```
$ sacct -j 4182377 --units=G \
    --format=JobID,JobName%18,Elapsed,TotalCPU,MaxRSS,State
JobID          JobName      Elapsed   TotalCPU     MaxRSS      State
4182377        annot-batch  05:02:11  19:55:38                COMPLETED
4182377.batch  batch        05:02:11  00:01:46      0.31G     COMPLETED
4182377.0      vep          04:53:02  19:41:08         9.8G   COMPLETED
4182377.1      post         00:08:57  00:12:44      1.20G     COMPLETED
```

Read the `TotalCPU` column carefully: it is `[DD-]HH:MM:SS`, so a leading day field changes the
value by a factor of twenty-four and is easy to skim past. Here `19:41:08` of CPU against `04:53:02`
of wall on the annotation step is 4.03x, which is the four forks the step was given and a useful
sanity check that the parallelism you asked for is the parallelism you got.

Two further warnings about that output, both of which produce confidently wrong answers. `MaxRSS` is
blank on the allocation line because the allocation itself has no measured process tree, so any
memory figure derived from a query with `-X` comes back as zero for every job. And if you derive CPU
efficiency from `CPUTimeRAW` rather than `TotalCPU` you get 1.0 for every job ever run, because
`CPUTimeRAW` is allocated core-seconds and not consumed ones. Use `TotalCPU` over `NCPUS * Elapsed`,
and query without `-X`.

The split from that run, for one representative sample on one node:

- annotation: 293.0 min
- everything else — indexing, splitting, post-processing, compression, QC summary: 9.0 min
- total: 302.0 min

Annotation is 97.0% of the wall time. Nothing else on the list can matter. If you halved the cost of
every other stage you would save four and a half minutes out of five hours.

## What is actually in the file

A per-sample genomic VCF is not a list of variants. It is a description of the whole callable
genome, in which the overwhelming majority of records say "this stretch matches the reference and
here is how confident I am". Those records carry a symbolic placeholder allele instead of a real
one: `<NON_REF>` for GATK and DRAGEN output, `<*>` for htslib-style gVCF. Reference blocks also
carry an `END` tag giving the last position of the block.

The important structural detail is that in a GATK-style gVCF the placeholder is present on *every*
record, including real variant records, where it sits last in the `ALT` list. So a reference block
looks like `ALT=<NON_REF>` and a variant looks like `ALT=A,<NON_REF>`. The test for "this record has
something to annotate" is therefore not "does the ALT column mention the placeholder" — it is "does
the ALT column contain anything besides the placeholder".

That distinction has teeth in bcftools expression syntax, because a comma inside a string is read as
a value separator and multiple values are combined with OR. `ALT="<NON_REF>"` is therefore *true* for
`ALT=A,<NON_REF>` — it matches the second value and stops caring about the first. Written alone as an
exclude expression it would discard every variant record in the file. The `N_ALT=1` conjunction is
what narrows it to records where the placeholder is the only allele, and it is the whole reason the
filter is two clauses rather than one.

```
$ bcftools view -H sample.g.vcf.gz | head -4 | cut -f1-5,10
chr1  10001  .  T  <NON_REF>    0/0:...
chr1  10002  .  A  <NON_REF>    0/0:...
chr1  10108  .  C  CAACCCT,<NON_REF>  0/1:...
chr1  10109  .  A  <NON_REF>    0/0:...
```

Count both classes:

```
$ bcftools view -H sample.g.vcf.gz | wc -l
26584113

$ bcftools view -H -e 'N_ALT=1 && ALT="<NON_REF>"' sample.g.vcf.gz | wc -l
690412
```

690,412 out of 26,584,113 is 2.60%. Removing the rest is a 38.5-fold reduction in records entering
the stage that is 97% of the cost.

Two honest caveats on those figures. They are one file, and absolute record counts in gVCFs are not
portable: reference-block banding differs sharply between callers and settings, and a file emitted at
base-pair resolution has a record per callable base, which is two orders of magnitude more. The
*ratio* is the durable number, and across the per-sample whole-genome gVCFs I have counted it sits in
the low single digits of a percent. If your own files give a ratio above about ten percent, either
they are not per-sample gVCFs or the caller banding is unusual, and you should check before assuming
this result transfers.

Cross-check the classification against the `END` tag rather than trusting a single expression:

```
$ bcftools query -f '%INFO/END\n' sample.g.vcf.gz | grep -cv '^\.$'
25893701
```

25,893,701 records carry an `END`, and 26,584,113 − 690,412 = 25,893,701. Two tests reading two
different fields — `ALT` and `INFO/END` — agree exactly, which is the point of running both. They are
not fully independent, since a caller that got one wrong could plausibly get the other wrong the same
way, but they do catch the failure that actually happens, which is an expression that means something
other than what you thought it meant.

## The pipeline

Order matters, for reasons covered in the next section. Filter first, split multi-allelic records
second, drop the placeholder third.

```bash
set -euo pipefail

REF=/ref/GRCh38.fa
IN=sample.g.vcf.gz
SITES=sample.sites.vcf.gz

bcftools view --threads 4 -e 'N_ALT=1 && ALT="<NON_REF>"' -Ou "$IN" \
  | bcftools norm -m -any -f "$REF" -Ou \
  | bcftools view --threads 4 -e 'ALT="<NON_REF>" || ALT="*"' -Oz -o "$SITES"

bcftools index -t "$SITES"
```

`--threads` appears only on the first and last commands on purpose. It is a BGZF compression and
decompression pool, so it buys something where a bgzipped file is being read and where one is being
written, and nothing at all on the middle stage, which takes uncompressed BCF on a pipe and emits the
same. Putting it everywhere is harmless but it is cargo cult, and it makes the stage look more
parallel than it is.

After `norm -m -any`, a record with `ALT=A,<NON_REF>` becomes two records, one with `ALT=A` and one
with `ALT=<NON_REF>`, so the final `view` removes the now-standalone placeholders. The same pass
drops spanning-deletion `*` alleles. A `*` is not a new allele: it marks a position overlapped by a
deletion called at an earlier position, so there is no consequence to compute for it. Drop them
deliberately rather than letting the annotator decide.

Then annotate the small file:

```bash
vep --offline --cache --dir_cache /ref/vep --assembly GRCh38 \
    --fasta "$REF" \
    --format vcf --vcf --compress_output bgzip \
    --allele_number \
    --no_stats \
    --fork 4 --buffer_size 50000 \
    -i "$SITES" -o sample.vep.vcf.gz
```

`--allele_number` is the one flag here whose purpose is routinely misread, including by me when I
first wrote this pipeline. The documentation says it will "identify allele number from VCF input,
where 1 = first ALT allele, 2 = second ALT allele etc." The obvious reading is that it preserves the
*pre-split* allele ordering so you can get back to the original multi-allelic record. It does not. The
index it records is the index within the file VEP was handed, and that file has already been split, so
`ALLELE_NUM` is 1 on every record. Recovering the unsplit record is a join on position plus `REF` and
`ALT`, and no VEP flag does it for you.

The flag still earns its place, for a different reason. The `Allele` field inside `CSQ` is a minimal
representation — VEP trims the sequence common to the reference and alternate alleles off both ends
before computing consequences — so for an insertion written as `REF=C ALT=CAACCCT` the `CSQ` allele is
`AACCCT`, which matches nothing in the `ALT` column. String-matching `CSQ` alleles against `ALT` works
for SNVs and quietly fails for indels. `ALLELE_NUM` being unconditionally 1 is what makes that
matching unnecessary: one input allele per record, so every consequence block on that record — and
there is one per overlapping transcript — belongs to that allele, tied by index rather than by
string.

`--no_stats` is worth a mention, with the caveat that the VEP documentation itself describes the
saving as marginal. I did not measure it in isolation, and on a 690,412-record input I would not
expect it to be visible against the other numbers here. The reason to set it is not speed, it is that
the summary is an HTML file nobody opens in a batch run and one more artefact per sample to clean up.

## The correctness trap

The first version of the filter was one command instead of three, and it used `--trim-alt-alleles`:

```bash
# WRONG - do not do this
bcftools view -a -e 'N_ALT=1 && ALT="<NON_REF>"' "$IN" -Oz -o "$SITES"
```

`-a` removes alternate alleles that are not present in any genotype. On a gVCF this looks like
exactly what you want: it strips the placeholder, it strips alleles the caller considered and
rejected, and it leaves a tidy file. The output was slightly smaller on disk than the three-command
version — not fewer records, fewer bytes — which read as the filter working harder.

It was not working harder. It was throwing away 2,157 sites per file, and the record count did not
move, which is exactly why it took a two-way comparison to find.

The sites it lost all had the same shape: a real alternate allele in `ALT`, and a genotype that did
not use it. Hom-ref and no-call genotypes on records that nonetheless carry a called alternate allele
are ordinary in a gVCF — the caller saw allele evidence, emitted the allele, and genotyped the sample
as reference or as uncallable. `-a` sees an allele absent from the genotype and removes it — and it
removes the placeholder on the same grounds, because `<NON_REF>` is not in any genotype either. The
documented behavior when nothing survives is the part that bites: "if no alternate allele remains
after trimming, the record itself is not removed but ALT is set to '.'". So the record stays. It
passes the exclude expression, because `N_ALT` is now zero and the expression asks about `N_ALT=1`. It
is counted in the filter output. It simply has no allele left to annotate, and it falls out inside the
annotator instead of at the filter, which is why the record count after the filter stage still looks
right. `-a` also trims `Number=A`, `G` and `R` tags to match, so the per-allele fields go with it.

The near-neighbour makes this worse. bcftools 1.19 added `-A, --trim-unseen-allele`, which removes
`<*>` or `<NON_REF>` specifically — at variant sites with `-A`, at all sites with `-AA` — without ever
consulting a genotype. That is the operation the first version was reaching for. One character of
difference between the flag that is safe here and the flag that silently drops called sites, and no
error from either.

Here is what finding it looked like. Compare the fast output against the baseline, in both
directions:

```
$ bcftools isec -C -w1 baseline.norm.vcf.gz fast.vep.vcf.gz | grep -vc '^#'
2157
$ bcftools isec -C -w1 fast.vep.vcf.gz baseline.norm.vcf.gz | grep -vc '^#'
0
```

Asymmetric loss, which immediately rules out a representation difference — those show up in both
directions. Then look at what was lost:

```
$ bcftools isec -C -w1 baseline.norm.vcf.gz fast.vep.vcf.gz \
    | bcftools query -f '[%GT]\n' - | sort | uniq -c | sort -rn
   1188 ./.
    902 0/0
     67 0|0
```

Every single lost site has a genotype that does not use the allele. That is the fingerprint, and it
points straight at the trimming flag.

Whether this matters depends on what the annotated output is for. If the only consumer is a
per-sample report of the variants this sample carries, the lost records were arguably noise. If the
output feeds a review queue, a re-genotyping step, a family or cohort comparison where "the caller
saw this allele and called hom-ref" is different from "the caller never saw this allele", or any
regulated workflow where the site list must be reproducible, then losing 2,157 sites per sample
without a log line is unacceptable. Removing work that is genuinely unnecessary is optimization.
Removing work you did not know you were doing is data loss, and the two are indistinguishable until
you compare outputs.

The fix is the ordering above: filter on the placeholder alone, split, then drop what the split
exposed. No stage ever consults a genotype, so no stage can drop a record for having the wrong one.
`-A` would do the third step too, and on a recent enough bcftools it is the more direct spelling; the
explicit `view -e` is what I left in because it also handles the `*` alleles and because it says out
loud what is being removed.

## What it cost and what it saved

One sample, one node, single file at a time:

| Stage | Baseline | Filter only | Filter + tuned annotator |
|---|---:|---:|---:|
| Filter, split, index | — | 5.5 min | 5.5 min |
| Annotation | 293.0 min | 7.6 min | 5.4 min |
| Post-processing, compress, QC | 9.0 min | 9.0 min | 9.0 min |
| **Total wall** | **302.0 min** | **22.1 min** | **19.9 min** |
| Speed-up vs baseline | 1.0x | 13.7x | 15.2x |
| Records entering annotation | 26,584,113 | 690,412 | 690,412 |
| Mean cost per record | 0.661 ms | 0.661 ms | 0.469 ms |
| Peak RSS, annotation | 9.8 GB | 4.1 GB | 11.6 GB |

The row that changed how I think about this is the second-to-last one. Before measuring, the
expectation was that reference blocks would be much cheaper per record than variant records — a
block has no consequence to compute, and a variant has to be intersected with every overlapping
transcript. If that were true, removing 97% of the records would remove far less than 97% of the
time, and the whole exercise would disappoint.

The measurement says the opposite. Cost per record was flat to three significant figures across a
38-fold change in what was in the file. The fixed per-record overhead — parse, buffer, region lookup,
serialize — dominates the consequence calculation so completely that the consequence calculation
barely registers. That is why the saving tracked record count almost exactly, and it is also a
useful general warning: the intuition that "the interesting records are the expensive ones" is worth
checking rather than assuming, and here it was simply false.

The arithmetic is then worth doing honestly, because the headline number is smaller than the naive
prediction. Amdahl on the profile says: 9.0 minutes of untouchable work plus 293.0/38.5 = 7.6 minutes
of annotation, which is 16.6 minutes, an 18.2x speed-up. The measured filter-only figure is 13.7x.
The gap is the filtering pass itself, which still has to decompress and read all 26,584,113 records —
you cannot skip records without looking at them — and which costs 5.5 minutes that Amdahl on the
original profile does not know about. Tuning the annotator then recovered 1.41x on the annotation
stage alone (7.6 minutes down to 5.4), which is worth only 1.11x on the total, because by that point
the total is dominated by the 14.5 minutes of filtering and post-processing that tuning does not
touch. 13.7x to 15.2x. Anyone quoting 38x from the record ratio alone has forgotten both the residual
3% and the cost of the skip.

## Two parameters that only turned up in a sweep

Neither of these would have been found by reasoning. Both came out of running the same 690,412-record
file across a grid.

Fork count, at a buffer of 50,000, on a node with 48 physical cores otherwise idle:

| `--fork` | Wall | Speed-up vs 1 | Parallel efficiency |
|---:|---:|---:|---:|
| 1 | 19.0 min | 1.00x | 100% |
| 2 | 10.2 min | 1.86x | 93% |
| 4 | 5.4 min | 3.52x | 88% |
| 8 | 6.1 min | 3.11x | 39% |
| 12 | 7.9 min | 2.41x | 20% |

There is a knee at four and a genuine regression beyond it, not a plateau. Eight forks is slower in
wall-clock terms than four while consuming twice the cores. My reading of the mechanism is that
forked workers hand results back to a single parent that has to collect them and re-emit records in
input order, so past a certain width the parent becomes the constraint and the workers wait on it —
but that is inference from the shape of the curve, not something I instrumented, and the knee may
well sit somewhere else for a different cache, a different record mix or a different VEP release.
What does transfer is the practical consequence: measure before widening, because on this stage
"give it more cores" made things worse, which is the opposite of the instinct that sends you to a
bigger node.

Buffer size, at four forks:

- 5,000 (the default): 7.6 min, 4.1 GB peak RSS
- 25,000: 5.9 min, 7.2 GB
- 50,000: 5.4 min, 11.6 GB
- 100,000: 5.4 min, 22.4 GB

1.41x from the default to 50,000, and nothing after that except memory. The buffer is how many
variants are held and processed as a batch, and a batch is resolved against the cache by region, so
a larger buffer means the same cache region is fetched and parsed fewer times. Once the buffer is
comfortably larger than the typical run of variants within one cache region, there is nothing left to
amortize, which is consistent with the flat line between 50,000 and 100,000. I am confident in the
measurement; the explanation is my reading of the behavior and not something I have confirmed
against the implementation.

Memory is the real limit here, and it interacts with the next section: 11.6 GB per file times six
concurrent files is 70 GB, which fits on a 192 GB node; 22.4 GB times six does not leave room for
page cache, and buys nothing.

## Concurrency, measured rather than assumed

The stage is now short enough that per-file parallelism is not the interesting axis. Running several
files at once is. With four forks each, six concurrent files put 24 forked workers on a 48-core node,
plus six parent processes that are collecting and serializing rather than computing.

Measured by running the identical file six times simultaneously and taking the wall time of each:

- one file alone: 19.9 min
- six files concurrently: mean 20.9 min, slowest 21.0 min

Per-file slowdown is 5%, so aggregate throughput is 95% of six times the single-file rate. Eight
concurrent files dropped to 82% efficiency, and the drop was in the annotation stage, not the filter
stage. Two explanations fit and I did not separate them: eight files is 32 workers plus eight
parents, which is 40 runnable processes on 48 cores and getting close enough to contend, and it is
also more concurrent readers against the same cache files, so page-cache pressure is equally
plausible. I would not present either as the cause.

Scaled to a batch of roughly 210 samples on four nodes, at six files in flight per node — 24
concurrent, so nine waves with the last one part-empty — the baseline pipeline is about 45 hours of
wall time and the revised one is a little over three. Both figures are arithmetic over the per-sample
measurements above, not a full batch re-run at both settings, and the two sides are not measured
equally: the revised figure uses the 20.9-minute six-concurrent number, while the baseline figure
uses the 302-minute single-file number, because I never ran six baseline files at once. If the
baseline carries the same concurrency penalty, it is nearer 47 hours and the ratio is slightly better
than stated. Scale to your own sample count before quoting any of it — the wave arithmetic is lumpy,
and a batch that does not divide evenly into 24 lands worse than the ratio suggests.

## Proving the output is identical

A 15x speed-up you cannot verify is a 15x speed-up you should not ship. Two properties need proving:
the same set of sites, and the same consequence calls at each site.

The trap in the comparison is that the fast path normalizes and splits multi-allelic records and the
baseline does not, so a direct diff shows thousands of differences that are pure representation.
Normalize both sides identically before comparing, using the same reference and the same options:

```bash
bcftools norm -m -any -f "$REF" baseline.vep.vcf.gz -Ou \
  | bcftools view -e 'ALT="<NON_REF>" || ALT="*"' -Oz -o baseline.norm.vcf.gz
bcftools index -t baseline.norm.vcf.gz
```

Site set, both directions:

```
$ bcftools isec -C -w1 baseline.norm.vcf.gz fast.vep.vcf.gz | grep -vc '^#'
0
$ bcftools isec -C -w1 fast.vep.vcf.gz baseline.norm.vcf.gz | grep -vc '^#'
0
```

Zero in both directions is the claim worth making. One direction alone proves nothing: a fast path
that emits a superset passes a one-way check.

What `isec` counts as "the same site" is worth knowing before you trust the zero. It defaults to
`--collapse none`, under which only records with identical `REF` and `ALT` are compatible, so this
comparison is on alleles and not merely on positions. That is the strict reading and the one you
want. Had it defaulted to `all`, two records at the same coordinate with completely different alleles
would have matched and both directions would have read zero while the alleles disagreed.

Consequence calls, by digest of the annotation payload rather than by eye:

```
$ for f in baseline.norm.vcf.gz fast.vep.vcf.gz; do
    bcftools query -f '%CHROM:%POS:%REF:%ALT\t%INFO/CSQ\n' "$f" \
      | sort | sha256sum | awk -v f="$f" '{print f, $1}'
  done
baseline.norm.vcf.gz  9f3c1b...e4a7
fast.vep.vcf.gz       9f3c1b...e4a7
```

Compare the body, never the whole file: the headers differ legitimately because they record the
command line and the run time. And the digest comparison is only meaningful if both runs used the
same annotator version, the same cache version and the same options — a cache upgrade between the
two runs changes consequence calls for real reasons and will produce a mismatch that has nothing to
do with your filter. Pin both, and record both in the run log.

A useful third check, cheap to run and independent of the first two:

```
$ for f in baseline.norm.vcf.gz fast.vep.vcf.gz; do bcftools +counts "$f"; done
Number of samples: 1
Number of SNPs:    598204
Number of INDELs:  92208
Number of MNPs:    0
Number of others:  0
Number of sites:   690412
```

Identical on both. 598,204 + 92,208 = 690,412, which also ties back to the pre-annotation count and
confirms nothing was added or lost inside the annotator.

That sum only works because the records are biallelic. The plugin increments a counter for *every*
variant type a record contains and increments the site counter once, so a multi-allelic record
carrying a SNV and an indel adds one to each of three counters. Run `+counts` on an unsplit file and
the categories over-sum against the site count, which looks like corruption and is not. The
cross-check is valid here because `norm -m -any` has already guaranteed one allele per record.

## The caveat that limits all of this

The waste removed here is a property of one file format. A per-sample genomic VCF describes every
callable position, so it is mostly reference blocks, so most of it is not annotatable. That is why
the filter works.

A joint-called multi-sample VCF has no reference blocks at all. It stores sites — positions where
at least one sample in the cohort carries something — and every record in it has a real alternate
allele. There is no 97% to remove. Applying this filter to a joint callset gives you a full
decompression-and-parse pass over the file that removes nothing, which is a pure regression, and the
"records entering annotation" row of that table would read the same before and after. It will not
cost the 5.5 minutes quoted above — a joint callset has far fewer records than a per-sample gVCF, so
the pass is proportionally cheaper — but cheaper than useless is still useless.

The equivalent saving on a joint callset exists but is on a completely different axis. The redundancy
there is across samples, not across positions: if you annotate N per-sample files independently, you
annotate the same common variants N times. The fix is to build one union site list, annotate it once,
and join the annotations back onto the per-sample files by position and allele:

```bash
bcftools merge -m none -Ou sample*.sites.vcf.gz \
  | bcftools norm -m -any -f "$REF" -Oz -o cohort.sites.vcf.gz
bcftools index -t cohort.sites.vcf.gz

vep --offline --cache --dir_cache /ref/vep --assembly GRCh38 --fasta "$REF" \
    --fork 4 --buffer_size 50000 --no_stats --vcf --allele_number \
    -i cohort.sites.vcf.gz -o cohort.csq.vcf.gz --compress_output bgzip
bcftools index -t cohort.csq.vcf.gz

bcftools annotate -a cohort.csq.vcf.gz -c INFO/CSQ \
    -o sample.annotated.vcf.gz -Oz sample.sites.vcf.gz
```

The join in that last command is the place it goes wrong. When the annotation file is a VCF,
`bcftools annotate` matches on `CHROM`, `POS`, `REF` and `ALT`, and a record that does not match is
left unannotated in silence — there is no warning and no non-zero exit. So both sides have to have
been normalized with `norm -m -any` against the *same* reference FASTA, or a left-alignment
difference at a repeat-adjacent indel produces two records that a human would call the same variant
and bcftools will not. Check the join by counting records with a missing `CSQ` afterwards rather than
assuming it landed. The annotation file also has to be bgzip-compressed and indexed, which is what
the `index -t` above is for.

The scaling of that is set by the overlap between samples, not by the reference-block fraction, and
the overlap depends on cohort size and ancestry composition. I have not measured it carefully enough
to quote a factor, so I will not quote one.

One last thing that is easy to get wrong at the end of a project like this. The filtered file is an
annotation *input*, not a replacement for the gVCF. The reference blocks you removed are what
distinguishes "this sample has no variant here" from "this position was never callable in this
sample", and that distinction is the entire reason the gVCF format exists. Keep the original. The
optimization is that the annotator never sees it.

## What to take from this

Profile first, in stages, with timestamps that end up in a log someone else can read. If one stage is
97% of the cost, nothing you do to the other stages matters, and the only question worth asking about
that stage is whether the work it is doing needs doing at all.

Then verify in both directions before you believe your own result, because the fastest version of any
pipeline is the one that quietly does less than it should, and it will pass every check that only
looks at how long it took.
