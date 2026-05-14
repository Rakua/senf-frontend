//#region import/export
export {
    LoggerEvent, LoggerEventDebug, LoggerEventLog, LoggerEventInfo, LoggerEventWarn, LoggerEventError, LoggerEventSecurity, LoggerEventImpossible, LogLevel, MutedDataSources,
    Logger, DefaultLogger, MutedData, consoleLogger, logLevel, addListener, removeListener
}

import { Events } from "./events.js"
import { nonUniqueValue, toJson } from "./misc.js"
//#endregion

//#region events
type LoggerEvent = LoggerEventDebug | LoggerEventLog | LoggerEventInfo | LoggerEventWarn | LoggerEventError | LoggerEventSecurity | LoggerEventImpossible | LoggerEventTest

type LoggerEventDebug = { type: "debug", data: LogEventData }
type LoggerEventLog = { type: "log", data: LogEventData }
type LoggerEventInfo = { type: "info", data: LogEventData }
type LoggerEventWarn = { type: "warn", data: LogEventData }
type LoggerEventError = { type: "error", data: LogEventData }
type LoggerEventSecurity = { type: "security", data: LogEventData }
type LoggerEventImpossible = { type: "impossible", data: LogEventData }
type LoggerEventTest = { type: "test", data: LogEventData }

type LogEventData = { msg: string, args: any[], source: string, muted: boolean }
//#endregion

//#region types
interface Logger {
    debug: (msg: string, ...args: any[]) => void,
    log: (msg: string, ...args: any[]) => void,
    info: (msg: string, ...args: any[]) => void,
    warn: (msg: string, ...args: any[]) => void,
    error: (msg: string, ...args: any[]) => void,
    security: (msg: string, ...args: any[]) => void,
    impossible: (msg: string, ...args: any[]) => void,
    test: (test: boolean, testCaseMsg: string, ...args: any[]) => void
}

type Source = string
type Muted = {
    invertMute: boolean, //true => muted means unmuted and vice versa
    mutedLevels: Set<LogLevel>,
    mutedSources: MutedSources
}

//primitive representation of Muted without Map and Set
type MutedData = {
    invertMute?: boolean,
    mutedLevels?: LogLevel[],
    mutedSources?: MutedDataSources
}

type MutedSources = Map<Source, Set<LogLevel>>
type MutedDataSources<S extends Source = Source> = (S | [S, LogLevel[]])[]
type LogLevel = LoggerEvent['type']
//#endregion

const events = new Events<LoggerEvent>()
const addListener = events.export().addListener
const removeListener = events.export().removeListener

const muted: Muted = {
    invertMute: false,
    mutedLevels: new Set(),
    mutedSources: new Map()
}
const allLevels: Set<LoggerEvent['type']> =
    new Set(["debug", "log", "info", "warn", "error", "security", "impossible", "test"])

/**
 * Wrapper around console that emits events for all logging calls and with
 * mute functionality across all instances via static methods.
 */
class DefaultLogger implements Logger {
    static sourceDelimiter = ":"
    static sourceWildcard = "*"

    readonly source: string

    /**
     * @param source name of the module where the logger is used
     */
    constructor(source: string) {
        this.source = source
    }

    #generic(consoleFunc: (...data: any[]) => void, type: LoggerEvent['type'], msg: string, ...args: any[]) {
        const isMuted = DefaultLogger.isMuted(this.source, type)
        const evData = { type: type, data: { msg: msg, args: args, source: this.source, muted: isMuted } }
        if (!isMuted) consoleFunc(`[${DefaultLogger.toCode(type)}][${this.source}] ${msg}`, ...args)
        events.emitEvent(evData) //events are also emitted for muted messages
    }

    //#region output methods
    debug(msg: string, ...args: any[]) {
        this.#generic(console.debug, "debug", msg, ...args)
    }

    log(msg: string, ...args: any[]) {
        this.#generic(console.log, "log", msg, ...args)
    }

    /**
     * Messages that are of interest to the user
     */
    info(msg: string, ...args: any[]) {
        this.#generic(console.info, "info", msg, ...args)
    }

    warn(msg: string, ...args: any[]) {
        this.#generic(console.warn, "warn", msg, ...args)
    }

    error(msg: string, ...args: any[]) {
        this.#generic(console.error, "error", msg, ...args)
    }

    /**
     * Indicates a breach of security, e.g. a compromised key
     */
    security(msg: string, ...args: any[]) {
        this.#generic(console.error, "security", msg, ...args)
    }

    /**
     * Indicates a programming error, e.g. a violated assertion
     */
    impossible(msg: string, ...args: any[]) {
        this.#generic(console.error, "impossible", msg, ...args)
    }

    test(test: boolean, testCaseMsg: string, ...args: any[]) {
        const c = test ? console.info : console.error
        args.push(test)
        this.#generic(c, "test", testCaseMsg + " (%O)", ...args)
    }
    //#endregion

    //#region mute

    /**
     * Inverts the meaning of mute and unmute. Can be used to have
     * everything muted by default and unmute selectively.
     * 
     * @param invert if undefined, the current state will be toggled
     */
    static invertMute(invert?: boolean) {
        muted.invertMute = invert ?? !muted.invertMute
        return this
    }

    /**
     * @param level if undefined, all messages from the given source will 
     * be muted
     */
    static mute(source: Source, level?: LogLevel) {
        const newMuteSet = level == undefined ? allLevels : new Set([level])
        const existingMuteSet = muted.mutedSources.get(source) ?? new Set()
        muted.mutedSources.set(source, existingMuteSet.union(newMuteSet))
        return this
    }

    /**
     * @param level if undefined, all messages from the given source will 
     * be unmuted
     */
    static unmute(source: Source, level?: LogLevel) {
        const unmuteSet = level == undefined ? allLevels : new Set([level])
        const existingMuteSet = muted.mutedSources.get(source) ?? new Set()
        muted.mutedSources.set(source, existingMuteSet.difference(unmuteSet))
        return this
    }

    static muteLevel(level: LogLevel) {
        muted.mutedLevels.add(level)
        return this
    }

    static unmuteLevel(level: LogLevel) {
        muted.mutedLevels.delete(level)
        return this
    }


    static isMuted(source: string, level: LogLevel) {
        //XOR isMuted with invertMute 
        return this.#isMuted(source, level) != muted.invertMute
    }

    static #isMuted(source: string, level: LogLevel) {
        const src = muted.mutedSources.get(source)
        //level is muted or source is muted for given level
        if (muted.mutedLevels.has(level) || (src != undefined && src.has(level)))
            return true

        //check for wildcard mutes, e.g. `"cidb:*"` mutes `"cidb:worker:1"`
        const parts = source.split(DefaultLogger.sourceDelimiter)
        while (parts.length > 1) {
            parts.pop()
            const source = parts.join(DefaultLogger.sourceDelimiter)
            const src = muted.mutedSources.get(source + DefaultLogger.sourceDelimiter + DefaultLogger.sourceWildcard)
            if (src != undefined && src.has(level)) return true
        }
        return false
    }

    static setMuted(data: MutedData) {
        if (data.invertMute != undefined) muted.invertMute = data.invertMute
        if (data.mutedLevels != undefined) muted.mutedLevels = new Set(data.mutedLevels)
        if (data.mutedSources != undefined) {
            const sources = data.mutedSources!.map(x => typeof x == "string" ? x : x[0])
            const nuv = nonUniqueValue(sources)
            if (nuv != undefined) throw new Error("log source " + toJson(nuv) + " occurs more than once in muted data")

            muted.mutedSources = DefaultLogger.#fromMutedDataSources(data.mutedSources)
        }
    }

    static getMuted(): MutedData {
        const m: MutedData = {
            invertMute: muted.invertMute,
            mutedLevels: Array.from(muted.mutedLevels),
            mutedSources: DefaultLogger.#toMutedDataSources(muted.mutedSources)
        }
        return m
    }
    //#endregion

    //#region etc
    static toCode(type: LoggerEvent['type']) {
        switch (type) {
            case "debug": return "DBG"
            case "log": return "LOG"
            case "info": return "INF"
            case "warn": return "WRN"
            case "error": return "ERR"
            case "security": return "SEC"
            case "impossible": return "IMP"
            case "test": return "TST"
        }
    }

    static #toMutedDataSources(x: MutedSources): MutedDataSources {
        return Array.from(x).map(([src, types]) =>
            //if a source is muted for all types, only return its name
            types.size == allLevels.size ? src : [src, Array.from(types)])
    }

    static #fromMutedDataSources(x: MutedDataSources): MutedSources {
        const y = x.map(val => (typeof val == "string" ?
            [val, allLevels] : [val[0], new Set(val[1])]) as [Source, Set<LogLevel>]
        )
        return new Map(y)
    }
    //#endregion
}

/**
 * Returns a simple logger that only prints to console
 */
function consoleLogger(source: string): Logger {
    return {
        debug: (msg: string, ...args: any[]) => console.debug("[DBG][%s] " + msg, source, ...args),
        log: (msg: string, ...args: any[]) => console.log("[LOG][%s] " + msg, source, ...args),
        info: (msg: string, ...args: any[]) => console.info("[INF][%s] " + msg, source, ...args),
        warn: (msg: string, ...args: any[]) => console.warn("[WRN][%s] " + msg, source, ...args),
        error: (msg: string, ...args: any[]) => console.error("[ERR][%s] " + msg, source, ...args),
        security: (msg: string, ...args: any[]) => console.error("[SEC][%s] " + msg, source, ...args),
        impossible: (msg: string, ...args: any[]) => console.error("[IMP][%s] " + msg, source, ...args),
        test: (test: boolean, msg: string, ...args: any[]) => {
            const c = test ? console.info : console.error
            c("[TST][%s] %s (%O)", source, msg, ...args, test)
        }
    }
}

function logLevel(type: LoggerEvent['type']) {
    switch (type) {
        case "debug": return -2
        case "test": return -1
        case "log": return 0
        case "info": return 1
        case "warn": return 2
        case "error": return 3
        case "security": return 4
        case "impossible": return 5
    }
}