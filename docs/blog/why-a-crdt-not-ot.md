# Why Synapse uses a CRDT and not OT

*About a 10 minute read. Everything shown here comes from [Synapse](../../README.md), a collaborative
editor I built to understand this properly. The code is in `lab/` and `server/`.*

Two people open the same document. It says `Hello`. Both lose their connection. Yash types
` world` at the end. Kalyan types ` there` at the end. They reconnect.

What should the document say?

You cannot keep one version, because someone's work disappears. You cannot just paste both
in whatever order they arrive, because then Yash and Kalyan could end up looking at different
documents. Every collaborative editor has to answer this, and there are two well known
answers: **operational transformation (OT)** and **CRDTs**. I picked a CRDT (the library
[Yjs](https://github.com/yjs/yjs)) for Synapse. This post is why, what it cost me, and the
parts of the argument I could not test.

## The two answers, in one paragraph each

**OT** asks a central server to decide. Every edit goes to the server, which puts it in one
global order. If your edit was made before you saw someone else's, the server rewrites it so it
still means what you intended once their change is in. Ellis and Gibbs described the idea in
1989, and the Jupiter system (1995) described a design with a server in the middle. Google Docs
is widely described as working this way.<sup>[1]</sup>

**A CRDT** puts the intelligence in the data. Every character carries an identity and enough
information about where it sits, so any copy can merge any set of edits, in any order, with no
server deciding anything, and still land on the same result. Shapiro and his co-authors
formalised the idea in 2011; Yjs uses an algorithm called YATA (2016).

The practical difference is *who decides how edits combine*. In OT it is a server. In a CRDT
it is a rule every copy follows identically.

## A demo you can run

`lab/02-merge-demo.mjs` is 60 lines. Here is the first experiment. Yash and Kalyan both start from
`Hello`, go offline, and type at the same spot. Two observers receive their edits in
**opposite orders**:

```js
yash.getText('t').insert(5, ' world') // offline
kalyan.getText('t').insert(5, ' there')  // offline, same spot
sync(yash, a); sync(kalyan, a)           // observer A hears Yash first
sync(kalyan, b);  sync(yash, b)          // observer B hears Kalyan first
```

```
observer A : "Hello world there"
observer B : "Hello world there"
```

Same result. Nobody decided; the order did not matter. When two edits land in exactly the same
place, Yjs breaks the tie using each copy's random client ID, and every copy compares the same
IDs, so every copy agrees. (When I first ran this I expected the arrival order to decide, and I
was wrong. The IDs decide. Setting them by hand made it repeatable, and flipping them flipped
the result.)

Two more properties fall out of this:

- **Delivering an update twice is harmless.** Applying the same update three times left the
  text as `once`. This matters more than it sounds, and it comes back below.
- **Reconnecting sends only what is missing.** After a small offline edit to a 5,000 character
  document, the whole document is 5,044 bytes, and what actually needs to go to the server is
  **31 bytes**, because the two sides compare a short summary of what each has seen.

## Why offline decided it

Synapse's headline feature is: both people go offline, edit the same paragraph, reconnect, and
nothing is lost. That one sentence is what picked the design.

With OT, a client that was offline for 20 minutes comes back holding hundreds of edits made
against a document that has since changed. The server has to transform that whole backlog
against everything that happened meanwhile, in order. It can be done, but the work the server
does grows with the size of the gap, for every client that comes back.

With a CRDT there is no backlog to rebase. The edits already carry what they need. They merge
whenever they arrive, and a server is not required for correctness at all, which is also why any
of Synapse's gateways can serve any document.

I measured the reconnect. I simulated the number of edits that 1, 5 and 30 minutes of typing
produce (four edits a second per person, a mix of typing and deleting), let two people edit the
same document with no connection, and timed how long after reconnecting both screens agreed:

| Simulated offline time | Edits each | Document size (about) | One person offline | Both offline |
|---|---|---|---|---|
| 1 min | 240 | 7 KB | 8 ms | 16 ms |
| 5 min | 1,200 | 30 KB | 13 ms | 18 ms |
| 30 min | 7,200 | 173 KB | 44 ms | 58 ms |

Read these carefully. It is one laptop with no real network, so there is no round trip in
them: they show the merge cost, not what a user waits for. And I simulated the *volume* of
edits instead of waiting 30 real minutes, because merge cost depends on how many edits there
are, not on the clock. What it does show is that the merge itself is cheap and grows slowly.

## What a CRDT costs

None of this is free.

**Memory.** Every character has an identity, and deleted text leaves a marker behind, so a
document is bigger than its visible text. You have to compact. Synapse stores an append-only log
of edits plus snapshots, and merges the log into a new snapshot every 100 edits.

**It merges, it does not understand.** The third experiment in the demo: Yash deletes the word
`editor` from `ship the editor first` while Kalyan, still looking at the old version, types `XX`
in the middle of it. Both copies end up with:

```
"ship the XX first"
```

Both copies agree, which is the CRDT's promise. But is it what either person wanted? Kalyan's
`XX` survived inside a word that no longer exists. A CRDT guarantees convergence, not
good intent. OT has the same limit in different forms; neither is a mind reader.

**Exact bytes are not the same everywhere, immediately.** More on this below, because it
taught me how to test one of these.

## The bug I made, and the idea that fixed it

Compaction was where I got it wrong. My first version said: "merge everything up to edit number
N into a snapshot, then delete everything up to N." A test that wrote to one document from two
places at once showed edits going missing. The reason: an edit's number is reserved *before*
the edit is saved, so compaction could read "up to 10" while edit 8 was still being written,
then delete it.

The fix is the property from earlier. **Applying an update twice changes nothing.** So loading
can merge everything it finds, duplicates included, and compaction only deletes the exact
records it actually read. Two compactions running at once cannot lose anything, with no lock
at all. A property of the data type replaced a coordination protocol. That, more than any
benchmark, is why I am comfortable with the choice.

## How I decided to trust it

You should not believe a convergence claim because a paper says so, or because a demo worked
once. Synapse has a property-based test: three copies receive random inserts, deletes and
formatting, sync in random partial orders, then fully. Every run must end with identical
copies. It has run 10,000 times (62,608 random edits, about one second).

My first version of that test **failed after 2,771 runs.** I assumed it was a convergence bug.
It was not. The text, the formatting and the version summaries were all identical. What differed
was a record of which small formatting markers had been tidied away. Each copy tidies those up
by itself, and the tidying travels in the *next* round of syncing. So the guarantee is:
**identical content immediately, identical stored bytes once syncing goes quiet.** I rewrote the
test to check exactly that, and it has passed every run since. Without the property test I would
have either believed a stronger claim than the library makes or blamed the wrong thing.

## Permissions cannot live inside the CRDT

One more lesson, and it applies to anything built this way. Content can be eventually
consistent: it is fine for two copies to differ for a moment. Permissions cannot. "Yash no
longer has access" must not wait for Yash's laptop to reconnect, and it must not be an edit that
anyone with write access could make.

So Synapse has two separate worlds. Document content is merged freely by the CRDT. Access is
decided only by the server, checked when someone joins and on every single write; a viewer's
edit is dropped before it touches the document. The CRDT is only ever as trustworthy as the
rules wrapped around it.

## When OT is still the better choice

I do not think a CRDT is always right. OT fits when:

- people are almost always online, so offline editing is not a feature;
- one authoritative server is acceptable, and you want that server to enforce rules about
  *content*, not only access;
- you want less history in memory, since the server holds the order and clients can keep less
  per-character bookkeeping.

There is also a serious argument against my choice. David Sun, Chengzheng Sun, Agustina Ng and
Weiwei Cai have published two papers contending that OT, not CRDT, remains the practical
choice for most real co-editors, that CRDT designs hide complexity and flaws, and that the
claim of CRDT superiority is overstated.<sup>[5]</sup> I have read their abstracts, not
reproduced their results, and I do not claim to settle the debate. It is worth reading
before you pick a side, and it is a reminder that I built a CRDT *system*, not an OT one to
compare against.

## What I did not do

I want to be plain about the limits of this post:

- **I did not build an OT version.** My comparison is an argument from how the two designs
  work, the literature, and my measurements of the CRDT. I never measured OT against it.
- **The latency numbers have no real network in them** and the offline time is simulated.
- **One library, one data type.** I used Yjs on text and a map of objects. Other CRDTs and
  other data shapes behave differently.
- **The result I trust most is the unglamorous one:** the property test, the compaction bug and
  the "content versus bytes" correction. They are what made me trust the choice, and none of
  them are about speed.

## If you want the short version

Pick a CRDT when offline editing is a core feature and you want any server to be able to serve
any document. Pick OT when everyone is online and a single server in charge is a feature, not a
limit. Whichever you pick, write a test that throws random edits at three copies and checks they
agree. It will teach you what the guarantee actually is.

## References

1. [Operational transformation](https://en.wikipedia.org/wiki/Operational_transformation) (Wikipedia), for the central-server design and its use in Google Docs. Google has not, to my knowledge, published its current internals.
2. C. A. Ellis and S. J. Gibbs. *Concurrency control in groupware systems.* ACM SIGMOD, 1989, pp. 399-407.
3. D. A. Nichols, P. Curtis, M. Dixon and J. Lamping. *High-latency, low-bandwidth windowing in the Jupiter collaboration system.* ACM UIST, 1995, pp. 111-120.
4. M. Shapiro, N. Preguiça, C. Baquero and M. Zawirski. [*Conflict-free Replicated Data Types.*](https://www.lip6.fr/Marc.Shapiro/papers/2011/CRDTs_SSS-2011.pdf) SSS 2011, LNCS 6976, pp. 386-400.
5. D. Sun, C. Sun, A. Ng and W. Cai. [*Real Differences between OT and CRDT in Correctness and Complexity for Consistency Maintenance in Co-Editors*](https://arxiv.org/abs/1905.01302) and [*Real Differences between OT and CRDT in Building Co-Editing Systems and Real World Applications*](https://arxiv.org/abs/1905.01517) (arXiv, 2019). They argue for OT; read them alongside the CRDT papers.
6. P. Nicolaescu, K. Jahns, M. Derntl and R. Klamma. [*Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types.*](https://dl.eusset.eu/items/b52fa5b8-306d-4727-9769-4057262152a7) ACM GROUP, 2016 (the YATA algorithm behind Yjs).

*Code and numbers:* `lab/01-converge.mjs` and `lab/02-merge-demo.mjs` (the demos),
`server/bench/partition.ts` and `server/bench/convergence.ts` (the measurements),
[`docs/BENCHMARKS.md`](../BENCHMARKS.md) (method and limits), and the decision records
[0001](../adr/0001-crdt-yjs-over-ot.md), [0002](../adr/0002-two-consistency-domains.md) and
[0004](../adr/0004-update-log-and-snapshots.md).
