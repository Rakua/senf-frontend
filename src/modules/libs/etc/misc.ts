export {
    DeviceType,
    utf8ByteLength, lineIterator, iteratorReturnValue, binarySearch, guessDevice, normalizeUri,
    approxDuration, formatDuration, durationInUnits, approxByteSize,
    abbreviateUri, abbreviateMiddle, splitInHalf,
    dateInFilename,
    getInputDate, setInputDate, tristateCheckbox,
    isCiUrn, isHttpUrl,
    showEl, hideEl, showChildEl, setSelectValue, hasScrollbar, alwaysShowScrollbar, inElementsBoundingBox,
    anchorToPlainTextDownload, anchorToBlobDownload,
    serializeCatch, mediaTypeFromUrl,

}

import { round, splitAt, toJson, toNumber } from "../basic/misc.js"

enum DeviceType { Desktop = "d", Mobile = "m" }

//#region dom 

/**
 * Returns the selected date of the input element w.r.t. the user's 
 * local time zone or null if none was selected.
 * 
 * Use for `input[type='date']` elements.
 */
function getInputDate(el: HTMLInputElement) {
    const parts = el.value.split("-")
    if (parts.length != 3) return null
    const year = Number(parts[0])
    const month = Number(parts[1])
    const days = Number(parts[2])
    const d = new Date(year, month - 1, days)
    return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Sets the date of the input element to the given date w.r.t. the user's
 * local time zone. Inverse of `getInputDate`.
 * 
 * Use for `input[type='date']` elements.
 */
function setInputDate(el: HTMLInputElement, date: Date | null) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        el.value = ""
        return
    }
    const year = (date.getFullYear()).toString().padStart(2, "0")
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")
    el.value = `${year}-${month}-${day}`
}


function anchorToPlainTextDownload(aEl: HTMLAnchorElement, filename: string, data: string) {
    aEl.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(data))
    aEl.setAttribute("download", filename)
}

/**
 * @returns a function that should be called when the object URL can be released
 */
function anchorToBlobDownload(aEl: HTMLAnchorElement, filename: string, data: Blob) {
    const url = URL.createObjectURL(data)
    aEl.href = url
    aEl.download = filename
    return () => URL.revokeObjectURL(url)
}

/**
 * Sets the value of the <select> element to value. If the value does not exist
 * as option a new option with this value is added.
 * @param label if omitted `label` defaults to `value`
 * @param before if null or omitted the option is added as last element
 */
function setSelectValue(selEl: HTMLSelectElement, value: string, label?: string, before?: HTMLElement | number | null) {
    label ??= value

    for (let i = 0; i < selEl.options.length; i++) {
        if (selEl.options[i].value === value) {
            selEl.selectedIndex = i
            return
        }
    }

    //add new option
    const opt1 = new Option(label, value, false, true)
    selEl.options.add(opt1, before)
}



/**
 * The indeterminate property of the parent checkbox is true iff neither all child checkboxes
 * are checked nor unchecked. Otherwise it is . Moreover, an change event on the parent checkbox
 * causes all its children to be checked or unchecked.
 * 
 * The parent checkbox will also listen to `"refresh"` events that can be sent when the selection
 * of its child checkboxes has been changes programmatically.
 * 
 * When child checkboxes change their checked value due to the parent checkbox being clicked,
 * each of them will dispatch a `"change"` event.
 * 
 * @param parentCheckbox 
 * @param childCheckboxes 
 * @param childCheckboxesContainer an HTML element that should contain all child checkboxes. The
 * change listener is attached to it
 */
function tristateCheckbox(parentCheckbox: HTMLInputElement, childCheckboxes: HTMLInputElement[], childCheckboxesContainer: HTMLElement) {
    type Tristate = true | false | null
    const setState = (state: Tristate) => {
        if (state === null) {
            parentCheckbox.indeterminate = true
            parentCheckbox.checked = false
        } else {
            parentCheckbox.indeterminate = false
            parentCheckbox.checked = state
            childCheckboxes.forEach(el => {
                el.checked = state
                el.dispatchEvent(new Event("change"))
            })
        }
    }
    const getState: () => Tristate = () => {
        const checkedCount = childCheckboxes.filter(x => x.checked).length
        return checkedCount == childCheckboxes.length
            ? true : (checkedCount == 0 ? false : null)
    }

    childCheckboxesContainer.addEventListener("change", (ev) => {
        const child = childCheckboxes.find(el => el == ev.target)
        if (child == undefined) return
        setState(getState())
    })

    parentCheckbox.addEventListener("refresh", () => setState(getState()))
    parentCheckbox.addEventListener("change", () => setState(parentCheckbox.checked))
}


/**
 * Checks if (x,y) is in the bounding box of el. x and y must be relative
 * to the viewport
 */
function inElementsBoundingBox(el: HTMLElement, x: number, y: number) {
    const r = el.getBoundingClientRect()
    return r.left <= x && x <= r.right && r.top <= y && y <= r.bottom
}


function showEl(x: Element) {
    x.classList.remove("display-none")
}

function hideEl(x: Element) {
    x.classList.add("display-none")
}

/**
 * Shows only the child element within the parent.
 * The child can be specified via its index.
 */
function showChildEl(parent: Element, child: Element | number) {
    Array.from(parent.children).forEach(el => hideEl(el))
    if (typeof child == "number") child = parent.children[child]
    showEl(child)
}

function hasScrollbar() {
    return document.documentElement.scrollHeight > document.documentElement.clientHeight
}

function alwaysShowScrollbar(enable: boolean) {
    if (enable) {
        document.documentElement.style.overflowY = "scroll"
        document.documentElement.style.scrollbarGutter = "stable"
    } else {
        document.documentElement.style.overflowY = ""
        document.documentElement.style.scrollbarGutter = ""
    }
}

//#endregion

//#region etc


function mediaTypeFromUrl(url: URL): null | "image" | "video" | "audio" {
    const extensions = {
        image: ["jpg", "jpeg", "gif", "png", "svg", "webp", "avif", "apng"],
        video: ["webm", "mp4", "ogg", "ogv"],
        audio: ["mp3", "wav", "ogg", "aac", "flac"]
    } as const

    if (!["http", "https"].includes(url.protocol.slice(0, -1))) return null

    for (const type0 in extensions) {
        const type = type0 as keyof typeof extensions
        if (extensions[type].some(ext => url.href.toLowerCase().endsWith("." + ext)))
            return type
    }

    return null
}

function serializeCatch(e: any) {
    return e instanceof Error ? e.message : toJson(e)
}

function isHttpUrl(x: string) {
    try {
        const y = new URL(x)
        return ["http", "https"].includes(y.protocol.slice(0, -1))
    } catch (e) {
        return false
    }
}

type LineIteratorOptions = {
    fatal?: boolean,
    maxLineLength?: number,
    lineSeparator?: string
}

/**
 * Process a utf-8 byte stream line by line.
 * 
 * Note, the `maxLineLength` option only works properly for values larger 
 * than the chunk size of the reader.
 * 
 * @param options if the property `fatal` is set to true, throws a `TypeError` 
 * when trying to decode bytes which are not valid UTF-8 data
 * @throws `MaxLineLengthExceededError` if a line is longer than `
 * options.maxLineLength` (provided the option is set)
 * 
 * 
 * @example
 * const response = await fetch("https://example.com/lines.txt")
 * const reader = response.body!.getReader()
 * for await (const { line: line, isLast: isLast} of lineIterator(reader)) {
 *     console.log("Line: " + line)
 * }
 */
async function* lineIterator(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>, options?: LineIteratorOptions) {
    const fatal = options?.fatal ?? true
    const lineSeparator = options?.lineSeparator ?? "\n"
    const maxLineLen = options?.maxLineLength ?? Number.POSITIVE_INFINITY
    if (lineSeparator.length == 0) throw new TypeError("lineSeparator cannot be the empty string")

    const utf8Decoder = new TextDecoder("utf-8", { fatal: fatal })

    let data = await reader.read()
    let cur = ""
    while (!data.done) {
        cur += utf8Decoder.decode(data.value)

        const lines = cur.split(lineSeparator)
        for (let i = 0; i < lines.length - 1; i++) {
            yield { line: lines[i], isLast: false }
        }
        cur = lines[lines.length - 1] //last line might not be complete yet
        if (cur.length > maxLineLen) throw new MaxLineLengthExceededError(cur.length, maxLineLen)
        data = await reader.read()
    }
    yield { line: cur, isLast: true } //last line in stream

    //data.done = true implies data.value is undefined
    //see https://streams.spec.whatwg.org/#dom-readablestreamreadresult-done
    //(after line "{ value, done } = await reader.read()")    
}

async function iteratorReturnValue<RV>(it: AsyncGenerator<any, RV, any>) {
    let r
    while (!(r = await it.next()).done) { }
    return r.value
}

function utf8ByteLength(str: string) {
    return new TextEncoder().encode(str).length
}

function isCiUrn(x: string, domain: string) {
    const re = new RegExp(`^ci:[1-9][0-9]*@[a-z0-9]+${("." + domain).replaceAll(".", "\\.")}$`)
    return x.match(re) !== null
}

/**
 * Returns the largest index `k` of `sortedList` such that `key` <= `sortedList[k]`.
 * If key is larger than all values in the list, null is returned. 
 */
function binarySearch(key: number, sortedList: number[]): number | null {
    const len = sortedList.length
    if (len == 0 || key > sortedList[len - 1]) return null

    //index must be in [low, high]
    let low = 0
    let high = len - 1
    const mid = () => low + Math.floor((high - low) / 2)
    while (true) {
        if (low == high) return low
        const i = mid()

        if (key > sortedList[i]) {
            //key must be in [i+1,high]
            low = i + 1
        } else {
            //key mus t be in [low,i]
            if (i == 0 || key > sortedList[i - 1]) return i
            high = i
        }
    }
}

function guessDevice(): DeviceType {
    const hasTouch = navigator.maxTouchPoints > 0
    const screenWidth = window.devicePixelRatio * screen.width
    const screenHeight = window.devicePixelRatio * screen.height
    const smallerScreenSide = Math.min(screenWidth, screenHeight) //independent of phone orientation

    const treatAsMobile = smallerScreenSide < 768 || (hasTouch && window.devicePixelRatio > 2)

    return treatAsMobile ? DeviceType.Mobile : DeviceType.Desktop
}

/**
 * Trims uri and converts case-insensitive parts to lower case.
 * Throws MalformedUriError if the URI is illegal.
 */
function normalizeUri(uri: string) {
    uri = uri.trim()

    const url = new URL(uri)
    const scheme = url.protocol.slice(0, -1)
    const rest = url
    switch (scheme) {
        case "http":
        case "https":
            return url.href

        case "ci": {
            const rest = url.pathname
            const parts = rest.split("@")
            if (parts.length != 2)
                throw new MalformedUriError(uri, "ci should contain exactly one @")

            const no = toNumber(parts[0])
            if (no === null)
                throw new MalformedUriError(uri, "ci part before @ must be a number")

            if (Math.round(no) !== no)
                throw new MalformedUriError(uri, "ci part before @ must be an integer")

            if (no < 0)
                throw new MalformedUriError(uri, "ci part before @ must be non-negative")

            return scheme + ":" + rest.toLowerCase()
        }
        case "keyid": {
            const rest = url.pathname
            if (rest.length != 43)
                throw new MalformedUriError(uri, "keyid must be 43 characters long, got " + rest.length)

            const rp = /^([a-z]|[A-Z]|[0-9]|-|_)+$/g //base64 url-safe characters
            if (!rp.test(rest))
                throw new MalformedUriError(uri, "keyid may only consist of a-Z, 0-9, - and _")

            return url.href
        }
        case "tag": {
            //valid tag chars (a-z0-9.-)?
            return url.href
        }
        case "":
            throw new MalformedUriError(uri, "scheme missing")
        default:
            return url.href
    }
}

/**
 * @param maxLen max length of the part that comes after the scheme and colon
 */
function abbreviateUri(uri: string, maxLen: number, options?: AbbreviateMiddleOptions) {
    const x = splitAt(uri, ":")
    if (!x.found) throw new Error("URI does not contain ':' (" + JSON.stringify(uri) + ")")
    return x.left.toLowerCase() + ":" + abbreviateMiddle(x.right, maxLen, options)
}

type AbbreviateMiddleOptions = { ellipsis?: string, leftShort?: boolean }
/**
 * If `x` is longer than `maxLen` then the middle part of x is 
 * replaced with `ellipsis` such that the returned string has 
 * length at most `maxLen`. Otherwise, it just returns `x`. 
 * 
 * If `maxLen` is 1 then `x[0]` or `x[x.length-1]` is returned.
 * 
 * @param ellipsis defaults to `"…"`; should be exactly one character long
 * @throws error if `maxLen` is less than 1
 */
function abbreviateMiddle(x: string, maxLen: number, options?: AbbreviateMiddleOptions) {
    const round = (down: boolean) => down ? Math.floor : Math.ceil
    const ellipsis = options?.ellipsis ?? "…"
    const leftShort = options?.leftShort ?? false

    if (maxLen < 1) throw new Error("maxLen should be at least 1, got " + maxLen)
    if (x.length <= maxLen) return x
    if (maxLen == 1) return leftShort ? x[x.length] : x[0]

    const x1 = splitInHalf(x, leftShort)

    const partLen = (maxLen - 1) / 2 //the -1 accounts for the ellipsis
    const rLen = round(!leftShort)(partLen)
    const x2 = {
        left: x1.left.slice(0, round(leftShort)(partLen)),
        right: rLen == 0 ? "" : x1.right.slice(-1 * rLen)
    }

    return x2.left + ellipsis + x2.right
}

/**
 * Splits a string or an array in the middle and returns both parts.
 * If `x` has odd length than the right part will be shorter by
 * default unless `leftShort` is set to true.
 */
function splitInHalf(x: string | any[], leftShort?: boolean) {
    leftShort ??= false
    const f = leftShort ? "floor" : "ceil"
    const mid = Math[f](x.length / 2)
    return { left: x.slice(0, mid), right: x.slice(mid) }
}
//#endregion

/**
 * Use to include a date in a filename (local time zone is used).
 * @returns `"2000-12-24_15-44-57"`
 */
function dateInFilename(date?: Date) {
    const f = (x: number, l?: number) => x.toString().padStart(l ?? 2, "0")

    date ??= new Date()

    const p = {
        y: date.getFullYear(),
        M: f(date.getMonth() + 1),
        d: f(date.getDate()),
        h: f(date.getHours()),
        m: f(date.getMinutes()),
        s: f(date.getSeconds()),
    }
    return `${p.y}-${p.M}-${p.d}_${p.h}-${p.m}-${p.s}`
}


//#region duration

function unitConversion(value: number, units: Record<string, number>, minUnit: string, prec?: number): ({ value: number, unit: string }) {
    prec ??= 1
    for (const unit in units) {
        if (value >= units[unit]) {
            return {
                value: round(value / units[unit], 1),
                unit: unit
            }

        }
    }
    return {
        value: value,
        unit: minUnit
    }
}

function approxByteSize(byteSize: number) {
    const units: { [unit: string]: number } = {
        "PiB": 1099511627776,
        "GiB": 1073741824,
        "MiB": 1048576,
        "KiB": 1024
    } as const
    const x = unitConversion(byteSize, units, "B")
    return `${x.value}${x.unit}`
}

const timeUnits: { [unit: string]: number } = {
    "yr": 525600,
    "mth": 43800,
    "wk": 10080,
    "d": 1440,
    "h": 60
} as const

function approxDuration(durationInMin: number) {
    const x = unitConversion(durationInMin, timeUnits, "min")
    return `${x.value}${x.unit}`
}

function durationInUnits(durationInMin: number): { val: number, unit: string }[] {
    let res = []
    for (const unit in timeUnits) {
        if (durationInMin >= timeUnits[unit]) {
            const val = Math.floor(durationInMin / timeUnits[unit])
            durationInMin %= timeUnits[unit]
            res.push({ val: val, unit: unit })
        } else {
            res.push({ val: 0, unit: unit })
        }
    }
    res.push({ val: durationInMin, unit: "min" })
    return res
}

function formatDuration(durationInMin: number) {
    const u = durationInUnits(durationInMin).filter(x => x.val > 0)
    return u.map(x => String(x.val) + x.unit).join(" ")
}
//#endregion

//#region errors
class MalformedUriError extends Error {
    readonly uri: string
    readonly reason: string

    constructor(uri: string, reason: string) {
        super(`Malformed URI (${reason}): ${uri}`)
        this.name = 'MalformedUriError'
        this.uri = uri
        this.reason = reason
    }
}

class MaxLineLengthExceededError extends Error {
    readonly lineLength: number
    readonly maxLineLength: number

    constructor(lineLength: number, maxLineLength: number) {
        super(`Maximum line length exceeded (${lineLength} > ${maxLineLength})`)
        this.name = 'MaxLineLengthExceededError'
        this.lineLength = lineLength
        this.maxLineLength = maxLineLength
    }
}
//#endregion
