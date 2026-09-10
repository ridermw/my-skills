import { RoomReader } from "./reader.mjs";
import { readRoom } from "./room.mjs";

const states = new WeakMap();
const roomError = (code, message) => Object.assign(new Error(message), { code });
const closedError = () => roomError("ROOM_CLOSED", "Canvas room access is closed");

class Grant {
    #leases = 0;
    #retired = false;
    #closing;
    #closed = Promise.withResolvers();

    constructor(reader) {
        this.reader = reader;
    }

    get closed() {
        return this.#closed.promise;
    }

    async use(action) {
        if (this.#retired) throw closedError();
        this.#leases++;
        try {
            return await action(this.reader);
        } finally {
            this.#leases--;
            if (this.#retired && this.#leases === 0) this.#close();
        }
    }

    #close() {
        if (!this.#closing) {
            this.#closing = this.reader.close();
            this.#closing.then(this.#closed.resolve, this.#closed.reject);
        }
    }

    retire() {
        this.#retired = true;
        if (this.#leases === 0) this.#close();
        return this.closed;
    }

    forceClose() {
        this.#retired = true;
        this.#close();
        return this.closed;
    }
}

function slotFor(state) {
    let slot = states.get(state);
    if (!slot) {
        slot = {
            current: null, seed: null, latest: null, pending: new Set(),
            grants: new Set(), errors: [], closed: false, disposal: null,
        };
        states.set(state, slot);
    }
    return slot;
}

async function openGrant(slot, root, signal) {
    const reader = await RoomReader.open(root, { signal });
    const grant = new Grant(reader);
    slot.grants.add(grant);
    grant.closed.then(
        () => slot.grants.delete(grant),
        (error) => {
            slot.grants.delete(grant);
            slot.errors.push(error);
            console.error("Native room reader disposal failed:", error);
        },
    );
    if (slot.closed) {
        await grant.forceClose();
        throw closedError();
    }
    return grant;
}

async function currentGrant(state, slot) {
    if (slot.closed) throw closedError();
    if (slot.current) return slot.current;
    if (!state.roomPath) throw roomError("ROOM_NOT_SELECTED", "No room is open");
    if (!slot.seed) {
        const seed = { controller: new AbortController(), adopted: false, promise: null };
        slot.seed = seed;
        seed.promise = openGrant(slot, state.roomPath, seed.controller.signal).then(async (grant) => {
            if (slot.current) {
                await grant.retire();
                return slot.current;
            }
            seed.adopted = true;
            slot.current = grant;
            state.roomPath = grant.reader.root;
            return grant;
        }).finally(() => {
            if (slot.seed === seed) slot.seed = null;
        });
    }
    return slot.seed.promise;
}

export async function withSelectedRoom(state, action) {
    const slot = slotFor(state);
    const grant = await currentGrant(state, slot);
    return grant.use(action);
}

export async function selectRoom(state, requested) {
    const slot = slotFor(state);
    if (slot.closed) throw closedError();
    for (const old of slot.pending) old.controller.abort();
    const token = { controller: new AbortController(), opening: null, grant: null };
    slot.latest = token;
    slot.pending.add(token);
    const assertCurrent = () => {
        if (slot.closed) throw closedError();
        if (slot.latest !== token) {
            throw roomError("ROOM_SELECTION_SUPERSEDED", "Room selection was superseded by a newer request");
        }
    };
    try {
        let grant;
        if (requested) {
            token.opening = openGrant(slot, requested, token.controller.signal);
            token.grant = await token.opening;
            grant = token.grant;
        } else {
            grant = await currentGrant(state, slot);
        }
        const room = await grant.use((reader) => readRoom(reader));
        assertCurrent();
        if (token.grant) {
            const previous = slot.current;
            slot.current = token.grant;
            token.grant = null;
            if (previous) previous.retire();
            if (slot.seed && !slot.seed.adopted) slot.seed.controller.abort();
        }
        state.roomPath = room.root;
        return room;
    } catch (error) {
        assertCurrent();
        throw error;
    } finally {
        slot.pending.delete(token);
        if (slot.latest === token) slot.latest = null;
        if (token.grant) await token.grant.retire();
    }
}

export function disposeRoomState(state) {
    const slot = slotFor(state);
    if (slot.disposal) return slot.disposal;
    slot.closed = true;
    slot.latest = null;
    const openings = [];
    for (const token of slot.pending) {
        token.controller.abort();
        if (token.opening) openings.push(token.opening);
    }
    if (slot.seed) {
        slot.seed.controller.abort();
        openings.push(slot.seed.promise);
    }
    slot.disposal = (async () => {
        // An opening either registers its grant or completes its own failed-start cleanup.
        await Promise.allSettled(openings);
        const results = await Promise.allSettled([...slot.grants].map((grant) => grant.forceClose()));
        slot.current = null;
        const errors = [...slot.errors, ...results.filter((result) => result.status === "rejected").map((result) => result.reason)];
        if (errors.length) throw new AggregateError([...new Set(errors)], "Native room disposal failed");
    })();
    return slot.disposal;
}
