# AgentGuard

AI agent security and runtime governance: evaluating requested tool actions before they execute.

## Project status

This repository currently contains documentation only. Application source code has not been added, so the implementation, integrations, tests and deployment cannot be verified from this repository.

The sections below describe the intended design discussed for AgentGuard. They are not a claim that these capabilities are implemented or running.

## Purpose

An AI agent can request actions such as reading files or sending messages. AgentGuard is intended to place a policy enforcement layer between the agent's tool request and the code that performs the action.

The core idea is simple: the agent proposes an action; the application decides whether it is permitted.

## Intended features

- Evaluate tool names and arguments before execution.
- Return an `ALLOW`, `BLOCK` or `REQUIRE_APPROVAL` decision.
- Use deterministic rules for policy evaluation.
- Require human approval for selected actions.
- Record policy decisions and execution outcomes for auditing.

### Proposed request flow

```text
AI agent
   |
Structured tool request
   |
Validation and policy evaluation
   |
   +-- ALLOW ------------> Execute permitted action
   +-- BLOCK ------------> Reject request
   +-- REQUIRE_APPROVAL -> Wait for verified approval
                           before execution

Policy decisions and execution outcomes -> Audit log
```

This is a conceptual flow, not a verified diagram of a deployed application.

### Illustrative policy rules

These examples came from the design discussion and are not tested enforcement guarantees.

| Requested action | Intended decision |
| --- | --- |
| List files in an authorized location | Allow |
| Read a protected credentials file | Block |
| Delete a file | Block |
| Send an email | Require approval |
| Call an unknown tool | Block by default |

## Discussed technology choices

| Technology | Proposed role |
| --- | --- |
| Python | Backend and policy logic |
| OpenAI API and function calling | Structured tool requests from the agent |
| REST APIs | Communication between components |
| Supabase / PostgreSQL | Storage for audit events |

These choices have not been confirmed against source code or dependency files in this repository.

## Implementation work to verify

- [ ] Add the actual application source and dependency files.
- [ ] Document the implemented rules and supported tools.
- [ ] Verify request validation, authorization and approval handling.
- [ ] Add and run tests for allowed, blocked, malformed and unknown requests.
- [ ] Verify audit logging and sensitive-data redaction.
- [ ] Document reproducible setup and execution steps.
- [ ] Add deployment details only after confirming the running application.

## Security considerations for implementation

All protected tool execution would need to pass through the enforcement layer. Actions that bypass it would fall outside its protection.

Before treating the system as a security boundary, verify schema validation, canonical file-path checks, identity-based authorization, fail-closed behavior and approval checks bound to the exact requested action. Audit logs should avoid storing secrets.

## Running, testing and deployment

No runnable application, setup commands or test suite are included yet. No deployment URL or performance results are published here. This README should be updated against the actual implementation when the source is added.
