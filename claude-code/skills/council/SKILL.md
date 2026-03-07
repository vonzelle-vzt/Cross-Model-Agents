# /council — Multi-Model Deliberation Protocol

## Description

Initiate a structured debate between Claude Opus and Codex GPT-5.4 on any decision, architecture, plan, or problem. Both models take positions, argue, rebut, and synthesize until they reach consensus or identify irreconcilable tradeoffs. Project-agnostic — works for any domain.

## User-invocable

Trigger: `/council <topic or question>`

## Instructions

When the user invokes `/council`, execute the following deliberation protocol:

### Phase 0: Frame the Question

1. Capture the user's question, decision, or topic
2. Write it to `/tmp/council-<uuid>.md`
3. Identify the decision type:
   - **Architecture** — system design, service boundaries, data models
   - **Implementation** — approach, framework, pattern choice
   - **Strategy** — business, product, technical direction
   - **Tradeoff** — competing priorities that need resolution
4. Generate a structured debate prompt with the question and any relevant codebase context

### Phase 1: Opening Positions (Parallel)

**Claude's Position** (you, directly):
Take a clear, opinionated position on the question. Don't hedge. State:
- Your recommended approach
- Top 3 reasons why
- Key risks you accept with this approach
- What you'd explicitly NOT do

**Codex's Position** (via CLI):
```bash
codex exec -m gpt-5.4 -s read-only --skip-git-repo-check "$(cat <<'PROMPT'
You are an expert taking a position in a structured debate with Claude Opus.
Take a CLEAR, OPINIONATED position. Don't hedge. Don't try to be balanced.

QUESTION: <the question>
CONTEXT: <any codebase context>

State:
1. YOUR RECOMMENDED APPROACH (be specific and decisive)
2. TOP 3 REASONS WHY (with concrete evidence or reasoning)
3. KEY RISKS YOU ACCEPT (be honest about downsides)
4. WHAT YOU WOULD EXPLICITLY NOT DO (and why)

Be direct. Take a real stance. The other model will challenge you.
PROMPT
)"
```

Display both positions to the user side-by-side.

### Phase 2: Rebuttals (Up to 3 rounds)

**Round N:**

1. **Claude rebuts Codex**: Read Codex's position. Challenge their weakest points. Defend your position where attacked. Concede where they're right — but only where they're actually right.

2. **Codex rebuts Claude**: Send Claude's rebuttal to Codex:
```bash
codex exec -m gpt-5.4 -s read-only --skip-git-repo-check "$(cat <<'PROMPT'
DEBATE ROUND <N> — You are arguing with Claude Opus.

YOUR PREVIOUS POSITION: <Codex's last position>
CLAUDE'S REBUTTAL: <Claude's rebuttal>

Instructions:
1. Where Claude is RIGHT: concede explicitly. Say "I concede: [point]"
2. Where Claude is WRONG: counter-argue with evidence
3. Where you've CHANGED YOUR MIND: state your updated position
4. Where you STILL DISAGREE: sharpen your argument

End with your UPDATED POSITION (incorporating concessions).
PROMPT
)"
```

3. **Check for convergence**: If both models have conceded on the same core points and their positions have merged, move to synthesis. If not, another round (max 3 rebuttal rounds).

### Phase 3: Synthesis

After rebuttals converge or max rounds reached:

1. **Claude writes a synthesis**: Merge both positions into a final recommendation
2. **Codex validates the synthesis**:
```bash
codex exec -m gpt-5.4 -s read-only --skip-git-repo-check "$(cat <<'PROMPT'
SYNTHESIS VALIDATION — Final check on the merged position.

ORIGINAL QUESTION: <question>
CLAUDE'S SYNTHESIS: <the merged recommendation>
YOUR LAST POSITION: <Codex's final position>

Validate:
1. Does this synthesis accurately represent the consensus?
2. Are any of YOUR key points missing or misrepresented?
3. Are the stated tradeoffs honest?
4. Rate your agreement: FULL CONSENSUS / PARTIAL CONSENSUS / DEADLOCK

If PARTIAL CONSENSUS or DEADLOCK, list the specific unresolved disagreements.
PROMPT
)"
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

### Cleanup

```bash
rm -f /tmp/council-*.md
```

## Protocol Rules

1. **No hedging in positions** — both models must take a clear stance
2. **Concessions are mandatory** — if the other model makes a valid point, concede it explicitly
3. **Updated positions after each round** — no repeating the same argument
4. **Evidence over opinion** — concrete reasoning beats "I think"
5. **The synthesis must be honest** — don't paper over real disagreements
6. **Max 3 rebuttal rounds** — if no consensus by round 3, declare the remaining disagreements as genuine tradeoffs
7. **Project-agnostic** — works on architecture, design, strategy, implementation, anything

## Reasoning Effort

All Codex calls use GPT-5.4 which inherits `model_reasoning_effort = "xhigh"` from `~/.codex/config.toml`. This ensures maximum reasoning depth on every deliberation round.

## Notes

- The user sees every round transparently — no hidden arguments
- Either model can "win" — there's no built-in bias toward Claude
- The most valuable output is often the **key insight that emerged from debate** — the thing neither model would have found alone
- Use codebase context when available (Read files, check patterns) to ground the debate in reality
- If the user has a preference, state it upfront so both models can argue for/against it
