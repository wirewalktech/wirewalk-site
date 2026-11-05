---
title: "Apptainer, MPI and RDMA: make the host–container boundary explicit"
date: "2026-11-01 10:00:00 -0500"
category: "HPC Operations"
tags: ["Apptainer", "MPI", "RDMA", "PMIx", "Slurm"]
summary: "Validate hybrid and bind MPI container models through launcher, ABI, process manager, fabric libraries and device access, then prove the intended transport at scale."
description: "Run MPI containers reliably with Apptainer and Slurm by validating launcher, ABI, PMIx, RDMA libraries, device access and cleanup."
---

When an MPI image works on one node and fails on two, inspect the boundary between its libraries and the host launch environment. The same boundary can also let a job finish over a slower transport while leaving the intended RDMA path unused.

List which side supplies MPI, the process manager, fabric userspace, kernel driver and devices. Validate that combination before expanding the test to more nodes.

The examples use an already validated image and generic application paths. They are launch patterns, not a promise that arbitrary host and container MPI builds can be mixed.

## Choose a documented model

Apptainer describes two common approaches in its [MPI guide](https://apptainer.org/docs/user/1.3/mpi.html). In a hybrid model, MPI is present inside the container and works with the host launch environment. In a bind model, host MPI components are mounted into an image designed to use them.

Choose one deliberately. The hybrid model gives the image a defined MPI userspace but requires compatibility with the launcher and process-management path. The bind model can align more closely with a site's stack, while introducing host-library dependencies that must be exposed consistently.

Neither model eliminates compatibility work. A shared library resolving successfully is only the first step. Initialization, rank launch, communicator formation, device access and termination all need evidence.

## Build a dependency map before mounting libraries

Create a small manifest identifying the application binary, MPI implementation and version, compiler runtime, PMIx or PMI path, UCX or libfabric components where used, verbs userspace and host driver. Include GPU-aware communication if the application needs it.

| Layer | Evidence to retain |
|---|---|
| Application | Build identity and linked MPI interface |
| MPI | Implementation, version and configured components |
| Process manager | Supported Slurm plugin and compatible library path |
| Fabric userspace | Selected provider and dependencies |
| Host | Kernel, device driver, firmware and exposed devices |

Avoid binding an entire system library directory to make one missing library disappear. That can replace unrelated image dependencies and produce a container that works only by accident on one node image.

A targeted bind still needs its transitive dependencies. Document them and their ownership rather than relying on whatever happens to be installed on the current test machine.

## Verify launcher compatibility separately

Use Slurm's [MPI launch guidance](https://slurm.schedmd.com/mpi_guide.html) and the installed MPI implementation's instructions. The correct PMI or PMIx plugin depends on that combination. A plugin name appearing in a help listing does not establish that the container's client libraries can initialize against it.

Start with a non-MPI step, then the MPI test. For a site that explicitly supports direct launch through PMIx:

```bash
# Run within a small allocation; confirm pmix support first.
srun --mpi=list
srun --mpi=pmix --ntasks=2 \
  apptainer exec mpi-validated.sif /opt/tests/mpi_hello
```

The binary and image are placeholders. This pattern assumes the site has validated that launch model. Do not treat `--mpi=pmix` as a universal repair for MPI startup failures.

Inspect the resulting process count and rank identities. A program printing twice is not enough if both instances believe they are rank zero in a one-process world.

## Separate rank startup from message transfer

A minimal MPI test should report the rank, communicator size and hostname, then exchange data and verify it. Follow with a small collective test. This distinguishes independent processes starting from a functioning distributed communicator.

Progress through one node and two nodes before scaling further. Keep tasks per node controlled. If a failure appears only across nodes, preserve that boundary instead of immediately testing a much larger allocation with more possible causes.

Check the exit status of every test and the expected output count. Some wrappers can hide a failing rank behind a successful outer command. A clean launch and cleanup sequence is part of the compatibility contract.

## Prove the selected fabric path

RDMA hardware being present on the host does not establish that the image can use it. The application needs the appropriate devices, permissions and compatible userspace libraries. Inspect the selected transport using the supported diagnostics for the installed communication stack.

Compare a native baseline and container run under the same allocation, placement and message sizes. Retain latency and bandwidth results as a distribution rather than one best number. Small messages and large transfers stress different parts of the stack.

A passing TCP test is a useful control. It does not prove that a desired InfiniBand or RoCE path is healthy. If a container silently falls back, record the actual transport and investigate the missing component rather than declaring the image portable on the basis of completion alone.

## Add GPU-aware MPI as a separate acceptance stage

A CPU-buffer MPI test does not establish GPU-buffer support. Use a test designed for device memory only after host-buffer communication works. Record the MPI build's GPU support, image CUDA userspace and host NVIDIA driver.

Keep GPU assignment under Slurm control. Apptainer's [GPU integration](https://apptainer.org/docs/user/1.3/gpu.html) makes devices and libraries available through supported options, but it does not decide which GPU the job is entitled to use.

Distinguish successful device-buffer communication from a particular direct-transfer mechanism. A stack may stage data through host memory. Establish the path with the relevant supported diagnostics before making claims about GPUDirect behavior or performance.

## Control environment and mounts

Record the environment needed by the validated stack and remove unexplained tuning variables from the reproduction. A user's shell may carry old provider exclusions, library paths or network-interface selections that override the intended configuration.

Use explicit input and output mounts. Keep the MPI dependency mounts separate from application data mounts so failures can be attributed. Apptainer's [mount documentation](https://apptainer.org/docs/user/1.3/bind_paths_and_mounts.html) explains that defaults and administrator policy also influence what appears inside the container.

Do not use an increasingly broad `LD_LIBRARY_PATH` as the permanent integration strategy. Save the final resolution of critical libraries and ensure the same image behaves consistently on every supported node image.

## Test cancellation and upgrades

Cancel a small multi-node test through the normal scheduler interface and verify that its ranks and helper processes are gone. Confirm that a subsequent allocation can use the nodes and devices normally. A container that starts correctly but leaves processes behind is not operationally ready.

Repeat acceptance after changing Slurm, MPI, the container runtime, the kernel or fabric drivers. The image checksum can remain identical while the host side of the contract changes underneath it.

Keep native and container results in the supported-combination table, with the tested launch command. A researcher can then choose a known configuration, and the next two-node failure has a matching baseline to compare.

Read next: [A distributed Slurm job is running but making no progress: a debugging sequence](/writing/slurm-distributed-job-hangs-launch-ranks-fabric/), [NVIDIA containers under Slurm: operating Enroot and Pyxis as a supported service](/writing/nvidia-enroot-pyxis-slurm-container-pipeline/).
