---
title: "ConnectX firmware management: PSID, burn, reset, verify"
date: 2026-09-04 06:00:00 -0400
category: Fabric
tags: [ConnectX, MFT, mlxconfig, Firmware]
summary: >-
  Four commands do the work, and the one people skip is the one that makes the
  update real. The order matters, and the PSID matters more than the version
  number.
---

Firmware on a ConnectX adapter is not one thing. There is the image in flash,
the device configuration stored alongside it, and the running state, and all
three can disagree after a partial update. A card that reports the new version
but behaves like the old one is common, and the reason is almost always that
nothing reset it.

## Start the driver, find the device

Nothing in the MFT toolset works until the MST kernel module is loaded and the
device nodes exist.

```bash
sudo mst start
sudo mst status -v
```

That prints paths under `/dev/mst/` of the form `mt4123_pciconf0` for a
ConnectX-6 or `mt4125_pciconf0` for a ConnectX-7, alongside the PCI address, the
RDMA device name and the network interface. Everything downstream takes one of
those paths as `-d`.

The MFT version matters here in a way that is easy to miss. A toolset older than
the silicon will either not enumerate the device or will enumerate it and then
refuse the image. If `mst status` shows nothing for a card you can see in
`lspci`, update MFT before debugging anything else.

## Query before touching anything

```bash
sudo mlxfwmanager --query -d /dev/mst/mt4125_pciconf0
```

Three fields matter, and only one of them is the version.

**PSID** is the parameter set identifier, and it binds an image to a specific
hardware variant. Two cards with the same model number and the same firmware
version can carry different PSIDs, because one is an OEM part with different
defaults, a different port configuration or a different flash layout. Firmware
is published per PSID. This is the field to match on.

**FW version** appears in two forms: what is in flash, and what is running. When
those differ, an image has been burned and not activated. That is the state a
reset clears, and it is the most common reason a machine comes back from an
update behaving exactly as it did before.

**Status** reports whether an update is available, which only means anything
when you are querying online.

Where the host has outbound access:

```bash
sudo mlxfwmanager --online -u -d /dev/mst/mt4125_pciconf0
```

On an isolated fabric, which is the normal case, fetch the image matching the
PSID and burn it explicitly:

```bash
sudo mlxfwmanager -u -d /dev/mst/mt4125_pciconf0 -i fw-ConnectX7-rel.bin
```

## The PSID trap

`flint` will burn an image whose PSID does not match the card, if you insist:

```bash
sudo flint -d /dev/mst/mt4125_pciconf0 -i image.bin burn                       # refuses
sudo flint -d /dev/mst/mt4125_pciconf0 -i image.bin --allow_psid_change burn   # does not
```

The refusal is a feature. `--allow_psid_change` exists for genuine cases —
recovering a card whose flash was corrupted, converting a part with vendor
approval — and it is not the flag to reach for because a burn failed. A card
running an image built for a different variant can come up with the wrong port
configuration, the wrong link type, or not come up at all, and the way back
involves the same tool in a much less comfortable mode.

<div class="note" markdown="1">
Match on PSID, not on model. Two adapters that look identical in `lspci` can
need different images, and any fleet bought in two tranches is likely to hold
both.
</div>

## Device configuration is separate from firmware

`mlxconfig` reads and writes non-volatile settings that survive firmware updates
and are not part of the image:

```bash
sudo mlxconfig -d /dev/mst/mt4125_pciconf0 query
sudo mlxconfig -d /dev/mst/mt4125_pciconf0 set LINK_TYPE_P1=1
```

On a VPI-capable part, `LINK_TYPE_P1` and `LINK_TYPE_P2` decide whether a port
comes up as InfiniBand or Ethernet. Getting that wrong gives you a port that
never links and no error that explains why. Other settings worth knowing: SR-IOV
enablement and virtual function count, ATS, and the PCIe and performance knobs
that appear in vendor guidance from time to time.

Two things to hold onto. A firmware update can introduce new configuration keys
carrying defaults you did not choose, so query after an update as well as
before. And `mlxconfig` changes also need a reset to take effect, which brings
us to the step people skip.

## Reset, and when a reset is not enough

```bash
sudo mlxfwreset -d /dev/mst/mt4125_pciconf0 query
sudo mlxfwreset -d /dev/mst/mt4125_pciconf0 -y reset
```

The `query` subcommand reports which reset levels the card and the platform will
actually support in the current state, which is more useful than it sounds: a
warm reset the platform cannot perform is reported rather than attempted.

Some combinations of card, host and BIOS cannot do a live reset at all. In that
case the update is not applied until a full power cycle, and on some platforms
specifically an AC power cycle rather than a warm reboot. If you have burned an
image, run a reset, and the query still shows the old running version, stop
reasoning about firmware and go find out whether the machine actually
power-cycled.

## Verify against running state, from three directions

```bash
sudo mlxfwmanager --query -d /dev/mst/mt4125_pciconf0 | grep -E 'PSID|FW'
ethtool -i <netdev>
ibv_devinfo -d <rdma-dev> | grep -i fw_ver
```

Three sources because they read from different places. `mlxfwmanager` reads
flash, `ethtool` reports what the driver bound, `ibv_devinfo` reports what the
verbs layer sees. Agreement across all three is what "the update worked" means.
Disagreement between the first and the other two is the unreset-card signature.

## Doing this across a fleet

**Inventory by PSID, not by hostname.** Group the estate by PSID and firmware
version before planning anything. The distribution is reliably less uniform than
the purchase orders suggest.

**Stagger by failure domain.** Adapters in the same rack, on the same leaf, or
serving the same storage class should not reset in the same window. A reset
drops the link and the subnet manager re-sweeps; doing that everywhere at once
turns a routine update into a fabric event.

**Record before and after.** Query output for every card, stored and dated. The
value shows up months later, when something is behaving oddly and the only
question that matters is whether it changed.

**Pair firmware with driver.** Vendor release notes pair firmware versions with
specific OFED or in-box driver versions. Updating one and not the other is
supported far less often than it is done, and the symptoms get blamed on the
application.

## What this does not cover

Switch firmware is a different toolchain and a different risk profile, and
deserves its own written procedure. So does recovery from an interrupted burn —
`flint` in its more surgical modes, and the cases where a card has to come up on
a recovery image. That one is worth writing down once, by whoever has just done
it, rather than improvised under pressure.

Command syntax drifts between MFT releases. What is above describes the shape of
the tools rather than one version, and `--help` on the release you are running
is authoritative over anything written down elsewhere, this included.
