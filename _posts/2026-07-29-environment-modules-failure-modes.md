---
title: "Nine ways an environment module makes working software look broken"
date: 2026-07-29 10:00:00 -0400
category: HPC
tags: [Modules, Lmod, Python, Java, Diagnostics]
summary: >-
  The environment module system fails quietly by design, and almost every one of
  its failures presents as missing or broken software. This walks through nine
  mechanisms, the command that distinguishes each from the others, and a
  verification harness that loads every module in a clean shell and runs it.
---

A user reports a tool is broken. You load the module, run the tool, and it works. The user runs
the same three lines and it does not. Nothing in either transcript looks wrong.

That shape of report is almost always the module system, not the software, and it costs so much
time because environment modules fail silently by construction. A modulefile sets variables.
Setting one to a directory that does not exist is not an error. Forgetting the matching `PATH`
entry is not an error. Loading a module whose files were deleted six months ago is not an error.
The module system reports success in all three cases, and the failure surfaces elsewhere — as
`command not found`, a missing Python package, or a linker error naming an unfamiliar symbol
version.

What follows is nine mechanisms, each with the command that tells it apart, then a harness that
catches most of them before a user does.

## What `module` actually is

Everything here follows from one fact. `module` is not a program. It is a shell function that runs
a program, captures the shell code it prints, and evaluates that in your current shell. Lmod
defines it around `$LMOD_CMD`, Tcl Environment Modules around `modulecmd`. Watch it work:

```
$ $LMOD_CMD bash load gcc/12.3.0 2>/dev/null
PATH=/opt/apps/gcc/12.3.0/bin:/usr/local/bin:/usr/bin:/bin; export PATH;
LD_LIBRARY_PATH=/opt/apps/gcc/12.3.0/lib64; export LD_LIBRARY_PATH;
LOADEDMODULES=gcc/12.3.0; export LOADEDMODULES;
```

That is the shape of it, abridged: a real Lmod run also emits `_LMFILES_`, reference counts and
its serialized module table, which is noise for this purpose but worth seeing once.

Two consequences follow. First, the effect of `module load` is confined to the shell that ran the
`eval`; put it anywhere the shell forks and it lands in a child that exits immediately. Second,
the shell code has to have stdout to itself, so diagnostics go somewhere else — and where they go
depends on which implementation you have. Lmod writes the output of `module list`, `module avail`
and friends to stderr by default; `LMOD_REDIRECT=yes` (or `--redirect`) moves it to stdout, and the
Lmod documentation notes that only works for bash and zsh, not csh or tcsh. Tcl Environment Modules
went the other way: current releases document a `redirect_output` configuration option that
defaults to on, so on sh, bash, ksh, zsh and fish the messages arrive on stdout unless someone
passes `--no-redirect`. Check yours with `module config` rather than assuming either default.

The practical consequence is that `module list | grep` works on one of your clusters and silently
returns nothing on the other, and the reader concludes the module is not loaded. Redirect
explicitly and the question does not arise:

```
$ module list | grep -c gcc      # 0 under Lmod's default, 1 under Modules' default
$ module list 2>&1 | grep -c gcc # 1 under both
```

For anything you intend to parse rather than read, `module -t list` (terse) is a better input than
the decorated human output.

## 1. A load inside a pipe or a command substitution goes nowhere

This is the one that costs hours, because every line of output looks correct.

```
$ cat wanted.txt | while read -r m; do module load "$m"; done
$ module list 2>&1
No modules loaded
$ samtools --version
bash: samtools: command not found
```

No error was printed and the loads succeeded. In bash each stage of a pipeline runs in a subshell,
so the `while` loop — and the `eval` inside `module` — executed in a forked child. The child
exported the variables and exited. The parent shell was never touched. (Bash has one escape hatch
here, `shopt -s lastpipe`, which runs the final stage in the current shell — but only when job
control is off, so it does nothing in an interactive session, which is exactly where people test
it.)

The command substitution version is worse, because the inner answer is right:

```
$ VER=$(module load python/3.11.6 && python3 --version)
$ echo "$VER"
Python 3.11.6
$ python3 --version
Python 3.9.18
```

The load did work — inside the subshell, where `python3` really was 3.11.6, which is why the
captured string looks like proof that the module is loaded. The parent shell has nothing loaded,
and the next line in the script is the one that fails.

Two more places the fork is invisible: every recipe line in a makefile runs in its own shell, so
`module load` on one line and `$(CC)` on the next are unrelated environments, and `xargs` execs a
fresh process per batch. Over ssh without a login shell the function is often not defined at all.

The fixes are mechanical — a process-substitution loop keeps the body in the current shell, make
wants `&&` or `.ONESHELL:`, and ssh wants the init script sourced explicitly.

```
$ while read -r m; do module load "$m"; done < <(grep -v '^#' wanted.txt)
$ ssh node 'source /usr/share/lmod/lmod/init/bash && module load gcc/12.3.0 && gcc --version'
```

The diagnostic that settles it in one line: after the load, print `LOADEDMODULES` in the shell you
care about. If it is empty there, the load happened somewhere else.

## 2. `which` says one thing and a different binary runs

This is the section where the obvious reading is wrong twice — once about the symptom, and once
about the fix nearly everyone prescribes for it.

```
$ module load python/3.11.6
$ which python3
/opt/apps/python/3.11.6/bin/python3
$ python3 --version
Python 3.9.18
```

The standard answer is that bash has cached the old location and you need `hash -r`. Test that
before believing it, because in bash it is not what happened:

```
$ mkdir -p /tmp/ht/a /tmp/ht/b
$ printf '#!/bin/sh\necho A\n' > /tmp/ht/a/foo
$ printf '#!/bin/sh\necho B\n' > /tmp/ht/b/foo
$ chmod +x /tmp/ht/a/foo /tmp/ht/b/foo
$ PATH=/tmp/ht/a:$PATH
$ foo                                        # runs, and is now hashed
A
$ eval 'PATH=/tmp/ht/b:$PATH; export PATH;'  # exactly what module load evaluates
$ foo
B
```

Assigning to `PATH` makes bash discard every remembered location — plainly, with `export`, from
inside a function, or inside the `eval` that the `module` function runs. All four behave the same
way on the bash used for the transcripts here (3.2.57); the test above takes two minutes on
whatever bash your cluster actually runs, and is worth doing before you accept either account. zsh
behaves the same, and tcsh rebuilds its hash when `path` is set. A module load *is* a `PATH`
assignment, so it cannot leave a stale entry behind, and `hash -r` after `module load` is a ritual
aimed at a failure bash does not have. Prescribing it costs you the one thing you were short of: a
reason to look somewhere else.

Two things `which` genuinely cannot see, and one that it can.

A function or an alias beats `PATH` outright, and `which` is an external program that knows only
`PATH`. Sites wrap interpreters this way, users copy the wrapper into `.bashrc`, and `module`
itself is a shell function, so nothing here is exotic:

```
$ type python3
python3 is a function
python3 () 
{ 
    /usr/bin/python3 "$@"
}
```

That is what the transcript at the top of this section really was: `PATH` changed exactly as asked,
and a function defined in a site profile went on answering to the name.

`command python3 --version` bypasses it for one call, `unset -f python3` for the session. Note that
`command -v python3` prints just `python3` for a function — correct, and useless as evidence.
`type` is the builtin to reach for. Aliases produce the same symptom interactively and then
disappear in batch, because bash does not expand aliases in non-interactive shells unless
`expand_aliases` is set: that is the "works in my shell, fails in my job script" report.

The hash cache is real, but its trigger is the opposite of the folklore — it bites when `PATH` does
*not* change and a same-named binary appears earlier on it. A `pip install --user` into
`~/.local/bin`, a wrapper dropped into `/usr/local/bin`, an install finishing while the user's shell
is open:

```
$ PATH=/tmp/ht/a:/tmp/ht/b:$PATH        # a is earlier and has no bar yet
$ cp /tmp/ht/b/foo /tmp/ht/b/bar; bar
B
$ cp /tmp/ht/a/foo /tmp/ht/a/bar        # an earlier bar now exists; PATH unchanged
$ which bar
/tmp/ht/a/bar
$ type bar
bar is hashed (/tmp/ht/b/bar)
$ bar
B
$ hash -r; bar
A
```

One detail worth knowing before you rely on the diagnostic: on the bash tested here, `type -a bar`
re-searched `PATH` and listed both directories without mentioning the cache at all, while plain
`type bar` named it. Use `type` without `-a`, or the `hash` builtin, which prints the table with hit
counts. In tcsh the equivalent situation needs `rehash`, and there `which` is a builtin that
consults the same cache, so it agrees with the wrong answer rather than contradicting it.

## 3. The module that sets a variable but no interpreter

A common pattern for Python tooling is a modulefile pointing at a virtual environment:

```tcl
setenv    TOOLKIT_VENV  /shared/apps/toolkit/1.4/venv
setenv    PYTHONPATH    /shared/apps/toolkit/1.4/venv/lib/python3.11/site-packages
prepend-path PATH       /shared/apps/toolkit/1.4/bin
```

The user does the obvious check and gets a genuinely misleading answer:

```
$ module load toolkit/1.4
$ python3 -c "import toolkit"
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ModuleNotFoundError: No module named 'toolkit'
```

The package is installed, under an interpreter that is not on `PATH`. `python3` here is still the
system 3.9, and `PYTHONPATH` has pointed it at a `site-packages` built for 3.11 — so on top of the
version mismatch, any compiled extension there is named `_core.cpython-311-x86_64-linux-gnu.so`
and 3.9 will not look at it.

Ask the interpreter where it is, not whether the import worked:

```
$ python3 -c "import sys; print(sys.executable); print(sys.version_info[:2])"
/usr/bin/python3
(3, 9)
$ "$TOOLKIT_VENV/bin/python" -c "import toolkit; print(toolkit.__version__)"
1.4.0
```

That is the diagnosis. The fix is to put the venv's `bin` on `PATH` and stop setting `PYTHONPATH`
— a venv does not need it, and setting it turns a clean "wrong interpreter" failure into a
confusing "half the packages import" one.

```tcl
prepend-path PATH  /shared/apps/toolkit/1.4/venv/bin
unsetenv     PYTHONPATH
```

`PYTHONPATH` deserves a blanket rule: a shared modulefile should never set it. Its entries are
searched ahead of the interpreter's own standard library and `site-packages` — everything except
the script's own directory — and they leak into every unrelated Python process started from that
session, including ones belonging to other modules.

## 4. The module that does put an interpreter on the path, and shadows everything

The opposite failure is quieter and lasts longer. A module that prepends a Python to `PATH` has
changed the meaning of `python3` for everything else in that shell. Usually that is wanted. The
parts that are not:

a script with `#!/usr/bin/env python3` now runs under the module's interpreter regardless of what
it was tested against; `pip install --user` writes into `~/.local/lib/python3.11/`, which then
becomes visible to every *other* 3.11 on the system; `python3 -m venv` creates an environment
whose `pyvenv.cfg` records the module's interpreter, and that venv keeps working right up until
the module directory is deleted.

Load order decides the winner, and `module list` will not tell you who won. Ask for the
resolution:

```
$ module load toolA toolB
$ type -a python3 | head -3
python3 is /opt/apps/toolB/2.1/bin/python3
python3 is /opt/apps/toolA/1.9/bin/python3
python3 is /usr/bin/python3
```

The structural fix is `family`. Lmod's `family("python")` makes modules in the same family
mutually exclusive, so the second load swaps the first rather than shadowing it:

```lua
family("python")
prepend_path("PATH", "/opt/apps/python/3.11.6/bin")
```

```
$ module load python/3.11.6 python/3.12.2
Lmod is automatically replacing "python/3.11.6" with "python/3.12.2".
```

That message is the point. The load still succeeds, but the user now knows.

For application modules the better pattern is not to expose an interpreter at all: ship wrappers
in `bin/` with an absolute shebang pointing at the venv's Python, and put only that `bin` on
`PATH`. The tool works; `python3` keeps meaning what it meant.

## 5. Several modules in one command

A recurring ticket: loading modules one per line works, loading them in a single command fails,
and the user is told to stop doing the thing that failed without anyone explaining why.

```
$ module purge
$ module load compiler/gcc-12.3.0 mpi/openmpi-5.0.3 app/solver-4.2
$ solver --version
solver: error while loading shared libraries: libmpi.so.40: cannot open shared object file: No such file or directory
$ module purge
$ module load compiler/gcc-12.3.0
$ module load mpi/openmpi-5.0.3
$ module load app/solver-4.2
$ solver --version
solver 4.2.1
```

Two mechanisms are in play, and neither is as simple as it is usually told — including in the
direction most people assume.

The first is that what a child process launched from a modulefile sees is an implementation
detail, not the environment the user will end up with, and the two implementations differ. Tcl
Environment Modules documents that `setenv` "will also change the process' environment" and that it
"is useful for changing the environment prior to the `exec` or `system` command" — so there, a
value set by an earlier sibling in the same command *is* visible to an `exec` in a later one. Lmod
assembles the new environment internally and emits it at the end, and its two ways of running a
command differ on exactly this point: the documentation for `capture()` says it uses the
`LD_PRELOAD` and `LD_LIBRARY_PATH` values that were current when Lmod was configured, and directs
you to `subprocess()` if you want the values in force now. So a modulefile doing this:

```tcl
set mpiroot $env(MPI_ROOT)
set mpiver  [exec $mpiroot/bin/mpirun --version]
```

can behave one way on the cluster running Modules, another on the cluster running Lmod, and a
third way when the module that sets `MPI_ROOT` is loaded in a separate command rather than as a
sibling — reading the modulefile tells you nothing about which. The same applies to any
`[file exists $env(SOMETHING)/...]` test fed by a sibling.

The second: whether prerequisite checks and hierarchical `MODULEPATH` additions are
honored within a single command varies across Tcl Environment Modules 3.2, 4.x and 5.x and across
Lmod 6 through 9. I am not going to give a version table I cannot stand behind. You can settle it
for your own stack in about thirty seconds:

```
$ module purge
$ module load compiler/gcc-12.3.0 mpi/openmpi-5.0.3; echo "exit=$?"
$ module list 2>&1
```

If `module list` shows fewer modules than you asked for while `exit=0`, your implementation loads
partially and does not report it. Know that before building automation on top of it.

Two rules fall out regardless of version. In scripts, load one module per command and check the
result by inspecting `LOADEDMODULES` rather than trusting the exit status. And never write a
modulefile that runs an external command at load time; compute the value at install time and
hard-code it.

## 6. Class file version 61.0, and what the numbers mean

A Java tool that was built elsewhere produces this:

```
$ module load gatk/4.5.0.0
$ gatk --version
Error: LinkageError occurred while loading main class org.broadinstitute.hellbender.Main
	java.lang.UnsupportedClassVersionError: org/broadinstitute/hellbender/Main has been
	compiled by a more recent version of the Java Runtime (class file version 61.0),
	this version of the Java Runtime only recognizes class file versions up to 52.0
```

The message names two numbers and explains neither. They are class file format major versions, not
Java versions, and for Java 5 onward **major version = Java release + 44**. So 61 is Java 17 and
52 is Java 8: the tool needs 17 and the node's default is 8.

| Class file major | Java release | Class file major | Java release |
|---|---|---|---|
| 49 | 5 | 60 | 16 |
| 50 | 6 | 61 | 17 |
| 51 | 7 | 62 | 18 |
| 52 | 8 | 63 | 19 |
| 53 | 9 | 64 | 20 |
| 54 | 10 | 65 | 21 |
| 55 | 11 | 66 | 22 |
| 56 | 12 | 67 | 23 |
| 57 | 13 | 68 | 24 |
| 58 | 14 | 69 | 25 |
| 59 | 15 | | |

Below that, 45 is Java 1.1 through 48 for 1.4. The `.0` after the major is the minor version; it
is zero except for preview features, where it is `65535`.

You do not need the table if you read the bytes. A class file is `CAFEBABE`, a two-byte minor at
offset 4, then a two-byte major at offset 6, big-endian:

```
$ unzip -p gatk.jar org/broadinstitute/hellbender/Main.class \
    | od -An -tu2 --endian=big -j6 -N2
  61
```

(`--endian` is a GNU coreutils option; on a box without it, `od -An -tx1 -j6 -N2` and read the two
bytes by hand.)

Or, if a JDK is to hand:

```
$ javap -verbose -cp gatk.jar org.broadinstitute.hellbender.Main | grep -E 'major|minor'
  minor version: 0
  major version: 61
```

The manifest often records the build JDK (`Build-Jdk-Spec: 17`), which is a useful cross-check but
is not authoritative — it reflects the compiler, not the `--release` target.

One wrinkle before you conclude anything from a single class: a multi-release jar carries extra
copies under `META-INF/versions/N/` that are deliberately compiled for higher majors than the
jar's baseline. If `Multi-Release: true` is in the manifest, check a class from the root of the
jar instead.

The fix is a `prereq` in the modulefile, so the tool cannot load without its runtime — not a wiki
line telling people to load Java first:

```tcl
prereq java/17
setenv JAVA_HOME /opt/apps/java/17.0.9
```

## 7. The modulefile that loads cleanly and sets a variable to nothing

Modulefiles get copied between clusters. The copy succeeds, the load succeeds, the software is not
there.

```
$ module load fsl/6.0.7
$ echo "FSLDIR=$FSLDIR"
FSLDIR=/opt/apps/fsl/6.0.7
$ ls "$FSLDIR"
ls: cannot access '/opt/apps/fsl/6.0.7': No such file or directory
$ bet --help
bash: bet: command not found
```

In their default configurations neither Environment Modules nor Lmod checks that a path exists
before putting it in a variable, and neither treats a `prepend-path` onto a missing directory as an
error. There is a defensible reason — automounted directories may not be materialized at load
time — but the result is a module that reports success and delivers nothing.

Harder to spot is the variant where the variable ends up empty rather than wrong. `$FSLDIR/bin/bet`
then expands to `/bin/bet`, and where that path happens to exist you get a different program and
no error at all.

Make the modulefile assert its preconditions. In Tcl, `break` ends the evaluation there; Modules
documents that the module is then not listed as loaded and other modules being loaded concurrently
are unaffected, with everything up to that point still performed:

```tcl
set root /opt/apps/fsl/6.0.7

if { [module-info mode load] && ![file isdirectory $root] } {
    puts stderr "ERROR: fsl/6.0.7 is not installed on [info hostname] ($root missing)"
    break
}

setenv       FSLDIR $root
prepend-path PATH   $root/bin
```

The `module-info mode load` guard matters: without it the check also runs during `module display`,
`module avail` and unload, which is noisy and can break `module purge` on a node where the
directory genuinely is absent. Note also that Modules documents `break` on unload as advisory —
a `module unload --force` proceeds anyway — so do not use it to make a module unremovable.

In Lmod the equivalent is `if (mode() == "load" and not isDir(root)) then LmodError(...) end`.

## 8. The deprecated module that loads instead of failing

A version is retired and its install directory removed, but the modulefile stays because deleting
it would "break people's scripts". It breaks them anyway, later and less legibly: the load
succeeds, `PATH` gains a directory that is not there, and the user gets `command not found` from a
module they can see in `module list`.

Lmod's admin file is right for a module that still works but should not be used. It is a list of
keys — a module name, or a full path to a modulefile when the key begins with `/` — each followed
by a message that runs to the next blank line:

```
$ cat /opt/apps/lmod/etc/admin.list
samtools/1%.9:
    Retired 2026-09-30. Use samtools/1.19.

```

Its location is wherever `LMOD_ADMIN_FILE` was configured to point, which `module --config` will
tell you.

Those keys are Lua patterns rather than literal strings, which is the detail that catches people.
`.` matches any character and `-` is a quantifier, so a version number wants `%.` and a module name
containing a dash wants `%-`. Written as plain `samtools/1.9` the entry still matches
`samtools/1.9`, and also `samtools/119`.

Loading a module that matches prints a block in this shape and then loads it:

```
$ module load samtools/1.9

-----------------------------------------------------------------
There are messages associated with the following module(s) :
-----------------------------------------------------------------
samtools/1.9:
    Retired 2026-09-30. Use samtools/1.19.
-----------------------------------------------------------------
```

Note what that does: it prints and loads. The Lmod documentation is explicit that the admin file
"in no way controls user access to the module". That is correct for a deprecation window and wrong
for a module whose files are gone. For that, the modulefile must refuse:

```lua
LmodError([[
samtools/1.9 was removed on 2026-09-30. The installation no longer exists.
Use: module load samtools/1.19
]])
```

That refuses the load, and Lmod documents that a failed load returns a non-zero exit code you can
trap. Confirm that on your own version before a job script leans on it, and confirm it separately
under Tcl Environment Modules, where the exit status of a failed load has not always been reliable.

State the principle plainly, because it is the one people argue about: a module that cannot do its
job must fail at load time, loudly, with a non-zero exit. A job that dies in the first second with
a clear message is a five-minute fix. A job that runs nine hours and fails at the output stage
because one of six tools was missing costs a day, and nobody will connect it to a module that
loaded successfully that morning.

## 9. Build-host paths baked into a shared installation

This one is not the module system's fault, but the module system is where it surfaces: software
that works perfectly on the node it was compiled on and nowhere else.

```
$ module load rstudio-deps/2026.05
$ R -e 'library(sf)'
Error: package or namespace load failed for 'sf':
 unable to load shared object '/shared/apps/R/4.4.1/library/sf/libs/sf.so':
  libproj.so.25: cannot open shared object file: No such file or directory
```

It works on the build node because the library was in that node's `/usr/lib64`, or because the
build shell had an `LD_LIBRARY_PATH` no other shell has. Four things get baked in:

```
# 1. RPATH/RUNPATH pointing at a build-only directory
$ readelf -d /shared/apps/tool/bin/tool | grep RUNPATH
 0x000000000000001d (RUNPATH)   Library runpath: [/scratch/build/deps/lib]

# 2. libraries resolving outside the install tree, or not at all
$ ldd /shared/apps/tool/bin/tool | grep -v '=> /shared'
	libproj.so.25 => not found

# 3. build paths in generated config, which propagate to everything users compile later
$ grep -n '/scratch/build' /shared/apps/R/4.4.1/lib64/R/etc/Makeconf
128:LDFLAGS = -L/scratch/build/deps/lib

# 4. pkg-config and libtool files carrying an absolute prefix
$ grep -rl '/scratch/build' /shared/apps/tool/lib/pkgconfig/*.pc /shared/apps/tool/lib/*.la
```

A fifth catches conda-based installs and looks like a filesystem problem: the shebang length limit.
The kernel reads a fixed-size buffer from the start of an executable, and a `#!` line longer than
that buffer does not survive it. On a kernel with the older 128-byte buffer the line is truncated
and the truncated path is executed, so the error names an interpreter that does not exist while
`ls` shows the real one plainly does:

```
$ head -1 /gpfs/shared/apps/genomics/pipelines/annotation/1.2.0/bin/annotate
#!/gpfs/shared/apps/genomics/pipelines/annotation/1.2.0/conda/envs/annotation-tools-py311-bioconda-pinned-2026-05-rebuild/bin/python3.11
$ head -1 /gpfs/shared/apps/genomics/pipelines/annotation/1.2.0/bin/annotate | wc -c
137
$ ./annotate
bash: ./annotate: /gpfs/shared/apps/genomics/pipelines/annotation/1.2.0/conda/envs/annotation-tools-py311-bioconda-pinned-2026-05-rebuild/bin/py: bad interpreter: No such file or directory
```

Read the truncation point rather than the message: the path in the error stops at 126 characters,
which is the 128-byte buffer less the two bytes taken by `#!`. That is the signature.

The number is a kernel compile-time constant, `BINPRM_BUF_SIZE` in
`include/uapi/linux/binfmts.h`, and it is 256 in current mainline. Current kernels also handle the
overflow differently: `fs/binfmt_script.c` returns `-ENOEXEC` when the interpreter path runs to the
end of the buffer with no terminator after it, rather than executing a path it had to cut. That
changes the symptom instead of removing it — a shell that gets `ENOEXEC` falls back to running the
file itself as a shell script, so a Python entry point fails with shell syntax errors from its own
source instead of `bad interpreter`. Check the constant on the kernel in front of you rather than
quoting either number. The fix is the same in both cases: a shorter install prefix, or a small
POSIX `sh` wrapper that `exec`s the real interpreter.

The rule that prevents all five: never validate a build on the node that produced it. Build
anywhere; test on a node that has never had the toolchain loaded.

## The principle, and a harness

A modulefile is a contract: load me and this tool will run. A contract that fails silently is
worse than no contract, because the user stops checking. If a module cannot keep its promise it
must say so at load time, in the shell the user is sitting in, with a non-zero exit.

Hold it to that by testing the promise directly — load it in a shell with nothing inherited and
execute the binary. Not `ls` the directory, not check the variable. Run the thing.

```bash
#!/bin/bash
# modcheck.sh — load each module in a clean shell and actually run its binary.
# Manifest is tab-separated:  <module>  <binary>  <smoke arguments>
set -u
MANIFEST=${1:?usage: modcheck.sh manifest.tsv}
INIT=${MODULE_INIT:-/usr/share/lmod/lmod/init/bash}
MP=${MODULEPATH:?MODULEPATH must be set in the calling shell}
fail=0

while IFS=$'\t' read -r mod bin args || [[ -n ${mod:-} ]]; do
    [[ -z ${mod:-} || ${mod:0:1} == "#" ]] && continue

    out=$(env -i \
            HOME="$HOME" USER="$USER" LOGNAME="$USER" TERM=dumb \
            PATH=/usr/bin:/bin MODULEPATH="$MP" \
          bash --noprofile --norc -c '
            source "$1" >/dev/null 2>&1 || exit 91
            set -u
            module load "$2" >/dev/null || exit 92
            case ":${LOADEDMODULES:-}:" in
              *":$2:"*|*":$2/"*) ;;
              *) exit 92 ;;
            esac
            command -v "$3" >/dev/null  || exit 93
            exec "$3" $4
          ' _ "$INIT" "$mod" "$bin" "${args:-}" 2>&1)
    rc=$?

    [[ $rc -ne 0 ]] && fail=1
    case $rc in
      0)  printf 'ok    %-28s %s\n' "$mod" "$bin" ;;
      91) printf 'INIT  %-28s init script missing: %s\n' "$mod" "$INIT" ;;
      92) printf 'LOAD  %-28s module did not load\n' "$mod" ;;
      93) printf 'PATH  %-28s loaded, but %s is not on PATH\n' "$mod" "$bin" ;;
      *)  printf 'RUN   %-28s %s exited %d: %s\n' "$mod" "$bin" "$rc" \
                 "$(printf '%s' "$out" | head -1)" ;;
    esac
done < "$MANIFEST"

exit $fail
```

Run against a manifest of four modules — one good, one that sets variables but puts no binary on
`PATH`, one whose binary runs and fails, and one whose modulefile is gone:

```
$ ./modcheck.sh manifest.tsv
ok    samtools/1.19                samtools
PATH  toolkit/1.4                  loaded, but toolkit is not on PATH
RUN   gatk/4.5.0.0                 gatk exited 1: Error: LinkageError occurred while loading main class org.broadinstitute.hellbender.Main
LOAD  samtools/1.9                 module did not load
$ echo $?
1
```

Several things there are deliberate. `env -i` stops your interactive session leaking in, which is
the only way to catch a module that works for you because of your `.bashrc`. `--noprofile --norc`
stops the site profile quietly fixing the problem. `set -u` is applied *after* the init script is
sourced, because module init scripts are not written to survive it. The load is checked twice —
exit status and then `LOADEDMODULES` — which is the rule from section 5 applied to the harness
itself; a partial load reported as success is exactly what this is meant to catch. The sentinel
exit codes are 91 to 93 rather than 2 to 4 so that a tool exiting 3 on its own account is not
misfiled as a load failure. And the `exec` runs the real binary rather than testing for its
presence — `$4` is deliberately unquoted so the smoke arguments word-split.

Run it on more than one node — that is what catches the build-host class:

```
$ for n in $NODES; do echo "== $n"; srun -N1 -w "$n" --time=10 ./modcheck.sh manifest.tsv; done
```

Run it from a batch job as well as a login node. Those environments differ, and a module that only
works interactively fails for every job.

## Symptom against cause

| Symptom | Likely cause | Command that confirms it |
|---|---|---|
| `command not found` right after a successful load | load happened in a subshell (pipe, `$( )`, `xargs`, make recipe) | `echo "$LOADEDMODULES"` in the shell that matters |
| `module list` shows nothing but the load printed no error | same, or the output went to stderr (Lmod's default) and was filtered by a pipe | `module list 2>&1`, or `module -t list` |
| `which` shows the new binary, old version still runs | a shell function or alias of the same name, which `which` cannot see | `type <cmd>`; `command <cmd>` to bypass once |
| Same, and `type` says "hashed" | stale command hash — only possible when `PATH` itself did not change | `type <cmd>`, `hash`; clear with `hash -r` (`rehash` in tcsh) |
| `ModuleNotFoundError` for a package that is installed | module set a venv variable but no interpreter on `PATH` | `python3 -c "import sys; print(sys.executable)"` |
| Unrelated Python scripts break after loading a tool | module prepended an interpreter and shadowed the system one | `type -a python3`; fix with `family()` |
| Two modules loaded, second one's tool wins silently | no `family`/`conflict` declared | `module list 2>&1` then `type -a` on the contested binary |
| Works loaded one per line, fails in a single command | modulefile shelling out, or a partial load reported as success | load in one command, then `module list 2>&1` and compare against what you asked for |
| `UnsupportedClassVersionError: class file version N` | tool built for a newer JDK than the default | Java release = N − 44; add `prereq java/<n>` |
| Variable set, directory absent, no error | modulefile copied between clusters without an existence check | `ls "$THAT_VAR"`; add a `break` / `LmodError` guard |
| `$VAR/bin/tool` resolves to `/bin/tool` | variable expanded to empty string | `echo "[${VAR:-UNSET}]"` |
| Module in `module list`, binary missing from disk | retired install, modulefile left behind | `module show <mod> 2>&1`, then `ls` each path it prints |
| `libX.so.N: cannot open shared object file` | build-host library not present on this node | `ldd <binary>`; `readelf -d <binary> \| grep RUNPATH` |
| `GLIBCXX_3.4.NN not found` | built against a newer libstdc++ than the runtime provides | `strings <libstdc++ in use> \| grep GLIBCXX \| sort -V \| tail -1` |
| `bad interpreter: No such file or directory`, file exists | shebang longer than the kernel's buffer (`BINPRM_BUF_SIZE`), path truncated | `head -1 <script> \| wc -c` and compare with the length in the error text |
| Shell syntax errors from a Python or Perl entry point | same overflow on a newer kernel: `ENOEXEC`, and the shell then runs the file itself | `head -1 <script> \| wc -c` against `BINPRM_BUF_SIZE` on that node |
| Works on a login node, fails in a batch job | different profile scripts or `MODULEPATH` | run the same check under `srun` and diff the environments |
| Works for you, fails for a user | something in your `.bashrc` | re-test under `env -i ... bash --noprofile --norc` |

None of this is exotic. It is one failure repeated: an environment change that did not happen, or
happened where it could not be observed, reported as success. It is worth writing down because
the evidence points at the software, and the software is fine.
