/**
 * Wrapper around localStorage and sessionStorage that prefixes key names 
 * to avoid collisions and emits events when the storage is changed even
 * from another tab or window.
 * 
 * The get method returns undefined instead of null if a key does not exist
 * or the value is not a valid JSON string.
 * 
 * Values are converted to/from JSON before writing/reading them to/from storage. 
 * A string in ISO 9601 format (`YYYY-MM-DDThh:mm:ss(.sss)Z`) is automatically 
 * converted back to a Date object when retrieving it from storage. This conversion
 * also happens if the string occurs as property of an object.
 */

//#region import/export
export {
    IsolatedStorage, init, 
    modName, prefixDelimiter, getStorageInstances, lengthInStorage, addListener, removeListener,
    StorageEvent0 as StorageEvent, StorageEventItemChanged, StorageEventItemDeleted,
}

import { EventEmitter, Events } from "../basic/events.js"
import { ReactiveSyncWritableValue } from "../basic/reactive.js"
import { DefaultLogger } from "../basic/logger.js"
import { toJson, fromJson, splitAt, AnyButUndefined } from "../basic/misc.js"
import { Guard } from "./guard.js"
//#endregion

//#region types
type StorageType = "local" | "session"
type Instances<T = IsolatedStorage> = Record<StorageType, Record<string, T>>

type InstancesWithEmitter = Instances<{
    storage: IsolatedStorage,
    emitter: (ev: StorageEvent0) => void
}>
//#endregion

//#region events

//the 0-suffix is used to not shadow StorageEvent from Web Storage API
type StorageEvent0 = StorageEventItemChanged | StorageEventItemDeleted

type StorageEventItemChanged = {
    type: "itemChanged",
    data: StorageEventItemGenericData & {
        oldValue: any,
        newValue: any
    }
}

type StorageEventItemDeleted = {
    type: "itemDeleted",
    data: StorageEventItemGenericData & {
        oldValue: any
    }
}

type StorageEventItemGenericData = {
    storageType: StorageType,
    prefix: string,
    key: string,
    local: boolean
}
//#endregion

const modName = "storage"
const prefixDelimiter = "." //may not occur in prefix
const instances: InstancesWithEmitter = { local: {}, session: {} }
const lg = new DefaultLogger(modName)

const events = new Events<StorageEvent0>()
const addListener = events.export().addListener
const removeListener = events.export().removeListener

//#region functions
function init() {
    //translate StorageEvent to StorageEvent0 and emit
    window.addEventListener("storage", (ev: StorageEvent) => {
        try {
            const ev0 = toNativeEvent(ev)
            if (ev0 == null) return
            instances[ev0.data.storageType][ev0.data.prefix].emitter(ev0)
        } catch (e) {
            //fromJson failed
            lg.error("Failed to convert DOM StorageEvent %O: %O", ev, e)
        }
    })
}

function toNativeEvent(ev: StorageEvent): StorageEvent0 | null {
    if (ev.storageArea == null || ev.key == null) return null

    const storageType: StorageType = ev.storageArea == localStorage ? "local" : "session"
    const { left: prefix, right: key, found: found } = splitAt(ev.key, prefixDelimiter)
    if (!found) return null //key does not contain prefixDelimiter
    if (!(instances[storageType]).hasOwnProperty(prefix)) return null //no instance exists

    const gd: StorageEventItemGenericData = {
        storageType: storageType,
        prefix: prefix,
        key: key,
        local: false
    }

    if (ev.newValue == null) {
        if (ev.oldValue == null) return null //non-existing value has been deleted (impossible)
        return {
            type: "itemDeleted",
            data: {
                ...gd,
                oldValue: fromJson(ev.oldValue)
            }
        }
    } else {
        return {
            type: "itemChanged",
            data: {
                ...gd,
                newValue: fromJson(ev.newValue),
                oldValue: ev.oldValue == null ? undefined : fromJson(ev.oldValue)
            }
        }
    }
}

function getStorageInstances(): Instances {
    const res: Instances = { local: {}, session: {} }
    for (const type of ["local", "session"] as const) {
        for (const prefix in instances[type]) {
            res[type][prefix] = instances[type][prefix].storage
        }
    }
    return res
}

function lengthInStorage(storageType: StorageType) {
    let res = 0
    for (const is of Object.values(instances[storageType])) {
        res += is.storage.lengthInStorage()
    }
    return res
}
//#endregion

class IsolatedStorage<Key extends string = string> implements EventEmitter<StorageEvent0> {
    readonly storageType: StorageType
    readonly prefix: string
    readonly #storage: Storage

    readonly #events: Events<StorageEvent0>
    readonly addListener
    readonly removeListener

    constructor(storageType: StorageType, prefix: string) {
        if (prefix.includes(prefixDelimiter)) {
            lg.impossible("prefix %s may not contain prefix delimiter %s", toJson(prefix), toJson(prefixDelimiter))
            throw new Error(`prefix ${toJson(prefix)} may not contain prefix delimiter ${toJson(prefixDelimiter)}`)
        }

        if (Object.hasOwn(instances[storageType], prefix)) {
            lg.impossible("IsolatedStorage with prefix %s already exists in %sStorage", toJson(prefix), storageType)
            throw new Error(`IsolatedStorage with prefix ${toJson(prefix)} already exists in ${storageType}Storage`)
        }

        try {
            instances[storageType][prefix] = {
                storage: this as IsolatedStorage,
                emitter: this.#emitEvent.bind(this)
            }

            this.storageType = storageType
            this.prefix = prefix
            this.#storage = storageType == "local" ? window.localStorage : window.sessionStorage

            this.#events = new Events()
            this.addListener = this.#events.export().addListener
            this.removeListener = this.#events.export().removeListener
        } catch (e) {
            lg.impossible("Failed to construct IsolatedStorage. Did you try to do it in a webworker? Error: %O", e)
            throw e
        }
    }

    has(key: Key): boolean {
        return this.#storage.getItem(this.#path(key as string)) !== null
    }

    /**
     * @returns undefined if key does not exist in storage
     */
    get<T extends Key>(key: T): undefined | unknown {
        const str = this.#storage.getItem(this.#path(key as string))
        if (str === null) return undefined
        try {
            return fromJson(str)
        } catch (e) {
            lg.warn(`Failed to parse %s from %sStorage: %O`, this.#path(key as string), this.storageType, e)
            return undefined
        }
    }

    /**
     * @returns true iff value changed and was updated in storage
     */
    set<T extends Key>(key: T, value: any) {
        return this.#set(key, value)
    }

    /**
     * @returns true iff `key` exists in storage and was deleted
     */
    delete(key: Key) {
        return this.#delete(key)
    }

    /**
     * Convenience method to append a value to an array in storage.
     * If the value in storage is not an array then it is set to `[value]`.
     */
    append<T extends Key>(key: T, value: any) {
        let arr = this.get(key)
        if (Array.isArray(arr)) {
            arr.push(value)
        } else {
            arr = [value]
        }
        return this.set(key, arr)
    }

    /**
     * May return values that are not in `Key` but for which an item
     * in storage exists. Therefore they must be casted to `Key` before
     * being used to access or modify this storage.
     * 
     * @returns all keys defined in this IsolatedStorage
     */
    keys(): string[] {
        const res = []
        const p = this.prefix + prefixDelimiter
        for (let i = 0; i < this.#storage.length; i++) {
            if (this.#storage.key(i)!.startsWith(p))
                res.push(this.#storage.key(i)!.slice(p.length))
        }
        return res
    }

    lengthInStorage() {
        return this.keys().map((key) => this.#storage.getItem(this.#path(key as string))).join().length
    }

    /**
     * Returns `key` as a guarded reactive value. If the value in the
     * storage does not pass the guard then the default value is returned.
     * 
     * @param defaultValue returned when key does not exist in storage or it 
     * contains an invalid value
     */
    reactive<S extends AnyButUndefined>(key: Key, defaultValue: S, guard: Guard<S>): ReactiveSyncWritableValue<S> {
        const get = () => {
            const val = this.get(key)
            if (val === undefined) return defaultValue
            const rv = { value: null }
            const isValid = guard(val, rv)
            if (!isValid)
                lg.warn("Item %s in %sStorage is invalid: %O", this.#path(key), this.storageType, rv.value)
            return !isValid ? defaultValue : val
        }

        return {
            get: get,
            set: (x: S) => this.set(key, x),
            onChange: (f: (nv: any) => void) =>
                [{
                    listenerId: this.addListener.bind(this)(ev => {
                        if (ev.data.key == key) f(get())
                    }),
                    removeListener: this.removeListener.bind(this)
                }]
        }
    }

    //#region private

    /**
     * @returns true if value for key changed and was set in storage
     */
    #set(key: Key, value: any) {
        const valueStr = toJson(value)
        if (valueStr === this.#storage.getItem(this.#path(key))) return false

        const oldValue = this.get(key)
        this.#storage.setItem(this.#path(key), valueStr)
        this.#emitEvent({
            type: "itemChanged",
            data: {
                ...this.#genericEventData(key),
                oldValue: oldValue,
                newValue: value
            }
        })
        return true
    }

    #delete(key: Key) {
        if (this.#storage.getItem(this.#path(key)) === null) return false
        const oldValue = this.get(key)
        this.#storage.removeItem(this.#path(key))
        this.#emitEvent({
            type: "itemDeleted",
            data: {
                ...this.#genericEventData(key),
                oldValue: oldValue,
            }
        })
        return true
    }

    #path(key: string) {
        return this.prefix + prefixDelimiter + key
    }

    #genericEventData(key: string): StorageEventItemGenericData {
        return {
            storageType: this.storageType,
            prefix: this.prefix,
            key: key,
            local: true
        }
    }

    #emitEvent(ev: StorageEvent0) {
        this.#events.emitEvent(ev)
        events.emitEvent(ev)
    }
    //#endregion
}

/**
 * Dev note:
 * 
 * localStorage.setItem() is not synchronous in the following sense.
 * Suppose in tab A setItem() is called and then tab A sends a message
 * over a broadcast channel. After tab B receives this message and
 * calls getItem() it might still get the old value despite the fact
 * that setItem() already finished in tab A before tab A sent the
 * message.
 *
 * It seems that browsers (FF & Chrome) use a memory cache for the
 * storage to make it look like the operation is synchronous within a
 * browsing context.
 *
 * To prevent this race condition this module listens to the built-in
 * storage events (StorageEvent), translates them to native ones
 * (StorageEvent0) and emits them instead of using the global events
 * mechanism from events.ts.
 */