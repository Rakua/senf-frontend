export {
    Events, EventHandler, EventEmitter, EmittedEvent,
    EventsConfig, EventsConfigLocal, EventsConfigGlobal,
    ListenerId, RemovableListenerId, AddListenerSignature
}

//#region types
type Listener = {
    listenerId: ListenerId,
    listensTo: Event['type'][] | AllEvents,
    handler: EventHandler<Event>
}
type AllEvents = undefined

type ListenerId = string
type RemovableListenerId = { listenerId: ListenerId, removeListener: (lid: ListenerId) => boolean }
type ListenerStore = Record<ListenerId, Listener>

type Event = {
    type: string,
    data: any
}

/**
 * This data is automatically added to the event by the emitter and can be used in
 * event handlers.
 * 
 * The property `local` is false if the event was received over the broadcast channel.
 * This means the event was emitted from another browsing context, e.g. another tab or
 * a web worker.
 */
type EventMetadata = {
    time: Date,
    local: boolean
}
type EmittedEvent = Event & EventMetadata

type EventAsMessage = {
    emitterId: string,
    event: Event & Omit<EventMetadata, 'local'> //local must be set to true
}

type EventHandler<EventUnion> = (ev: EventUnion & EventMetadata) => void | Promise<void>

/**
 * Interface for classes that emit events
 */
type EventEmitter<EventUnion extends Event> = {
    addListener: AddListenerSignature<EventUnion>,
    removeListener: (listenerId: ListenerId) => void
}

/**
 * Subset of EventUnion that has T as type
 */
type EventUnionSubset<EventUnion extends Event, T extends EventUnion['type'][] | undefined> =
    T extends EventUnion['type'][] ? Extract<EventUnion, { type: T[number] }> : EventUnion

/**
 * Narrows the type of the event parameter `ev` in the handler function based 
 * on the type names in `listentsTo`
 */
type AddListenerSignature<EventUnion extends Event> =
    <T extends EventUnion['type'][] | undefined>
        (handler: EventHandler<EventUnionSubset<EventUnion, T>>, listensTo?: T) => ListenerId

type EventsConfig<EventUnion extends Event> = EventsConfigLocal | EventsConfigGlobal<EventUnion>
type EventsConfigLocal = { scope: "local" }

/**
 * The `reviver` property can be used to convert plain objects in the 
 * event data back to class instances after they have been received 
 * over the broadcast channel
 */
type EventsConfigGlobal<EventUnion extends Event> = {
    scope: "global",
    emitterId: string,
    reviver?: (ev: EventUnion) => EventUnion
}
//#endregion

//used to emit events across tabs/browsing contexts
const broadcastChannel = new BroadcastChannel("sf.events")

/**
 * An event system to emit events and add and remove listeners. Events 
 * can be emitted across tabs via the `config` parameter in the
 * constructor.
 */
class Events<EventUnion extends Event> {
    readonly #store: ListenerStore = {}

    /**
     * The emitter id used by this instance. If it is undefined
     * then events are emitted locally only.
     */
    readonly emitterId: undefined | string

    /**
     * To emit events across tabs, set `config` to `{scope: "global", emitterId: "$ID"}`
     * where `$ID` is an identifier used to determine if an event was emitted by the
     * coressponding instance in another tab. For example, if the instance of `Events` 
     * is module-wide then the module name is a suitable emitter ID.
     * 
     * If `config` is undefined then events are only emitted locally.
     */
    constructor(config?: EventsConfig<EventUnion>) {
        config ??= { scope: "local" }

        if (config.scope == "global") {
            this.emitterId = config.emitterId
            this.#listenToBroadcast(config.reviver)
        }
    }

    addListener<T extends EventUnion['type'][] | undefined>(handler: EventHandler<EventUnionSubset<EventUnion, T>>, listensTo?: T): ListenerId {
        const listener: Listener = {
            listenerId: crypto.randomUUID(),
            listensTo: listensTo as string[] | undefined,
            handler: handler as EventHandler<Event>
        }
        this.#store[listener.listenerId] = listener
        return listener.listenerId
    }

    /**
     * @returns true iff `listenerId` exists
     */
    removeListener(listenerId: ListenerId): boolean {
        const res = Object.hasOwn(this.#store, listenerId)
        delete this.#store[listenerId]
        return res
    }

    emitEvent(event: EventUnion) {
        const ev: EmittedEvent = {
            type: event.type,
            data: event.data,
            time: new Date(),
            local: true
        }

        this.#callListeners(ev)

        if (this.emitterId) {
            //send event over broadcast channel
            const evMsg: EventAsMessage = {
                emitterId: this.emitterId,
                event: ev
            }
            broadcastChannel.postMessage(evMsg)
        }
    }

    #callListeners(event: EmittedEvent) {
        for (const listenerId in this.#store) {
            const l = this.#store[listenerId]

            if (!(l.listensTo === undefined || l.listensTo.includes(event.type)))
                continue //l does not listen to this event

            //use async IIFE to uniformly catch handler exceptions for promises
            //and non-promises without delaying the calls to subsequent listeners
            (async () => {
                try {
                    await l.handler(event)
                } catch (e) {
                    console.error("call to listener %O failed for event %O because %O", l, event, e)
                }
            })()
        }
    }

    #listenToBroadcast(reviver: ((ev: EventUnion) => EventUnion) | undefined) {
        /**
         * Only return the modified data after applying the reviver
         * since the other fields should not be affected by the reviver
         */
        const reviveData = reviver == undefined
            ? ((x: EventUnion) => x.data)
            : ((x: EventUnion) => reviver(x).data)

        broadcastChannel.addEventListener("message", (msgEv: MessageEvent<EventAsMessage>) => {
            if (msgEv.data.emitterId !== this.emitterId) return //ignore messages from other emitter ids
            const ev0 = msgEv.data.event
            const ev: EmittedEvent = {
                ...ev0,
                data: reviveData(ev0 as unknown as EventUnion),
                local: false
            }
            this.#callListeners(ev)
        })
    }

    /**
     * Export this instead of the instance itself to prevent non-internal modules 
     * from emitting events
     */
    export() {
        return {
            addListener: this.addListener.bind(this),
            removeListener: this.removeListener.bind(this),
        } as const
    }
}

//#region usage example & test
// function example() {
//     type MyEv = MyEvA | MyEvB
//     type MyEvA = { type: "MyEvA", data: { x: number } }
//     type MyEvB = { type: "MyEvB", data: { y: string, z?: number } }
//     const events = new Events<MyEv>()
//     events.addListener((ev) => { console.log(ev.data) }, ["MyEvA"])
//     const exp = events.export()

//     const lid = exp.addListener((ev) => { console.log(ev.type) })
//     events.emitEvent({ type: "MyEvA", data: { x: 123 } })
//     events.emitEvent({ type: "MyEvB", data: { y: "asd" } })
//     exp.removeListener(lid)
//     events.emitEvent({ type: "MyEvA", data: { x: 678 } })
// }

// function test() {
//     type MyEv = MyEvA | MyEvB
//     type MyEvA = { type: "MyEvA", data: number }
//     type MyEvB = { type: "MyEvB", data: string }
//     const events = new Events<MyEv>({
//         scope: "global", emitterId: "MyEv", reviver: (ev) => {
//             if (ev.type == "MyEvA") return ev
//             ev.data = ev.data.toUpperCase()
//             return ev
//         }
//     })
//     const emitA = (x: number) => events.emitEvent({ type: "MyEvA", data: x })
//     const emitB = (x: string) => events.emitEvent({ type: "MyEvB", data: x })
    
//     events.addListener((ev) => console.info("MyEv: %O", ev))
//     const errLid = events.addListener(async (ev) => {
//         setTimeout(() => {
//             //test async rejects
//             if (ev.data.length < 2) throw new Error("len < 2")
//         }, 2000)
//     }, ["MyEvB"])
//     events.addListener(async (ev) => {
//         console.info("got an event b: %O", ev)
//     }, ["MyEvB"])

//     const removeErrListener = () => events.removeListener(errLid)

//     emitA(1)
//     emitB("asd")
//     emitB("a") //should throw an Error

//     removeErrListener()
//     emitB("x") //should not throw an Error anymore

//     return { emitA, emitB, removeErrListener }
// }
//#endregion
