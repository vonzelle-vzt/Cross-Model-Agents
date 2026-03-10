---
version: 3.0.0
description: "Multi-model structured deliberation protocol"
requires: [codex-mcp-server]
---

# /council — Multi-Model Deliberation Protocol

## Description

Initiate a structured debate between Claude Opus and Codex GPT-5.4 on any decision, architecture, plan, or problem. Both models take positions, argue, rebut, and synthesize until they reach consensus or identify irreconcilable tradeoffs. Uses Agent Teams for true parallel execution. Project-agnostic — works for any domain.

## User-invocable

Trigger: `/council <topic or question>`

## Instructions

When the user invokes `/council`, execute the following deliberation protocol:

### Phase 0: Frame the Question & Create Team

1. Capture the user's question, decision, or topic
2. Identify the decision type:
   - **Architecture** — system design, service boundaries, data models
   - **Implementation** — approach, framework, pattern choice
   - **Strategy** — business, product, technical direction
   - **Tradeoff** — competing priorities that need resolution
3. Gather any relevant codebase context (read files, check patterns)
4. Create a deliberation team:

```
TeamCreate: council-{topic-slug}-team
```

### Phase 1: Opening Positions (Parallel via Agent Teams)

Spawn two teammates **simultaneously** — both formulate positions in parallel:

**Claude Position Agent:**
```
Agent(
  subagent_type: "general-purpose",
  team_name: "council-{topic-slug}-team",
  name: "claude-advocate",
  prompt: "You are Claude's advocate in a structured debate.

QUESTION: <the question>
CONTEXT: <any codebase context>

Take a CLEAR, OPINIONATED position. Don't hedge. Don't try to be balanced.

State:
1. YOUR RECOMMENDED APPROACH (be specific and decisive)
2. TOP 3 REASONS WHY (with concrete evidence or reasoning)
3. KEY RISKS YOU ACCEPT (be honest about downsides)
4. WHAT YOU WOULD EXPLICITLY NOT DO (and why)

Be direct. Take a real stance. The other model will challenge you."
)
```

**Codex Position Agent** (calls Codex MCP):
```
Agent(
  subagent_type: "general-purpose",
  team_name: "council-{topic-slug}-team",
  name: "codex-advocate",
  prompt: "You represent Codex GPT-5.4 in a structured debate. Call the Codex MCP server to get GPT-5.4's position, then return it verbatim.

Use this MCP call:
mcp__codex__codex(
  prompt: 'You are an expert taking a position in a structured debate with Claude Opus.
Take a CLEAR, OPINIONATED position. Don't hedge. Don't try to be balanced.

QUESTION: <the question>
CONTEXT: <any codebase context>

State:
1. YOUR RECOMMENDED APPROACH (be specific and decisive)
2. TOP 3 REASONS WHY (with concrete evidence or reasoning)
3. KEY RISKS YOU ACCEPT (be honest about downsides)
4. WHAT YOU WOULD EXPLICITLY NOT DO (and why)

Be direct. Take a real stance. The other model will challenge you.',
  model: 'gpt-5.4',
  sandbox: 'read-only'
)

Return the full response from Codex."
)
```

> **CLI fallback:** If the Codex MCP server is unavailable, the codex-advocate should fall back to: `codex exec -m gpt-5.4 -s read-only --skip-git-repo-check "<prompt>"`

Display both positions to the user side-by-side.

### Phase 2: Rebuttals (Up to 3 rounds)

**Round N:**

1. **Claude rebuts Codex**: Spawn the claude-advocate again (or use `SendMessage` if the teammate is still active):

```
Agent(
  subagent_type: "general-purpose",
  team_name: "council-{topic-slug}-team",
  name: "claude-rebuttal-{N}",
  prompt: "DEBATE ROUND {N} — You are arguing FOR Claude's position AGAINST Codex's position.

CLAUDE'S POSITION: <Claude's last position>
CODEX'S POSITION: <Codex's last position>

Instructions:
1. Where Codex is RIGHT: concede explicitly. Say 'I concede: [point]'
2. Where Codex is WRONG: counter-argue with evidence
3. Where you've CHANGED YOUR MIND: state your updated position
4. Where you STILL DISAGREE: sharpen your argument

End with your UPDATED POSITION (incorporating concessions)."
)
```

2. **Codex rebuts Claude**: Spawn the codex-advocate again to relay to Codex MCP:

```
Agent(
  subagent_type: "general-purpose",
  team_name: "council-{topic-slug}-team",
  name: "codex-rebuttal-{N}",
  prompt: "Call the Codex MCP server to get GPT-5.4's rebuttal, then return it verbatim.

mcp__codex__codex(
  prompt: 'DEBATE ROUND {N} — You are arguing with Claude Opus.

YOUR PREVIOUS POSITION: <Codex last position>
CLAUDE REBUTTAL: <Claude rebuttal>

Instructions:
1. Where Claude is RIGHT: concede explicitly. Say I concede: [point]
2. Where Claude is WRONG: counter-argue with evidence
3. Where you have CHANGED YOUR MIND: state your updated position
4. Where you STILL DISAGREE: sharpen your argument

End with your UPDATED POSITION (incorporating concessions).',
  model: 'gpt-5.4',
  sandbox: 'read-only'
)

Return the full response from Codex."
)
```

3. **Check for convergence**: If both models have conceded on the same core points and their positions have merged, move to synthesis. If not, another round (max 3 rebuttal rounds).

> **Parallel dispatch:** Each round's Claude and Codex rebuttals are independent of each other (they respond to the PREVIOUS round's positions), so dispatch both simultaneously when possible.

### Phase 3: Synthesis

After rebuttals converge or max rounds reached:

1. **Claude writes a synthesis**: As the team lead, merge both positions into a final recommendation

2. **Codex validates the synthesis** (via a codex-advocate agent):
```
Agent(
  subagent_type: "general-purpose",
  team_name: "council-{topic-slug}-team",
  name: "codex-validator",
  prompt: "Call the Codex MCP server to validate the synthesis, then return it verbatim.

mcp__codex__codex(
  prompt: 'SYNTHESIS VALIDATION — Final check on the merged position.

ORIGINAL QUESTION: <question>
CLAUDE SYNTHESIS: <the merged recommendation>
YOUR LAST POSITION: <Codex final position>

Validate:
1. Does this synthesis accurately represent the consensus?
2. Are any of YOUR key points missing or misrepresented?
3. Are the stated tradeoffs honest?
4. Rate your agreement: FULL CONSENSUS / PARTIAL CONSENSUS / DEADLOCK

If PARTIAL CONSENSUS or DEADLOCK, list the specific unresolved disagreements.',
  model: 'gpt-5.4',
  sandbox: 'read-only'
)

Return the full response from Codex."
)
```

### Phase 4: Present the Council Decision

Output the final deliverable:

```
## Council Decision: <topic>

### Consensus Position
<The merged recommendation both models agreed on>

### Key Agreements
- <Point both models converged on>
- <Point both models converged on>

### Resolved Debates
- <Point where one model convinced the other, with reasoning>

### Remaining Disagreements (if any)
- <Point of genuine tradeoff — Claude's view vs Codex's view>
- <Why this disagreement exists and what it depends on>

### Confidence Level
FULL CONSENSUS / PARTIAL CONSENSUS / DEADLOCK

### Debate Summary
- Rounds: <N>
- Concessions by Claude: <count>
- Concessions by Codex: <count>
- Key insight that emerged from debate: <the thing neither model saw alone>
```

## Protocol Rules

1. **No hedging in positions** — both models must take a clear stance
2. **Concessions are mandatory** — if the other model makes a valid point, concede it explicitly
3. **Updated positions after each round** — no repeating the same argument
4. **Evidence over opinion** — concrete reasoning beats "I think"
5. **The synthesis must be honest** — don't paper over real disagreements
6. **Max 3 rebuttal rounds** — if no consensus by round 3, declare the remaining disagreements as genuine tradeoffs
7. **Project-agnostic** — works on architecture, design, strategy, implementation, anything
8. **True parallelism** — use Agent Teams to dispatch independent work simultaneously

## Reasoning Effort

All Codex calls use GPT-5.4 which inherits `model_reasoning_effort = "xhigh"` from `~/.codex/config.toml`. This ensures maximum reasoning depth on every deliberation round.

## Notes

- The user sees every round transparently — no hidden arguments
- Either model can "win" — there's no built-in bias toward Claude
- The most valuable output is often the **key insight that emerged from debate** — the thing neither model would have found alone
- Use codebase context when available (Read files, check patterns) to ground the debate in reality
- If the user has a preference, state it upfront so both models can argue for/against it
- Agent Teams enable true parallel execution — both positions formulated simultaneously, not sequentially
