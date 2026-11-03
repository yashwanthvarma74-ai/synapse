# ADR 0015: TanStack Query for server data, Zustand for UI-only state

**Status:** accepted (reverses an earlier decision to use plain `fetch` and React state)

## Context

The brief specifies TanStack Query for server data (roles, comments) and Zustand for UI-only state.
The first version used `useEffect` plus `fetch` in every component, which worked but repeated the same
loading, error, refetch-after-change and polling code in seven places.

## Decision

- **Server data** goes through TanStack Query (`web/src/lib/queries.ts`): one cache, named query keys,
  automatic de-duplication (the header and the page share one "who am I" request), polling for comments
  (every 5 seconds), and `useAction`, a small wrapper that runs a change and then refreshes the lists
  it affects. Errors from the server (403, 404) are not retried.
- **UI-only state** lives in a Zustand store (`web/src/lib/uiStore.ts`): whether the Share dialog is
  open, the whiteboard's selected tool and its help dialog.
- **Live collaboration state is neither.** The Yjs document, awareness and connection status stay in
  their own subscriptions (`useCollab`), because they are not request/response data.
- On sign-out the whole cache except "who am I" is dropped, so nothing cached for one person can appear
  for the next.

## Evidence

All flows were exercised in a real browser after the migration (dashboard, search, workspace, comments
add and resolve, versions, share dialog, whiteboard tool and help). 102 web tests pass, with a test
wrapper (`web/src/test/wrap.tsx`) giving each test a fresh cache.

## Consequences

- Less code per component and one place to change caching rules.
- Two extra dependencies and a provider at the root.
- Comments still poll; a push channel would be better and is not built.
- A Zustand store is module-level state: the whiteboard resets its slice when it unmounts so one board's
  tool does not leak into the next.

## Alternatives

Keep plain state (what the first version did: fewer dependencies, more repetition); SWR (similar to Query).
