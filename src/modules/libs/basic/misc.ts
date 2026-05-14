export {
    AnyButUndefined, MakeOptional, Unarray, StrictUnarray, Unpromise, StrictUnpromise,
    FirstArgType, PartialRecord, FuncSig, IntersectTuple, UnionToIntersection, NestedOmit,
    toJson, fromJson, fromJsonTotal,
    dateReviver, castIsoStringToDate, toIsoStringWoMs,
    isNumber, isInteger, toNumber, round, randomInt,
    escapeHtml, splitAt, capitalize, nodeFromString, nodesFromString,
    sleep, deadline, deadlineThrow, throwToReturn, retry, applyIf, ExposedPromise,
    arrayToMap, distinctArray, hasDuplicates, nonUniqueValue
}

//#region type related
type AnyButUndefined = {} | null
type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
type Unpromise<T> = T extends Promise<infer J> ? J : T
type Unarray<T> = T extends (infer J)[] ? J : T
type StrictUnarray<T> = T extends (infer S)[] ? S : never
type StrictUnpromise<T> = T extends Promise<infer J> ? J : never
type FirstArgType<T> = T extends (x: infer A, ...a: any[]) => any ? A : never

type PartialRecord<T> = T extends Record<infer X, infer Y>
    ? Record<X, Y> & Record<string, Y | undefined>
    : never

type FuncSig = (...args: any[]) => any

//https://stackoverflow.com/questions/50374908/transform-union-type-to-intersection-type
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends
    (k: infer I) => void ? I : never
type IntersectTuple<T extends readonly unknown[]> = UnionToIntersection<T[number]>

//https://stackoverflow.com/a/78575949
type NestedOmit<Schema, Path extends string> = Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof Schema
    ? {
        [K in keyof Schema]: K extends Head
        ? NestedOmit<Schema[K], Tail>
        : Schema[K];
    }
    : Schema
    : Omit<Schema, Path>;


// https://www.typescriptlang.org/docs/handbook/utility-types.html
// Pick, Omit, Exclude, ReturnyType<typeof funcName>
//#endregion

const isoDateRegex = /^[\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}:[\d]{2}:[\d]{2}.[\d]{3}Z$/

//#region JSON wrappers
/**
 * Wrapper around `JSON.stringify` with a replacer that
 * truncates the ms part of Dates if it is 0 and serializes
 * Error objects to plain objects containing their name and
 * message.
 */
function toJson(x: any) {    
    //why does JSON.stringify pass the stringified Date to replacer instead of the actual Date..
    //why is new Date("test 1") a valid date..

    const dateCast = (x: any): Date | null => {        
        if (x instanceof Date) return x
        if (typeof x == "string" && isoDateRegex.exec(x) != null) {
            const d = new Date(x)
            return Number.isNaN(d.getTime()) ? null : d
        }
        return null
    }

    const replacer = (_key: string, val: any) => {
        

        if (val instanceof Error) {
            return {
                type: "Error",
                name: x.name,
                message: x.message
            }
        }

        const d = dateCast(val)
        if (d !== null) {
            return d.getMilliseconds() == 0
                ? toIsoStringWoMs(d) : d.toISOString()
        }

        return val
    }
    return JSON.stringify(x, replacer)
}

/**
 * Wrapper around `JSON.parse` that uses a reviver for ISO 8601
 * date strings, e.g. strings of the form `YYYY-MM-DDThh:mm:ssZ`
 * and `YYY-MM-DDThh:mm:ss.xxxZ` are converted to Date objects.
 */
function fromJson<T = any>(x: string): T {
    return JSON.parse(x, dateReviver)
}

function fromJsonTotal<T = any>(x: string) {
    return throwToReturn<[string], T, SyntaxError>(fromJson)(x)
}
//#endregion

//#region date related
/**
 * Converts a Date object to its ISO 8601 UTC representation without 
 * milliseconds: `YYYY-MM-DDThh:mm:ssZ`
 */
function toIsoStringWoMs(date: Date) {
    return date.toISOString().split(".")[0] + "Z"
}

/**
 * Converts an ISO 8601 date string of the form `YYYY-MM-DDThh:mm:ssZ`
 * or `YYYY-MM-DDThh:mm:ss.xxxZ` to a Date object
 */
function castIsoStringToDate(str: string): Date | null {
    const ts = Date.parse(str)
    const d = new Date(ts)
    return !isNaN(ts) && (toIsoStringWoMs(d) == str || d.toISOString() == str) ? d : null
}

/**
 * Use in `JSON.parse` to revive strings containing ISO 8601 date 
 * strings to Date objects
 */
function dateReviver(_key: string, value: any): any {
    if (typeof value == "string") {
        const d = castIsoStringToDate(value)
        if (d !== null) return d
    }
    return value
}
//#endregion

//#region number related
function isNumber(x: string) {
    return !isNaN(Number(x)) && x.trim() != ""
}

function isInteger(x: string) {
    if (x.trim() == "") return false
    const y = Number(x)
    return !isNaN(y) && y % 1 == 0
}

function toNumber(x: string): number | null {
    return isNumber(x) ? Number(x) : null
}

function round(x: number, digits: number): number {
    if (x < 0) throw new Error("only for non-negative numbers")
    const fac = Math.pow(10, digits)
    return Math.round((x + Number.EPSILON) * fac) / fac
}

/**
 * Random integer between `max` and `min` (inclusive).
 * @param min defaults to `0`
 */
function randomInt(max: number, min?: number) {
    min ??= 0
    return Math.floor(Math.random() * (max - min + 1) + min);
}
//#endregion

//#region string related
function capitalize(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Converts `htmlCode` to a `Node`. The HTML code must contain only
 * a single node at its top level, otherwise an error is thrown. Leading
 * and trailing whitespace is trimmed since they would be seen as additional 
 * text nodes on the root level.
 */
function nodeFromString(htmlCode: string): Node {
    const el = document.createElement("div")
    el.innerHTML = htmlCode.trim()

    if (el.childNodes.length != 1)
        throw new Error("htmlCode does not contain exactly one node at its root level")
    return el.childNodes.item(0)
}

/**
 * Converts `htmlCode` to an array of `Nodes` corresponding to the
 * elements at the root level of the code. 
 * 
 * @example
 * const x = document.createElement("div")
 * x.replaceChildren(...nodesFromString("<b>Name</b>: Bob"))
 */
function nodesFromString(htmlCode: string): Node[] {
    const el = document.createElement("div")
    el.innerHTML = htmlCode
    return Array.from(el.childNodes)
}

function escapeHtml(str: string) {
    const escape = {
        '&': "&amp;",
        '"': "&quot;",
        '\'': "&apos;",
        '<': "&lt;",
        '>': "&gt;"
    }
    return str.replace(/[&"'<>]/g, c => (escape as any)[c])
}

function splitAt(str: string, splitAt: string): { left: string, right: string, found: boolean } {
    if (splitAt.length == 0) throw new Error("splitAt parameter cannot be an empty string")
    const i = str.indexOf(splitAt)
    if (i == -1) return { left: str, right: "", found: false }
    return { left: str.substring(0, i), right: str.substring(i + splitAt.length), found: true }
}
//#endregion

//#region misc
function distinctArray<T>(x: T[]): T[] {
    if (x.length == 0) return []
    switch (typeof x[0]) {
        case "string":
        case "number":
        case "bigint":
        case "boolean":
            return [...new Set(x)]

        case "object":
            return [...new Set(x.map(toJson))].map(fromJson as (x: string) => T)
        default:
            throw new TypeError("cannot compute distinct array for type '" + typeof x[0] + "'")
    }
}

function hasDuplicates<T>(x: T[]): boolean {
    return x.length > distinctArray(x).length
}

function nonUniqueValue<T extends AnyButUndefined>(x: T[]): T | undefined {
    if (x.length < 2) return undefined
    const y = x.map(toJson)

    y.sort()
    for (let i = 1; i < y.length; i++) {
        if (y[i - 1] == y[i]) return fromJson(y[i])
    }
    return undefined
}

function arrayToMap<T, K>(arr: T[], toKey: (x: T) => K): Map<K, T> {
    return new Map<K, T>(arr.map(x => [toKey(x), x]))
}

function applyIf<T>(flag: boolean, f: (x: T) => T) {
    return flag ? f : (x: T) => x
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

type DeadlineRv<T> = { timedOut: true } | { timedOut: false, value: Awaited<T> }
function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<DeadlineRv<T>> {
    const timeout = new Promise<{ timedOut: true }>(
        (resolve) => setTimeout(() => resolve({ timedOut: true }), timeoutMs))

    const x = (async () => ({
        timedOut: false,
        value: await promise
    })) as (() => Promise<{ timedOut: false, value: Awaited<T> }>)

    return Promise.race([x(), timeout])
}

/**
 * Same as `deadline` but throws an error on time out
 */
async function deadlineThrow<T>(promise: Promise<T>, timeoutMs: number, opName: string): Promise<T> {
    const res = await deadline(promise, timeoutMs)
    if (res.timedOut) throw new TimeoutError(opName)
    return res.value
}

/**
 * Returns a new function that calls `f` at most `maxTries` times 
 * until no error is thrown. If an error is thrown, the function 
 * `errCallback` is called with the error and the number of failed 
 * tries so far. Then it waits `waitInterval` ms or if the parameter
 * is a function `waitInterval(i)` ms where `i` is the number of failed 
 * tries.
 */
function retry<Args extends any[], ReturnValue>(
    maxTries: number,
    waitInterval: number | ((tries: number) => number),
    f: (...args: Args) => ReturnValue,
    errCallback?: (e: any, tries: number) => void | Promise<void>) {

    if (maxTries < 1) throw new Error("maxTries must be larger than 1")
    if (typeof waitInterval != "function") {
        const constWaitInterval = waitInterval
        waitInterval = (_i: number) => constWaitInterval
    }

    return async (...args: Args)
        : Promise<{ ok: false, lastError: any } | { ok: true, value: Awaited<ReturnValue> }> => {
        errCallback ??= () => { }

        let lastErr
        for (let i = 1; i <= maxTries; i++) {
            try {
                return { ok: true, value: await f(...args) }
            } catch (e) {
                lastErr = e
                await errCallback(e, i)
                await sleep(waitInterval(i))
            }
        }
        return { ok: false, lastError: lastErr }
    }
}

function throwToReturn<Args extends any[], ReturnValue, ErrorType = unknown>(fn: (...args: Args) => ReturnValue) {
    return ((...args: Args) => {
        try {
            return { ok: true, value: fn(...args) }
        } catch (e) {
            return { ok: false, error: e }
        }
    }) as ((...args: Args) => { ok: true, value: ReturnValue } | { ok: false, error: ErrorType })
}

class ExposedPromise<T> {
    readonly promise: Promise<T>
    #resolve: (value: T | PromiseLike<T>) => void
    #reject: (reason?: any) => void

    constructor() {
        this.#resolve = undefined as unknown as (value: T | PromiseLike<T>) => void
        this.#reject = undefined as unknown as (reason?: any) => void
        this.promise = new Promise((resolve, reject) => {
            this.#resolve = resolve
            this.#reject = reject
        })
    }

    resolve(value: T | PromiseLike<T>) {
        this.#resolve(value)
    }

    reject(reason?: any) {
        this.#reject(reason)
    }
}
//#endregion

class TimeoutError extends Error {
    readonly operationName: string

    constructor(opName: string) {
        super("Operation " + opName + " timed out")
        this.name = 'TimeoutError'
        this.operationName = opName
    }
}