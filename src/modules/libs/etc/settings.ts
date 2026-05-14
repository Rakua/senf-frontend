//#region import/export
export {
    Setting, ReadOnlySetting, NewSetting,
    SettingEvent, SettingEventChanged, SettingEventDefaultChanged, SettingEventInvalidValue,
    SectionDoesNotExistError,
    modName, newSettings, getSettings,
    exportSettings, importSettings, resetSettings,
    addListener, removeListener,
}

import { EventEmitter, EventHandler, ListenerId, Events } from "../basic/events.js"
import { DefaultLogger } from "../basic/logger.js"
import { AnyButUndefined } from "../basic/misc.js"
import { ReactiveSyncWritableValue, ReactiveValue } from "../basic/reactive.js"
import { IsolatedStorage, prefixDelimiter as delimiter } from "./storage.js"
import { Guard, guard as guard0, TypeDescribesItself } from "./guard.js"
//#endregion

//#region types
type SettingValue = AnyButUndefined
type SectionName = string
type SettingName = string
type ReadOnlySetting<T extends SettingValue> = {
    section: string,
    name: string,
    description: string,
    guard: Guard<T>,
    get: () => T,
    getDefault: () => T,
    isDefault: () => boolean,
    addListener: (handler: EventHandler<SettingEvent<T>>, listensTo?: SettingEvent<T>['type'][] | undefined) => ListenerId
}

type ValidatedValue<T extends SettingValue> = ValidatedValueValid<T> | ValidatedValueInvalid
type ValidatedValueValid<T extends SettingValue> = { valid: true, value: T | undefined }
type ValidatedValueInvalid = { valid: false, reason: any }

type NewSettings = Record<SettingName, NewSetting<any>>
type NewSetting<T extends AnyButUndefined> = {
    default: T,
    description?: string,
    guard?: Guard<T>,
    repair?: (ev: SettingEventInvalidValue, setting: ReadOnlySetting<T>) => T | undefined
}
type NewSettingsRv<T extends NewSettings> = {
    [k in keyof T]: T[k]["guard"] extends Guard<infer S>
    ? ([S] extends [AnyButUndefined] ? Setting<S> : { err: never, reason: "type of Guard may not contain undefined since setting value cannot be undefined" })
    : Setting<T[k]["default"]>
}

type Unguard<T extends Guard<any>> = T extends Guard<infer S> ? S : never
type NewSettingConstraint<T extends NewSetting<any>> = T["guard"] extends Guard<any>
    ? Unguard<T["guard"]> & T["default"] //guard is set => type of default and guard must be equivalent    
    : TypeDescribesItself<T["default"]> //guard is not set => check that T describes itself

//#endregion

//#region events
type SettingEvent<T extends SettingValue> =
    SettingEventChanged<T> | SettingEventDefaultChanged<T> | SettingEventInvalidValue

type SettingEventChanged<T extends SettingValue> = {
    type: "changed",
    data: SettingEventCommonData & {
        newValue: T | undefined,
        oldValue: ValidatedValue<T>
    }
}

type SettingEventDefaultChanged<T extends SettingValue> = {
    type: "defaultChanged",
    data: SettingEventCommonData & {
        newValue: T,
        oldValue: T
    }
}

type SettingEventInvalidValue = {
    type: "invalidValue",
    data: SettingEventCommonData & {
        value: unknown,
        reason: any
    }
}

type SettingEventCommonData = { section: SectionName, name: SettingName }
//#endregion

const modName = "settings"
const settings: Record<SectionName, Record<SettingName, Setting<any>>> = {}
const lg = new DefaultLogger(modName)
const storage = new IsolatedStorage("local", modName)

const events = new Events<SettingEvent<any>>({ scope: "global", emitterId: modName })
const addListener = events.export().addListener
const removeListener = events.export().removeListener

//#region functions

/** 
 * Constructs an object of settings for a module.
 * 
 * Whenever the `default` value of a setting contains a union or tuple type cast it, e.g.
 * `default: [["qa2",2]] as [string,number][]` and explicilty set the guard parameter.
 * If the `guard` parameter is not provided then `guard(defaultValue)` will be used as default. 
 * 
 * @example
 * const settings = newSettings(modName, {
 *    platformName: { default: "senf.in" },
 *    serverUrl: { default: "https://qa2.senf.in", description: "used to get time" },
 *    minWaitingTime: { default: 60000, guard: guards.positiveInteger },
 *    test: {
 *        default: [["a", 123]] as [string, number][],
 *        guard: guard([tupleType("", 0)])
 *    }
 * })
 */
function newSettings<T extends NewSettings>(section: SectionName,
    settings: T & { [K in keyof T]: NewSetting<NewSettingConstraint<T[K]>> }): NewSettingsRv<T> {
    const res: Record<string, Setting<any>> = {}
    for (const name in settings) {
        const ns = settings[name]
        const desc = ns.description ?? "N/A"
        const guard = ns.guard ?? guard0(ns.default) as Guard<T>
        const s = new Setting(section, name, desc, ns.default, guard)
        const repair = ns.repair
        if (repair) {
            s.addListener((ev) => {
                const r = repair(ev, s.readOnly())
                if (r !== undefined) s.set(r)
            }, ["invalidValue"])
        }
        res[name] = s
    }

    return res as NewSettingsRv<T>
}

function getSettings() {
    const res: Record<SectionName, Record<SettingName, Setting<SettingValue>>> = {}
    for (const section in settings) {
        res[section] = { ...settings[section] }
    }
    return res
}

/**
 * @param section if not provided, all sections are reset
 */
function resetSettings(section?: SectionName) {
    if (section === undefined) {
        for (section in settings) {
            resetSettings(section)
        }
        return
    }

    if (!settings.hasOwnProperty(section)) throw new SectionDoesNotExistError(section)
    for (const name in settings[section]) {
        settings[section][name].unset()
    }
}

function exportSettings() {
    const res: Record<SectionName, Record<SettingName, any>> = {}
    for (const section in settings) {
        res[section] = {}
        let nonEmpty = false
        for (const name in settings[section]) {
            const setting = settings[section][name]
            if (setting.isDefault()) continue
            res[section][name] = setting.get()
            nonEmpty = true
        }
        //remove section where all settings are the default
        if (!nonEmpty) delete res[section]
    }
    return res
}

function importSettings(exportedSettings: ReturnType<typeof exportSettings>, overwrite: boolean) {
    type ResEntry = (ChangedSetting | UnchangedSetting | SkippedSetting | InvalidValue) & {
        section: SectionName,
        setting: SettingName
    }
    type ChangedSetting = { type: "changed" }
    type UnchangedSetting = { type: "unchanged" }
    type SkippedSetting = { type: "skipped" }
    type InvalidValue = { type: "invalid", reason: any }

    const res: ResEntry[] = []
    for (const section in settings) {
        for (const name in settings[section]) {
            if (exportedSettings.hasOwnProperty(section) && exportedSettings[section].hasOwnProperty(name)) {
                const setting = settings[section][name]
                const s = { section: section, setting: name }
                if (setting.isDefault() || overwrite) {
                    const newVal = exportedSettings[section][name]
                    const ss = setting.setSafely(newVal)
                    if (ss.valid) {
                        res.push({ ...s, type: ss.set ? "changed" : "unchanged" })
                    } else {
                        res.push({ ...s, type: "invalid", reason: ss.reason })
                    }
                } else {
                    res.push({ ...s, type: "skipped" })
                }
            }
        }
    }
    return res
}

//#endregion

class Setting<T extends SettingValue> implements EventEmitter<SettingEvent<T>>, ReactiveValue<T> {
    readonly section: SectionName
    readonly name: SettingName
    readonly description: string
    readonly guard: Guard<T>
    #defaultValue: T

    readonly #events: Events<SettingEvent<T>>
    readonly addListener
    readonly removeListener

    constructor(section: string, name: string, description: string, defaultValue: T, guard: Guard<T>) {
        this.section = section
        this.name = name
        this.description = description
        this.guard = guard
        this.#defaultValue = defaultValue

        this.#events = new Events<SettingEvent<T>>({
            scope: "global",
            emitterId: `${modName}:${this.section}:${this.name}`
        })
        this.addListener = this.#events.export().addListener
        this.removeListener = this.#events.export().removeListener

        //store this Setting instance in global variable
        if (settings[section] == undefined) settings[section] = {}
        if (settings[section].hasOwnProperty(name))
            throw new Error(`Setting ${this.name} in section ${this.section} already exists`)
        settings[section][this.name] = this

        //update default value if it was set in another tab
        this.addListener((ev) => {
            if (!ev.local) this.#setDefault(ev.data.newValue, true)
        }, ["defaultChanged"])
    }

    isDefault() {
        const x = this.#get()
        return !x.valid || x.value === undefined
    }

    get(): T {
        const x = this.#get()
        return !x.valid || x.value === undefined ? this.#defaultValue : x.value
    }

    getDefault(): T {
        return this.#defaultValue
    }

    /**     
     * @returns true iff `value` differs from current setting or setting is set to default
     * @throws `PersistError` (e.g. if storage is full)
     */
    set(value: T) {
        return this.#set(value)
    }

    /**
     * In addition to `set` this method applies the setting's `guard` to check whether the 
     * provided value is valid.
     * 
     * @throws `PersistError` (e.g. if storage is full)
     */
    setSafely(value: any): { valid: true, set: boolean } | { valid: false, reason: any } {
        const rv = { value: null }
        return this.guard(value, rv)
            ? { valid: true, set: this.set(value) }
            : { valid: false, reason: rv.value }
    }

    /**
     * @returns true iff setting was not already set to default
     * @throws `PersistError` if deleting entry from local storage failed
     */
    unset() {
        return this.#set(undefined)
    }

    setDefault(value: T) {
        this.#setDefault(value, false)
    }

    onChange(f: (nv: T) => void) {
        return [{
            listenerId: this.addListener(ev => f(this.get()), ["changed", "defaultChanged"]),
            removeListener: this.removeListener.bind(this)
        }]
    }

    /**
     * Setting this reactive value to undefined is equivalent to calling `unset`
     */
    reactiveRw(): ReactiveSyncWritableValue<T | undefined> {
        const get = () => {
            const x = this.#get()
            return !x.valid || x.value === undefined ? undefined : x.value
        }
        return {
            get: get,
            set: this.#set.bind(this),
            onChange: (f: (nv: any) => void) =>
                [{
                    listenerId: this.addListener.bind(this)(ev => { f(get()) }),
                    removeListener: this.removeListener.bind(this)
                }]
        }
    }

    readOnly(): ReadOnlySetting<T> {
        return {
            section: this.section,
            name: this.name,
            description: this.description,
            guard: this.guard,
            get: this.get.bind(this),
            getDefault: this.getDefault.bind(this),
            isDefault: this.isDefault.bind(this),
            addListener: this.addListener.bind(this)
        }
    }

    //#region internal
    #storageKey() {
        return this.section + delimiter + this.name
    }

    #get(silent?: boolean): ValidatedValue<T> {
        silent ??= false

        const val = storage.get(this.#storageKey())
        if (val === undefined) return { valid: true, value: undefined }
        const rv = { value: null }
        if (this.guard(val, rv)) return { valid: true, value: val }

        if (!silent) {
            lg.warn("Invalid setting %s in section %s with value %O: %O", this.name, this.section, val, rv.value)
            this.#emitEvent({
                type: "invalidValue",
                data: {
                    section: this.section,
                    name: this.name,
                    value: val,
                    reason: rv.value
                }
            })
        }
        return { valid: false, reason: rv.value }
    }

    #set(value: T | undefined) {
        try {
            const oldVal = this.#get(true)
            const changed = value === undefined
                ? storage.delete(this.#storageKey())
                : storage.set(this.#storageKey(), value)

            if (!changed) return false
            this.#emitEvent({
                type: "changed",
                data: {
                    section: this.section,
                    name: this.name,
                    newValue: value,
                    oldValue: oldVal
                }
            })
            return true
        } catch (e) {
            throw new PersistError(this.section, this.name, value, e)
        }
    }

    #setDefault(value: T, external: boolean) {
        const oldVal = this.#defaultValue
        this.#defaultValue = value
        if (external) return //do not emit event for external set
        this.#emitEvent({
            type: "defaultChanged",
            data: {
                section: this.section,
                name: this.name,
                newValue: value,
                oldValue: oldVal
            }
        })
    }

    #emitEvent(event: SettingEvent<T>) {
        this.#events.emitEvent(event)
        events.emitEvent(event)
    }
    //#endregion
}

class SectionDoesNotExistError extends Error {
    section: SectionName

    constructor(section: SectionName) {
        super(`section ${section} does not exist`)
        this.name = "SectionDoesNotExistError"
        this.section = section
    }
}

class PersistError<T extends SettingValue> extends Error {
    readonly section: SectionName
    readonly settingName: SettingName
    readonly value?: T //undefined => unsetting
    readonly error: any

    constructor(section: SectionName, name: SettingName, value: T | undefined, e: any) {
        const action = value === undefined ? `reset` : `persist ${value} for`
        super(`Failed to ${action} setting ${name} in section ${section}: ${e}`)
        this.name = "PersistError"
        this.section = section
        this.settingName = name
        this.value = value
        this.error = e
    }
}