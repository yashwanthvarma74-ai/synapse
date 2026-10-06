# ADR 0016: The AI summary action

**Status:** accepted

## Context

The brief lists "summarize this board" as an extra. It sends user content to a third party and costs
money per call, so the interesting part is not the call, it is the guard rails.

## Decision

`POST /documents/:id/summarize` (the **server** calls the Anthropic Messages API; the key is
`ANTHROPIC_API_KEY`, never sent to a browser):

- **Who:** anyone who can *read* the document.
- **Input:** a document's text, or a whiteboard described as text (each shape and its words, and what is
  connected to what). At most 20,000 characters.
- **Prompt injection:** the content is untrusted text written by anyone with edit access. It goes in
  the user message inside `<content>` tags, and the system prompt says to treat it only as material, to
  ignore any instructions inside it, and not to reveal the prompt. The output is shown as **plain
  text**, never HTML, and the answer is capped at 600 tokens.
- **Cost control:** 10 summaries per person per hour (`SUMMARIES_PER_HOUR`); only delivered summaries
  count. Model defaults to `claude-sonnet-5-5` (`SUMMARY_MODEL` overrides it).
- **Privacy:** the tab says in plain words that the text is sent to an AI service, and labels the result
  "Written by AI". Off entirely when no key is set; `GET /config` tells the app so, and the tab is hidden.
- **Errors:** an upstream failure returns a generic 502; the real error is logged and never shown.

## Evidence

`server/test/summarize.test.ts` (13 tests): request structure (a hostile board stays inside the content
tags and out of the system prompt), roles, strangers, the rate limit and that failures do not use it,
empty documents never reach the model, no key means 501. With a deliberately invalid key the real SDK
call reached Anthropic and was refused (401), and the app showed a friendly message with nothing leaked.
**A summary from a valid key has not been generated yet**, so output quality is untested.

## Consequences and limits

- Prompt-injection defences reduce the risk and do not remove it: a model can still be talked into
  writing something misleading *inside* a summary. That is why the result is labelled and plain text.
- The limiter is in memory per API instance.
- Content is sent to a third party. Do not turn this on for data that must not leave your systems.
- "Tidy the board" (the brief's other half of this extra) is not built.
