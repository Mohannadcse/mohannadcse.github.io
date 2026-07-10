---
layout: post
title: "The Agent That Was Never Called: How a Framework Migration Silently Rewired DepsRAG's Topology"
date: 2026-07-10
description: Migrating a multi-agent app between frameworks can silently change its topology. DepsRAG kept working correctly after moving from Langroid to Agno—while one of its agents was never invoked at all.
tags: [agentic-ai, multi-agent, debugging, agno, langroid, DepsRAG]
categories: agentic-ai
related_posts: false
---

### TL;DR

After migrating DepsRAG from Langroid to Agno, the system behaved exactly as expected—every answer was correct. Yet one of its agents, the AssistantAgent that was supposed to orchestrate the whole workflow, was never invoked at all. Agno's `Team` construct creates an implicit coordinator by default, making the ported AssistantAgent redundant. Runtime testing couldn't catch this because Agno injects each member's role into the coordinator's prompt, so the coordinator absorbed the AssistantAgent's orchestration instructions and preserved the expected behavior. We caught the redundancy only when a pre-deployment analysis tool we are developing visualized the app's actual topology. This post walks through the bug, why it was behaviorally invisible, and what it says about debugging agentic applications.

{: .notice--info}

## Introduction

There is a class of bugs in multi-agent applications that produces no wrong answers, no exceptions, and no failed tests. The system does exactly what you designed it to do—just not the *way* you designed it to. This post is about one of those bugs: how it was introduced during a framework migration, why every behavioral signal looked healthy, and how it finally surfaced.

The subject is [DepsRAG](https://github.com/Mohannadcse/DepsRAG) [1], our multi-agent system for reasoning about software dependency graphs. DepsRAG builds a package's dependency graph in Neo4j, then answers questions about it—including vulnerability lookups—by coordinating several specialized agents.

## DepsRAG's Architecture

DepsRAG was originally built on [Langroid](https://github.com/langroid/langroid), where orchestration is explicit: you designate an agent as the orchestrator and wire the delegation hierarchy yourself. The design had four agents:

- **AssistantAgent**: the orchestrator. It receives the user's question, breaks it into sub-questions, delegates to the workers, and synthesizes the final answer.
- **DependencyGraphAgent**: constructs the dependency graph in Neo4j and runs Cypher queries against it.
- **SearchAgent**: performs web searches and vulnerability lookups.
- **CriticAgent**: reviews every answer before it reaches the user.

In Langroid, the AssistantAgent is load-bearing. Remove it and nothing coordinates the workers—the app simply doesn't function.

## The Migration to Agno

We later migrated DepsRAG to [Agno](https://github.com/agno-agi/agno) ([PR #9](https://github.com/Mohannadcse/DepsRAG/pull/9)). The port looked like the obvious 1:1 mapping: each Langroid agent became an Agno `Agent`, and all four were placed into an Agno `Team` in `coordinate` mode:

```python
team = Team(
    name="DepsRAG",
    model=model,
    members=[assistant, dependency_agent, search_agent, critic],
    mode=TeamMode.coordinate,  # Assistant coordinates member agents
    ...
)
```

Note the comment—it records what we *believed* was happening. The AssistantAgent kept its full orchestration brief in its `role`:

```python
Agent(
    name="AssistantAgent",
    role="""...
1. Guide users through the process of creating and analyzing dependency graphs
2. Validate that dependency graph creation succeeds before proceeding
3. Break down complex questions into simpler sub-questions
4. Coordinate with DependencyGraphAgent, SearchAgent, and CriticAgent
5. Synthesize information from multiple sources into comprehensive answers
...""",
    tools=[],
    ...
)
```

The migrated app worked. Graph construction, dependency questions, vulnerability checks, critic review—all correct. The tests passed. We moved on.

## What the Topology Actually Looked Like

The redundancy surfaced only when we ran DepsRAG through a pre-deployment analysis tool we are currently developing. The tool statically extracts a multi-agent application's topology—agents, tools, and delegation paths—and, crucially, it understands the *semantics* of the agentic framework underneath, not just the code that names the agents.

That last part matters here, because Agno's `Team` in `coordinate` mode creates an **implicit coordinator**: the team's own `model` acts as a team leader that receives the user's query and delegates to members. This coordinator doesn't appear anywhere in your code as an agent—it is a framework-level construct. A topology extractor that only parses your agent definitions would never draw it.

{% include figure.liquid loading="eager" path="assets/img/blog/2026/depsrag-topology-comparison.png" class="img-fluid rounded z-depth-1" zoomable=true %}
<div class="caption">
    (a) The ported topology: Agno's implicit team coordinator delegates to four members, one of which—AssistantAgent—is itself an orchestrator with no tools and no one to orchestrate. (b) The corrected topology: the coordinator delegates directly to the three worker agents.
</div>

The visualization made the problem obvious in a way the code never did. In topology (a), the AssistantAgent sits as a *member* under the implicit coordinator—a coordinator reporting to a coordinator. It owns no tools (the Neo4j, HTTP, and DuckDuckGo tools all belong to the workers), and the workers it was designed to orchestrate are its siblings, not its subordinates. It is structurally redundant.

## Confirming It at Runtime

A suspicious topology is a hypothesis, not a diagnosis. To understand how DepsRAG actually behaved with this structure, we collected runtime traces using Agno's built-in telemetry plus custom logging around agent invocations, and ran our usual workloads.

The traces showed two things:

1. **The AssistantAgent was never invoked.** Zero calls, across every session. The implicit coordinator delegated directly to DependencyGraphAgent, SearchAgent, and CriticAgent—exactly the delegation pattern in topology (b), even though the code expressed topology (a).
2. **The system's behavior was still correct.** Graph validation happened before analysis, complex questions were decomposed, and the CriticAgent reviewed answers before delivery—all the responsibilities we had assigned to the AssistantAgent were being carried out. By something else.

A dead agent and a correct system. That combination is what makes this bug interesting.

## Why the Bug Was Invisible

The answer is in how Agno assembles the coordinator's prompt. When a `Team` runs in `coordinate` mode, the team leader's system message embeds a description of every member—including each member's `role`—so the leader knows who to delegate to:

```python
# agno/team/_messages.py (abridged)
content += f'<member id="{member_id}" name="{member.name}">\n'
if member.role is not None:
    content += f"  Role: {member.role}\n"
if member.description is not None:
    content += f"  Description: {member.description}\n"
```

Recall what the AssistantAgent's `role` contained: the *entire orchestration workflow*—validate graph creation before proceeding, decompose complex questions, always route answers through the CriticAgent. All of that text was injected verbatim into the implicit coordinator's system prompt as a member description.

So the coordinator read a member profile that spelled out, step by step, how to orchestrate this team—and simply executed that workflow itself. Delegating to the AssistantAgent was never a rational choice from the coordinator's perspective: the member had no tools, and its stated job was the one the coordinator was already doing. The framework's prompt-assembly mechanics quietly transferred the dead agent's responsibilities to the component that made it dead.

This is why every behavioral test passed. The orchestration *logic* survived the migration perfectly. Only the orchestration *structure* didn't—and none of our testing observed structure.

## The Fix

The fix ([PR #21](https://github.com/Mohannadcse/DepsRAG/pull/21)) makes the implicit coordinator's job official. The AssistantAgent is removed entirely, and its orchestration guidance moves to where it was already being consumed—the team level:

```python
team = Team(
    name="DepsRAG",
    model=model,
    members=[dependency_agent, search_agent, critic],
    mode=TeamMode.coordinate,
    instructions=[
        "Delegate dependency graph creation to DependencyGraphAgent, then verify the response indicates success before any follow-up analysis.",
        "Route web and vulnerability questions to SearchAgent.",
        "Break complex user requests into clear, self-contained subtasks for delegated members.",
        "Before responding to the user, ALWAYS delegate to CriticAgent for validation.",
        ...
    ],
)
```

Behavior is unchanged—which is the point. The code now says what the system was already doing.

One might ask: if behavior was correct, why fix it at all? Because a redundant agent is not free:

- **Token and latency overhead.** The AssistantAgent's ~50-line role was injected into the coordinator's system prompt on every single run, for an agent that contributed nothing.
- **Misleading architecture.** Anyone reading the code—or debugging an incident—would reason about a delegation path that doesn't exist. The comment `# Assistant coordinates member agents` was actively false.
- **Fragile correctness.** The system worked because of an undocumented prompt-assembly detail. An Agno update that changed how member roles are shared with the leader could have silently dropped the orchestration logic—graph validation, critic review—with no code change on our side.
- **A larger surface.** Every agent in a topology is a delegation target the coordinator *may* choose. A dead agent that could occasionally come alive under unusual prompts is a reliability and security liability, not a neutral bystander.

## The Broader Lesson: Behavior Is Not Enough

Stepping back, three things about this bug generalize well beyond DepsRAG.

**Framework migrations are not 1:1 mappings.** Agentic frameworks disagree on a fundamental design question: is orchestration something you *build* (Langroid's explicit orchestrator agent) or something you *get* (Agno's implicit team coordinator)? A migration that maps agent-to-agent without mapping *orchestration model to orchestration model* will produce exactly this kind of structural bug. The same trap exists in other directions—porting to frameworks with graph-based control flow, supervisor patterns, or handoff semantics each redraws the topology in ways the agent definitions alone don't reveal.

**Behavioral testing cannot catch structural bugs that preserve behavior.** Our test suite validated answers, not delegation paths. It had no way to fail—the answers were right. Bugs like this need *structural* verification: does the topology the code implies match the topology the framework will actually execute? That question must be answered before deployment, because after deployment there is no symptom to chase.

**Topology extraction must understand framework semantics.** The redundancy was only visible because the analysis knew that Agno's `Team(mode=coordinate)` spawns an implicit coordinator and that member roles are folded into its prompt. A framework-agnostic view of the code—four agents, some tools—looks perfectly reasonable. It is the framework's runtime semantics that turn the design into a bug, so it is framework semantics that pre-deployment analysis has to model. This is precisely the gap the pre-deployment verification tool we are building aims to close, and DepsRAG has become one of its first real case studies.

## Takeaways

- When adopting a multi-agent framework, identify what orchestration it provides *implicitly* before porting your explicit orchestration onto it.
- Correct output is weak evidence of correct structure. Trace which agents actually run; an agent with zero invocations is either dead code or a latent liability.
- Prompt-assembly mechanics (what each agent sees about the others) can mask design bugs by redistributing responsibilities at runtime. Know what your framework injects where.
- Visualize the *effective* topology—framework constructs included—not the topology your code appears to declare. The gap between the two is where this class of bugs lives.

---

## References

[1] Mohannad Alhanahnah and Yazan Boshmaf. "DepsRAG: Towards Agentic Reasoning and Planning for Software Dependency Management." *NeurIPS 2024 Workshop on Open-World Agents*, 2024.

[2] DepsRAG repository. https://github.com/Mohannadcse/DepsRAG

[3] Langroid: Multi-Agent Programming Framework. https://github.com/langroid/langroid

[4] Agno: Framework for Building Multi-Agent Systems. https://github.com/agno-agi/agno

[5] DepsRAG PR #9: Migrate DepsRAG from Langroid to Agno. https://github.com/Mohannadcse/DepsRAG/pull/9

[6] DepsRAG PR #21: Refactor team orchestration and remove unused AssistantAgent path. https://github.com/Mohannadcse/DepsRAG/pull/21
