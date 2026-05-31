// Shared runtime types and the in-memory lexicon adapter.
//
// These are the structural mirrors of the truespeech runtime's public
// shapes (kept local so the sandbox/tutorial front-ends don't need a
// build-time dependency on the runtime package), plus a small
// read/write LexiconAdapter implementation with seed/reset/dirty
// helpers. Imported by both the sandbox notebook (sandbox/main.ts) and
// the tutorial's standalone cells (tutorial/main.ts).
// In-memory LexiconAdapter with seed/reset/dirty extensions. The
// sandbox uses one shared instance; the tutorial gives each
// interactive cell its own so cells can't interfere with one another.
export class MemoryLexicon {
    entries = [];
    seed = [];
    async add(entry) {
        this.entries.push(entry);
    }
    async list() {
        return this.entries.map(cloneEntry);
    }
    getEntries() {
        return this.entries.map(cloneEntry);
    }
    // The runtime's LexiconAdapter contract (v0.4.0+) names this `remove`
    // and expects a Promise<boolean> indicating whether anything was
    // removed.
    async remove(name) {
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => e.name !== name);
        return this.entries.length < before;
    }
    snapshotSeed() {
        this.seed = this.entries.map(cloneEntry);
    }
    reset() {
        this.entries = this.seed.map(cloneEntry);
    }
    // Both sides are normalized through cloneEntry before serializing —
    // without normalization, the runtime's construction-order of the
    // entry object differs from cloneEntry's, and JSON.stringify produces
    // unequal strings even when the content matches.
    isDirty() {
        if (this.entries.length !== this.seed.length)
            return true;
        return (JSON.stringify(this.entries.map(cloneEntry)) !==
            JSON.stringify(this.seed));
    }
}
export function cloneEntry(e) {
    if (e.kind === "region") {
        return {
            kind: "region",
            name: e.name,
            description: e.description,
            impacts: e.impacts.map((i) => ({
                metric: i.metric,
                region: {
                    timeStart: i.region.timeStart,
                    timeEnd: i.region.timeEnd,
                    constraints: i.region.constraints.map((c) => ({ ...c })),
                },
            })),
        };
    }
    return {
        kind: "boundary",
        name: e.name,
        at: e.at,
        metrics: [...e.metrics],
        constraints: e.constraints.map((c) => ({ ...c })),
        before: { ...e.before },
        after: { ...e.after },
        changeDescription: e.changeDescription,
    };
}
