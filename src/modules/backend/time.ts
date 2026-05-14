/**
 * Extrapolates server time from client time and vice versa
 */

export { modName, init, firstUpdateTimeFinished, toServerTime, toClientTime, getTimePair }

import { DefaultLogger } from "../libs/basic/logger.js"
import { newSettings } from "../libs/etc/settings.js"
import { mainSettings } from "../../config.js"
import { guards } from "../libs/etc/guard.js"
import { proxiedFetchJson } from "../libs/etc/fetch.js"

type TimePair = {
    clientTime: Date,
    serverTime: Date
}

const modName = "time"
const lg = new DefaultLogger(modName)

const settings = {
    ...newSettings(modName, {
        fetchTimeout: { default: 3000, guard: guards.positiveInteger },
        updateTimeRetries: { default: 2, guard: guards.positiveInteger },
        updateTimeRetryDelay: { default: 5000, guard: guards.positiveInteger }
    }),
    serverUrl: mainSettings.serverUrl
}

//assume client time equals server time by default
const pair: TimePair = {
    clientTime: new Date(),
    serverTime: new Date()
}


let firstUpdateTimeFinishedResolve: (x: boolean) => void
/**
 * Resolves to true if the first attempt at updating the time pair succeeds and
 * to false if the first attempt fails.
 */
const firstUpdateTimeFinished: Promise<boolean> = new Promise((resolve) => firstUpdateTimeFinishedResolve = resolve)

async function init() {
    const firstAttemptSucceeded = await updateTimePair(settings.updateTimeRetries.get())
    firstUpdateTimeFinishedResolve(firstAttemptSucceeded)
}

function getTimePair(): TimePair {
    return structuredClone(pair)
}

function setTimePair(clientTime: Date, serverTime: Date) {
    pair.clientTime = clientTime
    pair.serverTime = serverTime
}

//extrapolate server time from clientTime
function toServerTime(clientTime: Date) {
    //c0 - s0 = c1 - s1 => s1 = c1 - (c0 - s0)
    const diff = pair.clientTime.getTime() - pair.serverTime.getTime() //c0 - s0
    return new Date(clientTime.getTime() - diff)
}

//extrapolate client time from serverTime
function toClientTime(serverTime: Date) {
    //c0 - s0 = c1 - s1 => c1 = c0 - s0 + s1
    const diff = pair.clientTime.getTime() - pair.serverTime.getTime() //c0 - s0        
    return new Date(serverTime.getTime() + diff)
}

/**
 * Fetches time from server to be able to convert between client and server time.
 * This is relevant if there is a large gap between the two. If the time cannot
 * be obtained from the server, it is assumed that client time equals server time.
 * 
 * It returns true if the first attempt at updating the time pair succeeds and 
 * false if the first attempt fails.
 */
async function updateTimePair(retries: number) {
    try {
        pair.serverTime = await fetchServerTime()
        pair.clientTime = new Date()
        lg.log("client/server time difference: %ss", (pair.clientTime.getTime() - pair.serverTime.getTime()) / 1000)
        return true
    } catch (e) {
        if (retries > 0) {
            lg.error("failed to fetch client/server time pair because %O; retrying", e)
            setTimeout(() => updateTimePair(retries - 1), settings.updateTimeRetryDelay.get())
        } else {
            lg.error("failed to fetch client/server time pair because %O; falling back to assuming client time = server time", e)
        }
        return false
    }
}

async function fetchServerTime() {
    const tsField = "serverTimestamp"

    const resp = await proxiedFetchJson(settings.serverUrl.get(), {
        "method": "GET",
        "signal": AbortSignal.timeout(settings.fetchTimeout.get())
    })
    if (!resp.data.ok) throw new Error("server returned invalid JSON: " + resp.data.error.message)
    const json = resp.data.value
    if (!Object.hasOwn(json, tsField)) throw new Error("field '" + tsField + "' is missing in http response from " + settings.serverUrl.get())

    const ts = new Date(json[tsField])
    if (isNaN(ts.getTime())) throw new Error("field '" + tsField + "' contains invalid time string " + JSON.stringify(json[tsField]))
    return ts
}