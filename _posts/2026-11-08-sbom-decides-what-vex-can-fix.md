---
layout: post
title: "How the SBOM Decides What VEX Can Fix"
date: 2026-11-08
description: "Vulnerability scanners judge software by the package names and versions in its SBOM, not by its code, and apply VEX statements the same way. We tested eight installs of one Python library to see when VEX can correct a wrong verdict, and when it cannot."
tags: [SBOM, VEX, syft, grype, trivy, supply-chain-security]
categories: security
related_posts: false
toc:
  beginning: true
---

### TL;DR

<div class="notice--info" markdown="1">
The vulnerability scanners we tested judge software by the package names and versions listed in its SBOM, not by its code, and they apply VEX statements the same way. So the SBOM decides what VEX can fix. Testing this on one Python library, PyYAML, we found three pitfalls:

- **Fixed code flagged.** A security fix that kept the library's old version number was reported as vulnerable, and VEX could not clear it without also hiding the real vulnerability elsewhere.
- **Vulnerable code missed.** Changing one version number, as an attacker could, hid the vulnerability from every scan, and VEX could not bring it back.
- **Mixed tools lost details.** When one tool wrote the SBOM and another scanned it, a vulnerable package was missed.
</div>

## Introduction

A vulnerability scanner decides from a software bill of materials (SBOM), the list of components in a piece of software, whether that software is affected by a known vulnerability. When the vulnerability scanner gets it wrong, the supplier, who knows the code, can correct it with a VEX (Vulnerability Exploitability eXchange) statement, such as "CVE-2020-14343 is fixed in this package". But the vulnerability scanner applies the statement by name and version: to the SBOM component whose name and version match those in the statement. So what the SBOM records decides both the verdict and whether a VEX statement can correct it.

This matters when the version and the code disagree. A vulnerability is usually fixed in a new version: CVE-2020-14343 in PyYAML was fixed in 5.4. Linux distributions, and companies that cannot upgrade, often copy only the fix into the older version instead. This is called *backporting*, and the patched older version is a *backport*. Ubuntu 20.04's PyYAML update is one: the code is fixed and Ubuntu's package version changed to `5.3.1-1ubuntu0.1`, but PyYAML's own version is still 5.3.1, which is below 5.4 and so looks vulnerable. The reverse is possible too: a mislabelled or tampered build can put a fixed version number on vulnerable code.

Our hypothesis is that nothing in this chain checks the installed code: SBOM generators record the name and version written in a package's metadata, and vulnerability scanners judge that version and match VEX statements by it. If so, fixed code with an affected version number is flagged, vulnerable code with an unaffected version number is missed, and a VEX statement can correct the verdict only where the SBOM gives the code a name and version of its own.

To test it, we installed PyYAML in eight ways, described each install with two SBOM generators, scanned each SBOM with two vulnerability scanners, and checked every verdict against a harmless exploit run inside each container. We asked three questions:

1. What does each SBOM generator record for the installed library?
2. What does each vulnerability scanner report from that SBOM?
3. Can the supplier's VEX statement correct the verdict, given what the SBOM records?

**Why we ran this study.** It is part of a larger project: a pipeline that generates a VEX benchmark for evaluating agentic tools, AI agents that reason about whether a vulnerability is exploitable. Whether such a tool's judgment is right is only half the question: the judgment reaches the consumer as a VEX statement, and the SBOM and the vulnerability scanner decide whether that statement takes effect. So before building the benchmark, we need to understand how SBOMs, vulnerability scanners and VEX affect each other. **Stay tuned: the paper and the implementation are coming soon.**

## Background

**Tools.** An *SBOM generator* reads a container image and writes its SBOM; we used Syft 1.54.1 and Trivy 0.75.0, both writing CycloneDX. A *vulnerability scanner* reads an SBOM and matches each component against vulnerability advisories; each match is a *finding*. We used Grype 0.120.1 and Trivy. vexctl 0.4.4, the OpenVEX project's command-line tool, writes VEX statements (`vexctl create`) and applies them to scan reports (`vexctl filter`).

**Declared version.** Syft and Trivy read each package's name and version from its metadata in the image, not from its code: dpkg's database for debs (Debian packages), and Python's installed-package metadata for Python packages. We call that version the *declared version*.

**Advisories.** An advisory lists the versions that a vulnerability affects: its *affected range*. GitHub's advisory GHSA-8q59-q68h-6hv4, an alias of CVE-2020-14343, covers PyYAML below 5.4. Ubuntu files the CVE under the *source* package `pyyaml`, from which it builds the deb `python3-yaml`, and lists `5.3.1-1ubuntu0.1` as fixed.

**PURL.** A package URL (PURL) names a component by type, name, version and optional qualifiers (the `key=value` pairs after `?`). Grype and Trivy look up a component's advisories by its PURL; for a deb, they look up its source package, which the SBOM records in a qualifier or a property (Q1). A VEX statement names its product by PURL too:

```text
pkg:pypi/pyyaml@5.3.1
pkg:deb/ubuntu/python3-yaml@5.3.1-1ubuntu0.1?arch=amd64&distro=ubuntu-20.04
```

**VEX.** A VEX statement is a supplier's claim about one vulnerability in one product, with a status such as `affected`, `fixed` or `not_affected`. This OpenVEX statement, written with `vexctl create`, says that CVE-2020-14343 is fixed in PyYAML 5.3.1+acme1, a backport:

```json
{
  "vulnerability": {"name": "CVE-2020-14343", "aliases": ["GHSA-8q59-q68h-6hv4"]},
  "products": [{"@id": "pkg:pypi/pyyaml@5.3.1%2Bacme1"}],
  "status": "fixed"
}
```

**Applying VEX.** A statement *matches* a finding when it names the finding's vulnerability (the CVE or an alias) and its product matches the finding's component. A matching `fixed` or `not_affected` statement should take the finding out of the scan report. There are two ways to apply it. With `--vex`, Grype or Trivy reads the statement during the scan and *suppresses* the finding. With `vexctl filter`, vexctl reads the scan report after the scan, in SARIF, a standard JSON format for analysis results, and *removes* the finding. The product check matters: the statement above must take out the backport's finding, but not the findings on upstream PyYAML 5.3.1 or on Ubuntu's unpatched deb, which have the same CVE and are still vulnerable. Q3 tests whether `--vex` and `vexctl filter` check the product.

## The experiment

**One library, one vulnerability.** PyYAML reads YAML files into Python. Before version 5.4, its `yaml.full_load` function runs Python code written inside the YAML file it loads, so anyone who can supply that file can run code on the machine: this is CVE-2020-14343. PyYAML 5.4 fixed it in one file, `yaml/constructor.py`, so that file shows whether an install is vulnerable or fixed.

**Eight images.** All eight are Ubuntu 20.04 images with Python 3.8; only the PyYAML install differs:

| image | how PyYAML is installed | declared version | `constructor.py` |
|---|---|---|---|
| deb-unpatched | apt: `python3-yaml=5.3.1-1` | deb `5.3.1-1`; Python metadata `5.3.1` | vulnerable |
| deb-patched | apt: `python3-yaml=5.3.1-1ubuntu0.1`, Ubuntu's backport | deb `5.3.1-1ubuntu0.1`; Python metadata `5.3.1` | fixed |
| pypi | pip: `PyYAML==5.3.1` | `5.3.1` | vulnerable |
| git | pip: the upstream git tag `5.3.1` | `5.3.1` | vulnerable |
| local | pip: a local copy of the 5.3.1 source | `5.3.1` | vulnerable |
| local-backport | pip: that copy with Ubuntu's fix, as a company's own backport | `5.3.1+acme1` | fixed |
| local-relabel | pip: that copy without the fix, with only its version changed to 6.0.2 | `6.0.2` | vulnerable |
| pypi-fixed | pip: `PyYAML==6.0.2` (control) | `6.0.2` | fixed |
{: .table .table-sm}

The `+acme1` suffix is a Python *local version label* (PEP 440): it marks a rebuild but keeps the public version, 5.3.1, which is inside the affected range. In a PURL, `+` is written `%2B`.

**Why local-relabel.** local-relabel is our adversarial case: vulnerable code with the same declared version and PURL as pypi-fixed, made by changing one line in `setup.py`. Anyone who wants vulnerable code to pass a scan only has to change what SBOM generators read, as the [Malicious Compliance](https://github.com/bgeesaman/malicious-compliance) talk at KubeCon EU 2023 showed for container images. On PyPI, only PyYAML's maintainers can publish PyYAML, so such a build would come from a private package index, a mirror, an internal fork or a copied source tree. The mismatch also happens by accident: [Dietrich et al.](https://arxiv.org/abs/2306.05534) found 727 artifacts in Maven Central with copies of vulnerable code under another name, which software composition analysis tools often missed.

**Ground truth.** A script we call the *oracle* runs a harmless exploit inside each container and records the SHA-256 of the `constructor.py` that Python loads:

```python
import yaml
poc = '!!python/object/new:tuple [!!python/object/new:map [!!python/name:eval , ["6*7"]]]'
yaml.full_load(poc)   # vulnerable: (42,)    fixed: ConstructorError
```

The eight images hold only two different `constructor.py` files. The exploit worked in the five images that load the vulnerable file (`3b751a7f…`) and failed in deb-patched, local-backport and pypi-fixed, which load the fixed file (`90d8247d…`). Ubuntu's fixed file is byte for byte the one in PyYAML 6.0.2.

**Pipeline.** Syft and Trivy each write a CycloneDX SBOM of each image, and Grype and Trivy each scan both SBOMs: four pairs per image, 32 in all. We write a pair as Syft→Grype: an SBOM written by Syft and scanned by Grype. Besides the same-vendor pairs (Anchore makes Syft and Grype, Aqua Security makes Trivy), we test the mixed pairs, Syft→Trivy and Trivy→Grype, because an SBOM is meant to be shared: the supplier writes it with one tool, and the consumer may scan it with another. Testing all four pairs also separates what the SBOM generator records from what the vulnerability scanner does with it.

Acting as the supplier, we write one OpenVEX statement per image with `vexctl create`. Its product is the PURL of the package we shipped, it lists both the CVE and the GHSA ID, and, since `vexctl create` writes whatever status it is given without inspecting code, its status comes from the oracle: `affected` if the exploit worked, `fixed` if not. Each pair is scanned without VEX and with `--vex`, and `vexctl filter` is applied to the SARIF report of the scan without VEX. A *verdict* asks whether the scan reports the CVE at all, on any component, and compares the answer with the oracle: correct, a *false positive* (reported, but the code is fixed) or a *false negative* (the code is vulnerable, but the CVE is missed). To find out why a verdict went wrong, we ran *probes*: reruns that change one thing, such as one field of a VEX statement or the SBOM format. Grype's and Trivy's vulnerability databases were built on 8 and 7 October 2026; re-scans with databases from 12 and 13 October gave the same verdicts, and local-relabel, added later, was scanned with those.

{% include figure.liquid loading="eager" path="assets/img/blog/2026/sbom-vex-pipeline.png" class="img-fluid rounded z-depth-1" zoomable=true alt="Pipeline: on the supplier side, each image goes to an SBOM generator and to the oracle, which sets the status of the VEX statement; on the consumer side, Grype or Trivy scans the SBOM and applies the VEX statement with --vex, or vexctl filter applies it to their SARIF report; each verdict is compared with the oracle" %}
<div class="caption" markdown="1">
Figure 1. The supplier builds each image, writes its SBOMs, and sets each VEX statement's status from the oracle. The consumer scans each SBOM and applies the statement with `--vex` or, after the scan, with `vexctl filter`.
</div>

## Results

Without VEX, 11 of the 32 verdicts were wrong: local-backport's fixed code was flagged in all four pairs, local-relabel's vulnerable code was missed in all four, and three deb verdicts were wrong (the two pairs that read Syft's SBOM flagged deb-patched, and Trivy→Grype missed deb-unpatched). `--vex` corrected local-backport and left 7 verdicts wrong; `vexctl filter` left 8 wrong (Figure 2).

{% include figure.liquid loading="eager" path="assets/img/blog/2026/sbom-vex-verdicts.png" class="img-fluid rounded z-depth-1" zoomable=true alt="Verdict grid: eight images by four SBOM generator→vulnerability scanner pairs, in three panels: without VEX, with --vex and with vexctl filter" %}
<div class="caption" markdown="1">
Figure 2. Verdict of each pair on each image, without VEX, with `--vex` and with `vexctl filter`. †: deb-patched Syft→Trivy is right only because `vexctl filter` used the deb-patched statement, whose product is the deb, to remove the finding on Syft's PyPI component (Q1). Two other ticks are right without matching the deb: deb-unpatched Syft→Trivy and deb-patched Trivy→Grype (Q2).
</div>

### Q1. What does each SBOM generator record for the installed library?

**Answer: the declared name and version, not the code.** local-backport's SBOMs say 5.3.1+acme1, and local-relabel's say 6.0.2. For a deb, Syft and Trivy differ. Syft writes two components: the deb, and a PyPI component, `pkg:pypi/pyyaml@5.3.1`, read from the Python metadata inside the deb. Trivy writes only the deb. In deb-patched, Ubuntu's fix changed the deb's version but not the Python metadata:

```text
dpkg:             python3-yaml 5.3.1-1ubuntu0.1   <- the fix shows here
Python metadata:  PyYAML       5.3.1              <- and not here
```

So in Syft's SBOMs, `pkg:pypi/pyyaml@5.3.1` names fixed code in deb-patched and vulnerable code in four other images, and in Syft's and Trivy's SBOMs alike, `pkg:pypi/pyyaml@6.0.2` names both pypi-fixed and local-relabel (Figure 3). Syft records the SHA-256 of each file a deb installs, the fixed `constructor.py` included, but for a pip install it hashes only PyYAML's metadata files; Trivy records no hash of `constructor.py`. Syft and Trivy also record the deb's source package, `pyyaml`, in different fields: Syft in the PURL qualifier `upstream=pyyaml` and in a property, Trivy in the property `aquasecurity:trivy:SrcName`.

{% include figure.liquid loading="eager" path="assets/img/blog/2026/sbom-vex-identities.png" class="img-fluid rounded z-depth-1" zoomable=true alt="Eight images in the centre, linked on the left to the PURLs in their Syft SBOMs and on the right to the code in the image, the vulnerable or the fixed constructor.py; pkg:pypi/pyyaml@5.3.1 links to four vulnerable images and to deb-patched, and pkg:pypi/pyyaml@6.0.2 links to pypi-fixed and to the vulnerable local-relabel" %}
<div class="caption" markdown="1">
Figure 3. Each image (centre), the PURLs in its Syft SBOM (left, qualifiers dropped) and the code in the image (right).
</div>

### Q2. What does each vulnerability scanner report from that SBOM?

**Answer: a verdict that follows the declared version.** All 16 verdicts on the four pip installs whose declared version matches the code (pypi, git, local and pypi-fixed) were correct. Ten of the 11 wrong verdicts are on code whose declared version does not match it; the eleventh, deb-unpatched in Trivy→Grype, is a deb lost between tools (below).

| image | PyYAML in the SBOM | `constructor.py` | wrong verdicts without VEX |
|---|---|---|---|
| pypi-fixed | `pkg:pypi/pyyaml@6.0.2` | fixed | 0 of 4 |
| local-backport | `pkg:pypi/pyyaml@5.3.1%2Bacme1` | fixed | 4 of 4: false positives |
| deb-patched | the deb at `5.3.1-1ubuntu0.1`; Syft adds `pkg:pypi/pyyaml@5.3.1` | fixed | 2 of 4: false positives in the pairs that read Syft's SBOM |
| local | `pkg:pypi/pyyaml@5.3.1` | vulnerable | 0 of 4 |
| local-relabel | `pkg:pypi/pyyaml@6.0.2` | vulnerable | 4 of 4: false negatives |
{: .table .table-sm}

The table holds the same file under different versions twice: the fixed file in pypi-fixed and local-backport, and the vulnerable file in local and local-relabel. Each time, the version alone decided the verdict.

**Ubuntu's fix was seen on the deb, not on Syft's PyPI component.** Wherever Grype or Trivy linked the deb to Ubuntu's advisory, they judged the deb correctly, because Ubuntu's fix shows in the deb's version. Both deb-patched false positives are on Syft's PyPI component. Syft's JSON and SPDX output record that this component's files belong to the deb, and in a probe Grype then ignored the component; Syft's CycloneDX output leaves that link out ([anchore/syft#4895](https://github.com/anchore/syft/issues/4895)). Trivy flagged the component even from Syft's SPDX output. Hashes did not change the outcome: the advisories that Grype and Trivy use give only version ranges, and both flagged deb-patched although Syft's SBOM lists the SHA-256 of the fixed `constructor.py`.

**Mixing tools lost Ubuntu's source package.** To find Ubuntu's advisory, a vulnerability scanner must link the deb `python3-yaml` to its source package `pyyaml`. Grype reads the source package only from Syft's fields, and Trivy only from its own. So Trivy→Grype missed the vulnerable deb in deb-unpatched, a false negative, and was right on deb-patched only because it did not match the deb at all. Syft→Trivy did not match the deb either, and was right on deb-unpatched only through Syft's PyPI component.

### Q3. Can the supplier's VEX statement correct the verdict, given what the SBOM records?

**Answer: only where the SBOM gave the code a name and version of its own, and only by taking findings out.** With `--vex`, 7 of 32 verdicts stayed wrong. The local-backport statement, whose product `5.3.1+acme1` names only the backport, suppressed the false positive in all four pairs; a second local-backport statement, `not_affected` with the justification `vulnerable_code_not_present`, did the same. The other verdicts stayed wrong:

- **Ubuntu's backport.** The deb-patched statement names the deb, so it cannot reach the two false positives on Syft's PyPI component. Reaching them would take a `fixed` statement for `pkg:pypi/pyyaml@5.3.1`; in a probe, that statement suppressed the real finding in the vulnerable pypi and git images.
- **The misses.** local-relabel's and deb-unpatched's statements say `affected`, and with `--vex` an `affected` statement changed nothing, so the five false negatives stayed. We did not test other settings, but Grype's and Trivy's source code shows why: Grype's opt-in `vex-add` setting, off in our runs, only restores findings that Grype made and then ignored, and Trivy acts only on `fixed` and `not_affected` statements. A Grype change that would create findings from `affected` statements ([anchore/grype#3464](https://github.com/anchore/grype/pull/3464)) is still open.

**Matching rules.** Probes that changed one field of a statement at a time, mostly on Syft's SBOMs, showed how Grype and Trivy match a statement to a finding:

- The vulnerability name or an alias must equal the ID that the vulnerability scanner gives the finding. Grype reports the PyPI finding under the GHSA ID and Trivy under the CVE, so a statement needs both.
- A version in the product must match exactly: `5.3.1` did not match `5.3.1+acme1`. A product without a version matches every version: such a statement suppressed the real finding in the vulnerable pypi image.
- Every qualifier in the product must be on the component: a statement whose product is the deb's PURL with Syft's `upstream=pyyaml` qualifier was applied in Syft→Grype but not in Trivy→Trivy, because Trivy's SBOM lacks that qualifier.
- A statement matches its product's PURL in any SBOM, not only in the image it was written for, as the `pkg:pypi/pyyaml@5.3.1` probe above showed.

The last rule makes package-level statements ambiguous: pypi-fixed's and local-relabel's statements both name `pkg:pypi/pyyaml@6.0.2`, one says `fixed` and the other `affected`, and each is true of its own image. A statement can instead name the image, by its digest, with the package as a subcomponent, as CISA describes; we could not test that, because neither SBOM gives the image a PURL.

**With `vexctl filter`, 8 of 32 verdicts stayed wrong:** the same five false negatives and three Grype false positives. `vexctl filter` 0.4.4 removes a finding whenever a `fixed` or `not_affected` statement names its vulnerability ID, without checking the product ([openvex/vexctl#105](https://github.com/openvex/vexctl/issues/105), reported in 2023). In the vulnerable pypi image, the deb-patched statement, and even a statement about `pkg:npm/left-pad@1.0.0`, removed the real finding from Trivy's SARIF report; with `--vex`, both left it in place. Grype's SARIF report adds the package name to the vulnerability ID (for example `GHSA-8q59-q68h-6hv4-pyyaml`), so `vexctl filter` never matched Grype's PyPI findings: the false positives stayed in local-backport's two Grype pairs and in deb-patched Syft→Grype.

## Conclusion

**The SBOM decides what VEX can fix.** Grype and Trivy judged the declared version, not the code, in both directions: fixed code under an affected version was flagged, and vulnerable code under an unaffected version was missed. With `--vex`, a statement corrected a verdict only where the SBOM gave the fixed code a name and version of its own, `5.3.1+acme1`. Where fixed and vulnerable code shared a PURL, no statement could tell them apart; where the version hid vulnerable code, no statement could make Grype or Trivy report it; and whether a statement matched at all depended on which SBOM generator wrote the SBOM.

**What to do.** If you ship a backport, give it its own version in the metadata that SBOM generators read (for a Python package, the Python metadata, as in `5.3.1+acme1`). Write its VEX statement for exactly that PURL, with status `fixed`, both the CVE and the GHSA ID, and no qualifier that consumers' SBOMs may lack, such as Syft's `upstream=pyyaml`. Never use the upstream version or no version: those statements suppressed real findings elsewhere.

If you scan:

- Test the exact SBOM generator→vulnerability scanner pair you use: with `--vex`, Trivy→Trivy got every image right except local-relabel, which every pair missed.
- Apply VEX with `--vex`, not `vexctl filter` 0.4.4.
- Test your VEX setup with two controls: apply a statement about an unrelated package, and apply the supplier's statement to an SBOM of the vulnerable upstream release. The real finding must stay in both.
- Keep suppressed findings for review: Grype lists them under `ignoredMatches`, and Trivy shows them with `--show-suppressed`.
- Don't take a clean result as proof that the code is fixed. Where a verdict matters, check the code: run a harmless exploit test, or compare the installed file's SHA-256 with the same file in the release it claims to be. That catches the relabel: local-relabel's `constructor.py` (`3b751a7f…`) is not 6.0.2's (`90d8247d…`).

**Limits.** One CVE, one ecosystem (PyPI plus Ubuntu's debs), one Ubuntu release, one version of each tool, CycloneDX SBOMs, and OpenVEX statements with the package as the product. The counts describe our setup, not error rates.

**Code and data.** Scripts, SBOMs, VEX statements, probes and raw Grype and Trivy output are in [JK-code505/sbom-install-sources-vex](https://github.com/JK-code505/sbom-install-sources-vex). To check our verdicts without a rebuild, extract the two `out/scans-*.tar.xz` archives in the repository's root folder and run `python3 -I tools/validate.py`. A full rerun (`python3 -I run.py`) needs Linux with podman, network access and about 5 GB of freshly downloaded vulnerability databases, so its verdicts can differ from ours.

> Part of the [Agentic AI Security](https://cs.qcri.org/agentic_-ai_security/) research project.
