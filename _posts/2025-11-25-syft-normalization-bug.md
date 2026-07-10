---
layout: post
title: "From VEX to Critical Bug: How a Single Normalization Mismatch Breaks Supply Chain Trust"
date: 2025-11-25
description: A subtle normalization mismatch inside an SBOM tool can break dependency relationships even when all packages are detected correctly.
tags: [syft, VEX, SBOM, supply-chain-security]
categories: security
related_posts: false
---

### TL;DR

A subtle normalization mismatch inside an SBOM tool can break dependency relationships even when all packages are detected correctly. When edges between components silently disappear, downstream processes like vulnerability scanning and VEX reasoning become unreliable. This post walks through how such an issue surfaced in Syft, why it happened, and why small normalization inconsistencies pose a serious risk to supply chain security. The Syft team was very responsive and fixed the bug immediately.
{: .notice--info}

## Introduction


I wasn't trying to find bugs in Syft. I was working on a VEX-related task, following how exploitability should propagate across components. During this process, I noticed something odd: **Syft's SBOM report was missing dependency edges** that absolutely should exist.

All the packages were present in the SBOM report—this was not a package detection failure. The issue was strictly about **missing relationships** between correctly detected components.

## SBOM Background: Components, Dependencies, Vulnerabilities

Syft is an open-source SBOM generator by Anchore. It analyzes artifacts (containers, filesystems, packages) and produces SBOMs in standard formats like CycloneDX and SPDX.

At a high level, an SBOM primarily captures three things:

- **Components:** The software elements (applications, libraries) present in the artifact.
- **Dependencies:** The relationships indicating which components depend on which others.
- **Vulnerabilities:** Known issues mapped to components (when supported/available in the chosen schema).

A simplified CycloneDX-style example:

```json
{
  "component": { "type": "application", "name": "ExampleApp", "version": "2.3.4" },
  "components": [
    { "type": "library", "name": "LibraryA", "version": "1.2.3" },
    { "type": "library", "name": "LibraryB", "version": "4.5.6" }
  ],
  "dependencies": [
    { "ref": "ExampleApp", "dependsOn": [ "LibraryA", "LibraryB" ] },
    { "ref": "LibraryA", "dependsOn": [] },
    { "ref": "LibraryB", "dependsOn": [] }
  ],
  "vulnerabilities": [
    { "component": "LibraryA", "id": "CVE-2024-12345", "severity": "high" },
    { "component": "LibraryB", "id": "CVE-2024-67890", "severity": "medium" }
  ]
}
```

In this post, the bug was not about component detection; it was about **missing dependency edges** between already detected components—precisely the kind of relationship that SBOMs are meant to capture.

{: .notice--info}
Syft has a large and active community—over ~8k stars, 700+ forks, and 200+ contributors—which helps surface and fix issues quickly. This specific bug was identified and addressed upstream fast, reflecting strong maintainer responsiveness.

**To concretly describe the problem:**
I had a flask app that uses `Flask==1.1.2`, which imports the vulnerable package`jinja2`, it also imports other packages, which are all declared as required packages in Flask METADATA file. ([The complete description and steps to reproduce the bug are described in the bug report](https://github.com/anchore/syft/issues/4401)

```plaintext
Requires-Dist: Werkzeug (>=0.15)
Requires-Dist: Jinja2 (>=2.10.1)
Requires-Dist: itsdangerous (>=0.24)
Requires-Dist: click (>=5.1)
``` 

Both Jinja2 and Werkzeug appeared in the package list, but Syft didn't link them as dependencies of Flask. In the world of SBOMs, this is enough to break the accuracy of the entire dependency graph.
{: .notice--warning}


### Dependency Graph (Unexpected Output ❌)

Syft's SBOM report should produce a dependency graph for this setup similar to this:

```text
flask  
  ├── click  
  ├── itsdangerous  
  ├── jinja2           
  └── werkzeug         
```

However, due to this bug, the produced dependency graph looks like this, where `jinja2` and `werkzeug` exist as packages/components in the SBOM report, but their edges are **silently dropped**.

```text
flask  
  ├── click  
  └── itsdangerous 
jinja2                  ← isolated node in the dependency graph
werkzeug                ← isolated node in the dependency graph
```

## Root Cause

The issue was caused by a **normalization mismatch** inside Syft.

Syft normalizes component names and dependency references, but an inconsistency in how/when this normalization happens prevented Syft from matching dependency references to the actual detected packages. See [anchore/syft#4408](https://github.com/anchore/syft/pull/4408) for more details about the issue and how it was solved.

## ⚠️ Why is this important??

Even though the bug seems small, its consequences ripple outward through the entire security pipeline.

VEX depends on dependency chains to determine exploitability propagation. If an edge disappears, VEX may incorrectly conclude:

> "flask is not affected by a jinja2 vulnerability"

Even though Flask absolutely **is** transitively affected.

Furthermore, modern supply chain workflows rely heavily on SBOM reports, which supposedly capture dependencies and their relations. Therefore, the following workflows will definitely be affected:

| Workflow                | Impact         |
|-------------------------|---------------|
| Exploitability scoring  | ❌ Inaccurate  |
| Risk prioritization     | ❌ Skewed      |
| SLSA/SBOM attestations  | ❌ Invalid     |
| Build gating            | ❌ Bypassed    |
| Dependency-path analysis| ❌ Incomplete  |
| Attack surface modeling | ❌ Wrong       |

**One mismatch can silently break the entire trust model.**
{: .notice--danger}

## Broader Impact

This issue is crucial to fix because Syft is widely adopted across industry and academia. Many SBOM analyses academic papers for Python ecosystems and container images rely on Syft; it is uncommon to find SBOM studies in these domains that do not include Syft in their methodology. When dependency edges are missing, conclusions drawn in such analyses can be skewed.

{: .notice--warning}
If SBOM relationships are incomplete, downstream research and vulnerability reporting may be affected. Ensuring relationship integrity is foundational to trustworthy SBOM-driven security work.

## The Role of AI in This Discovery

Throughout this investigation, I used frontier AI models via GitHub Copilot to assist with the analysis. The AI was involved in the entire process—from coming up with the proof-of-concept Flask app, to deciding on dependency versions, suggesting SBOM tools, generating SBOM reports, to analyzing the SBOM output.

However, when I explicitly asked the AI assistant whether it thought there was a bug in Syft's SBOM report, **it couldn't identify the issue**. Despite having access to all the data—the Flask METADATA, the dependency graph in the Syft SBOM report, and the missing edges—the AI failed to spot the normalization mismatch.

This highlights an important limitation: **AI can accelerate workflows and handle repetitive tasks, but critical bug detection still requires human intuition and domain expertise.** The AI was excellent at scaffolding the investigation, but it took human reasoning to connect the dots and recognize that something was fundamentally wrong.
{: .notice--warning}

## Conclusion

This bug was small, but its implications were not.

In software supply chain security, **tiny inconsistencies create large systemic failures**. A single normalization mismatch broke dependency relationships, undermined vulnerability propagation logic, and—left unnoticed—could have led to flawed or misleading security conclusions.


**Key Takeaways:**
{: .notice--success}

- ✅ SBOM correctness depends on precise, consistent, and complete dependency relationships  
- ✅ When relationships break, the chain of trust breaks with them  
- ✅ Even small mismatches matter—trust is built edge by edge  

