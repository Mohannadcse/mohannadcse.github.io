---
layout: post
title: "Agentic AI and the Software Supply Chain: New Frontiers, Old Vulnerabilities"
date: 2026-04-09
description: As AI agents gain autonomy, the software supply chain faces unprecedented challenges—from context management to dynamically loaded dependencies.
tags: [agentic-ai, supply-chain-security, AI-agents, SBOM, CBOM]
categories: security
related_posts: false
---

### TL;DR

Agentic AI systems introduce supply chain risks that traditional security tools cannot address. Autonomous agents with persistent memory, runtime tool selection, and agent-to-agent communication create dynamic dependency graphs that change during execution. This post examines threat sources (T1-T5), key security challenges, and directions forward including DepsRAG for dependency validation, Context Bill of Materials (CBOM) for runtime dependency tracking, and multi-level benchmarking frameworks.
{: .notice--info}

## Introduction

Traditional software supply chain security is already challenging. Now, a new class of applications is emerging that fundamentally changes the nature of these challenges: **agentic AI systems**.

I recently presented on this topic at MLDAS, exploring how autonomous AI agents reshape the software supply chain security landscape. This post expands on those ideas.

## The Supply Chain Challenge

<div style="float: right; max-width: 400px; margin: 0 0 1rem 1.5rem;">
{% include figure.liquid loading="eager" path="assets/img/blog/2026/dependency-xkcd.png" class="img-fluid rounded z-depth-1" zoomable=true %}
<div class="caption">
    XKCD #2347: "Dependency" [1] - A humorous but accurate depiction of how modern digital infrastructure depends on obscure projects maintained by individuals.
</div>
</div>

Software supply chain security has always been difficult. Modern applications depend on vast ecosystems of third-party libraries and dependencies, creating numerous blind spots. As the classic XKCD comic illustrates, critical infrastructure often relies on obscure packages maintained by lone developers. The problem isn't limited to malicious attacks—even well-intentioned bugs can cascade into major security issues, as demonstrated by the redis-py vulnerability that exposed ChatGPT users' conversation histories to other users in March 2023 [6].

## From ML Supply Chain to Agentic AI Supply Chain

Machine learning systems already introduced new supply chain complexity, as illustrated in the seminal NeurIPS paper on hidden technical debt [2]. The actual ML code represents a tiny fraction of the system—the real complexity lies in data collection, feature extraction, monitoring, configuration, and serving infrastructure.

Agentic AI extends this complexity. Unlike traditional ML systems, agentic systems:

- Operate continuously over extended periods rather than responding to single queries
- Maintain persistent memory that influences future decisions
- Autonomously select and invoke external tools at runtime
- Communicate with other agents, creating transitive trust relationships

{% include figure.liquid loading="eager" path="assets/img/blog/2026/apps-evolution.png" class="img-fluid rounded z-depth-1" zoomable=true %}
<div class="caption">
    The evolution from traditional applications to agentic AI systems, showing the progression toward greater autonomy and intelligence.
</div>

## Anatomy of Agentic AI Applications

Modern agentic AI applications consist of several key components:

### Core Components

<div style="float: right; max-width: 450px; margin: 0 0 1rem 1.5rem;">
{% include figure.liquid loading="eager" path="assets/img/blog/2026/agent-components.png" class="img-fluid rounded z-depth-1" zoomable=true %}
<div class="caption">
    Core components of an agentic AI system: Memory, Planning, Tools, Skills, and Actions.
</div>
</div>

- **Memory**: Persistent context and learned information
- **Planning**: Goal decomposition and task sequencing
- **Actions**: Concrete steps the agent can execute
- **Skills**: Specialized capabilities and domain expertise the agent can leverage
- **Tools**: External capabilities the agent can invoke

### Architectural Layers

From a security perspective, agentic systems operate across several layers:

**Data/Action Plane**: Context management (memory, tool access), Model Context Protocol (MCP) integrations, Agent-to-Agent (A2A) communication

**Control Plane**: Access policies, identity management, monitoring, audit trails, rate limiting

**Inference Layer**: LLM-based reasoning and response generation

**Task Management**: Goal specification, planning, agent routing, reflection

This layered architecture creates multiple points where security assumptions can break down.

## Security Risks and Challenges

The architecture of agentic AI systems creates threat surfaces that traditional security tools were not designed to address.

### Threat Sources

In the agentic AI architecture, threat sources appear at multiple points:

{% include figure.liquid loading="eager" path="assets/img/blog/2026/agentic-architecture-threats.png" class="img-fluid rounded z-depth-1" zoomable=true %}
<div class="caption">
    Agentic AI architecture showing the five primary threat sources (T1-T5) across the data/action plane, control plane, and inference layers.
</div>

1. **T1 - Model Layer**: Poisoned models, adversarial examples, model extraction
2. **T2 - Tool/MCP Layer**: Malicious tools, compromised external services, tool injection attacks
3. **T3 - Communication Layer**: Agent-to-agent communication hijacking, MCP protocol vulnerabilities
4. **T4 - Context/Memory Layer**: Context pollution, memory poisoning, prompt injection via stored data
5. **T5 - Skills Layer**: Malicious or compromised skills, skill injection attacks, unauthorized skill invocation

Each threat vector can compromise not just individual operations, but the entire decision-making process of the autonomous agent.

### Key Security Challenges

These threat sources manifest as interconnected security challenges:

**Context Management**: How do we ensure that agents maintain secure, non-tampered context across interactions? Traditional access control models don't account for dynamically assembled context from multiple sources.

**Communication Management**: Agent-to-agent communication and MCP interactions create new attack surfaces. How do we authenticate, authorize, and audit these interactions?

**Access Control Management**: Agentic systems make autonomous decisions about resource access. Traditional role-based access control (RBAC) breaks down when the "user" is an AI agent with evolving goals.

**Prompts & Model Response Management**: Prompt injection and jailbreaking remain unsolved problems. When agents construct prompts dynamically from untrusted sources, the attack surface expands dramatically.

**Testing & Evaluation**: How do you comprehensively test a system that behaves non-deterministically and may discover novel action sequences you never anticipated?

**Model Dependency Analysis & Tracking**: Software Bill of Materials (SBOM) tools can track code dependencies, but what about model dependencies? What about the dependencies of the tools an agent might decide to use at runtime?

### Gradual Risk Escalation

Unlike traditional software failures that manifest immediately, risks in agentic AI systems tend to **emerge gradually through persistence and iteration**. Errors are no longer confined to a single response. Incorrect assumptions, misleading outputs, or manipulated inputs can persist in memory, influence future decisions, and propagate across tools or other agents.

Two mechanisms drive this escalation:

- **Persistence**: Information that persists in memory gains influence over time. A fabricated detail stored early in a workflow can shape dozens of subsequent decisions before detection.
- **Iteration**: Repeated cycles of planning and execution amplify errors. Small issues compound across many steps, gradually shaping behavior in unintended and potentially harmful ways.

This creates **self-reinforcing error loops**. When incorrect outputs are treated as facts, stored in memory, and used to justify later actions, the system can drift far from intended behavior without any single catastrophic failure. In customer-facing automation, a fabricated policy detail reused across many cases could result in widespread denial of legitimate services before anyone notices the pattern.

## Looking Forward

Agentic AI introduces qualitatively different supply chain security problems that require new approaches. Traditional supply chain security tools—dependency scanners, SBOM generators, vulnerability databases—remain necessary but insufficient.

The path forward requires new technical primitives, benchmarking frameworks, and careful system design.

### DepsRAG: Agentic Reasoning for Dependency Management

The DepsRAG system [3] applies agentic reasoning to software dependency management. It uses multiple specialized agents:

- **Search Agent**: Discovers relevant packages and versions
- **Knowledge Graph Agent**: Builds and queries dependency relationships
- **Security Analysis Agent**: Evaluates vulnerabilities and risks

DepsRAG addresses both developer workflows and a critical emerging problem: **package hallucinations by code-generating LLMs** [4]. Research has shown that coding assistants frequently suggest non-existent or maliciously crafted packages. DepsRAG can validate suggested dependencies before they enter the supply chain.

### Context Bill of Materials (CBOM)

Just as SBOM documents software components, we need a Context Bill of Materials to track dependencies in agentic systems. The key difference: these dependencies are often **dynamically loaded** at runtime based on agent decisions.

<div style="float: right; max-width: 500px; margin: 0 0 1rem 1.5rem;">
{% include figure.liquid loading="eager" path="assets/img/blog/2026/cbom-analogy-v2.png" class="img-fluid rounded z-depth-1" zoomable=true %}
<div class="caption">
    Comparison of conventional app execution (static, dynamically loaded code) versus agentic app execution (prompt-driven, runtime dependency resolution via AG-UI, MCP, and A2A).
</div>
</div>

Traditional applications have static dependency graphs. Agentic applications construct their dependencies on-the-fly:
- A prompt triggers tool selection
- Tool invocation loads new code or accesses new services
- Agent-to-agent communication introduces transitive dependencies
- MCP connections establish new trust boundaries

This dynamic behavior creates security challenges analogous to those in systems with dynamic class loading [5]. Just as prompt injection can alter execution flow, dynamically loaded dependencies in agentic systems can introduce unexpected vulnerabilities at runtime.

CBOM must capture this dynamic, execution-dependent dependency graph—something SBOMs were never designed to do.

### Agentic Evaluation and Benchmarking

A key challenge is evaluating agentic systems systematically. This requires benchmarking at multiple levels:

- **Domain-agnostic benchmarking**: General-purpose evaluation of agent capabilities, safety properties, and failure modes independent of specific use cases
- **Domain-driven benchmarking**: Task-specific evaluation that captures the security requirements and threat models of particular application domains (e.g., code generation, customer service, IT operations)
- **Agentic-framework benchmarking**: Evaluation of the underlying frameworks, protocols (MCP, A2A), and orchestration layers that agents depend on

These benchmarking approaches help identify vulnerabilities before deployment and establish baselines for comparing security properties across different agentic implementations.

### Design Safeguards

Beyond new tools and benchmarks, careful system design is essential:

1. **Clear mediation**: All interactions—whether from users, tools, other agents, or the language model itself—should pass through a central control layer that enforces policies and limits capabilities

2. **Disciplined memory handling**: Not all past information should automatically influence future decisions. Restricting memory reuse to information clearly relevant to the current objective helps prevent long-term drift

3. **Lightweight validation**: Before actions are executed, plans and model outputs should be checked for basic consistency and completeness

4. **Tool constraints**: External tools should be constrained by predefined patterns and monitored closely. Newly introduced tools should be treated as untrusted until reviewed

5. **Skills security**: Vetting and sandboxing specialized capabilities agents can invoke, with careful review before deployment

6. **Control plane enforcement**: Moving beyond advisory security to enforceable guardrails that cannot be bypassed

---

## References

[1] Randall Munroe. "Dependency." XKCD #2347. https://xkcd.com/2347/

[2] D. Sculley et al. "Hidden Technical Debt in Machine Learning Systems." *Proceedings of the 28th International Conference on Neural Information Processing Systems (NeurIPS)*, 2015.

[3] Mohannad Alhanahnah and Yazan Boshmaf. "DepsRAG: Towards Agentic Reasoning and Planning for Software Dependency Management." *NeurIPS 2024 Workshop on Open-World Agents*, 2024.

[4] Joseph Spracklen et al. "We Have a Package for You! A Comprehensive Analysis of Package Hallucinations by Code Generating LLMs." *USENIX Security Symposium*, 2025.

[5] "Systems Security Foundations for Agentic Computing." arXiv:2512.01295, 2025. https://arxiv.org/abs/2512.01295

[6] Sam Altman (@sama). "we had a significant issue in ChatGPT due to a bug in an open source library..." Twitter/X, March 22, 2023. The bug was in redis-py, causing users to see other users' conversation titles.

---

*This post is based on a presentation at MLDAS on Agentic AI Supply Chain Security Challenges and Opportunities.*
