export {
    JobReportCriteria,
    initReactiveValues, initLoadedValues, jobReports, jobReportsCount, updateGlobalStats,
    reactiveCounts, ciCountR, postCountR, echoCountR, echoWithStubsCountR, urlCountR, keyIdCountR, globalCiCountR, globalEchoCountR, globalPostCountR
}

import { ReactiveAtom, reactiveExpression, ReactiveSyncWritableValue, ReactiveValue, readOnlyReactiveValue } from "../../libs/basic/reactive.js"
import { liveQuery } from "../../libs/dexie/dexie.js"
import { addListener, queryWithoutProgress } from "./cidb.js"
import { addListener as addListenerWorker } from "./worker/computer.js"
import { chains, lg } from "./config.js"
import { getJobReports } from "./db/jobs.js"
import { getLogCis } from "./db/pci.js"
import { getKeyIdCount, getLocationCount } from "./db/stats.js"
import { getCiCount } from "./db/uci.js"
import { CiType, UserChain } from "./types/ci.js"
import { JobReport, JobStartedBy, JobStatus, JobType, startedByUserR } from "./types/job.js"
import { ExposedPromise } from "../../libs/basic/misc.js"

type JobReportCriteria = {
    statuses?: JobStatus[],
    types?: JobType[],
    startedBy?: JobStartedBy,
    maxAgeMs?: number
}

const liveQueryMaxAgeMs = 259200000 //job reports from last 3 days
const jobReportsRw = new ReactiveAtom<JobReport[]>([])

const ciCountRw = new ReactiveAtom<number>(0)
const postCountRw = new ReactiveAtom<number>(0)
const echoCountRw = new ReactiveAtom<number>(0)
const echoWithStubsCountRw = new ReactiveAtom<number>(0)
const urlCountRw = new ReactiveAtom<number>(0)
const keyIdCountRw = new ReactiveAtom<number>(0)
const globalCiCountRw = new ReactiveAtom<number>(0)
const globalPostCountRw = new ReactiveAtom<number>(0)
const globalEchoCountRw = new ReactiveAtom<number>(0)

//todo: remove R versions
const ciCountR = readOnlyReactiveValue(ciCountRw)
const postCountR = readOnlyReactiveValue(postCountRw)
const echoCountR = readOnlyReactiveValue(echoCountRw)
const echoWithStubsCountR = readOnlyReactiveValue(echoWithStubsCountRw)
const urlCountR = readOnlyReactiveValue(urlCountRw)
const keyIdCountR = readOnlyReactiveValue(keyIdCountRw)
const globalCiCountR = readOnlyReactiveValue(globalCiCountRw)
const globalPostCountR = readOnlyReactiveValue(globalPostCountRw)
const globalEchoCountR = readOnlyReactiveValue(globalEchoCountRw)

const reactiveCounts0 = {
    ciCountR, postCountR, echoCountR, echoWithStubsCountR, urlCountR, keyIdCountR, 
    globalCiCountR, globalPostCountR, globalEchoCountR
}

const reactiveCounts : Record<keyof typeof reactiveCounts0, Promise<ReactiveValue<number>>> = {} as unknown as any

function initLoadedValues() {
    for(const [rName, rVal] of Object.entries(reactiveCounts0)) {
        const name = rName as keyof typeof reactiveCounts
        const ep = new ExposedPromise<typeof rVal>()        
        rVal.onChange(nv => ep.resolve(rVal))
        reactiveCounts[name] = ep.promise
    }
}

/**
 * @returns reactive value with job reports matching the provided criteria
 */
function jobReports(criteria?: JobReportCriteria) {
    criteria ??= {}

    const preds: ((r: JobReport) => boolean)[] = []
    if (criteria.statuses != undefined)
        preds.push((r: JobReport) => criteria.statuses!.includes(r.status))

    if (criteria.types != undefined)
        preds.push((r: JobReport) => criteria.types!.includes(r.subject.type))

    if (criteria.startedBy != undefined && criteria.startedBy != "anyone")
        preds.push((r: JobReport) => startedByUserR(r) == (criteria.startedBy == "user"))

    if (criteria.maxAgeMs != undefined)
        preds.push((r: JobReport) => r.updatedOn >= (new Date(Date.now() - criteria.maxAgeMs!)))

    const and = (x: boolean, y: boolean) => x && y
    const pred = (r: JobReport) => preds.map(p => p(r)).reduce(and, true)
    return reactiveExpression([jobReportsRw], (jr: JobReport[]) => jr.filter(pred))
}

function jobReportsCount(criteria?: JobReportCriteria) {
    return reactiveExpression([jobReports(criteria)], (jr: JobReport[]) => jr.length)
}

function initReactiveValues() {
    // job reports from last 3 days
    liveQuery(() => getJobReports(liveQueryMaxAgeMs)).subscribe({
        next: (reports) => jobReportsRw.set(reports)
    })

    const lq = (type: CiType | undefined, rw: ReactiveSyncWritableValue<number>) => {
        liveQuery(() => getCiCount(type)).subscribe({
            next: (n) => rw.set(n)
        })
    }
    lq(undefined, ciCountRw)
    lq(CiType.Post, postCountRw)
    lq(CiType.Echo, echoCountRw)
    
    echoCountR.onChange((nv) => {
        if(nv > 0 && echoWithStubsCountRw.get() == 0) {
            echoWithStubsCountRw.set(nv)
        }        
    })    

    updateGlobalStats()
    updateLocalStats()
    addListener(updateLocalStats, ["loadedCiFromMainThread", "loadersFinished"])
    addListenerWorker(updateLocalStats, ["finished"])
}

async function updateGlobalStats() {
    lg.debug("updateGlobalStats() start")
    const x = await computeGlobalCiStats()
    lg.debug("updateGlobalStats() finished")
    globalCiCountRw.set(x.ciCount)
    globalPostCountRw.set(x.postCount)
    globalEchoCountRw.set(x.echoCount)
}

async function updateLocalStats() {
    const x = await computeLocalCiStats()
    echoWithStubsCountRw.set(x.echoCount)
    urlCountRw.set(x.urlCount)
    keyIdCountRw.set(x.keyIdCount)
}

//todo: add reactive value for computer worker state via listener

//#region stats
async function computeLocalCiStats() {
    const counts = {
        echo: 0,
        post: 0
    }
    for (const x of ["echo", "post"] as const) {
        counts[x] = (await queryWithoutProgress({
            entity: x,
            index: {
                type: "date",
                name: "postedOn",
                values: {
                    type: "interval",
                    start: new Date(0)
                }
            }
        })).length
    }

    return {
        postCount: counts.post,
        echoCount: counts.echo,
        urlCount: await getLocationCount(["http", "https"]),
        keyIdCount: await getKeyIdCount()
    }
}

async function computeGlobalCiStats() {
    type Stats = {
        ciCount: number,
        postCount: number,
        echoCount: number
    }

    const selCounter = (x: CiType) => x == CiType.Post ? "postCount" : "echoCount"

    const res: Record<UserChain, Stats> = {}
    const total: Stats = { ciCount: 0, postCount: 0, echoCount: 0 }
    for (const chain of chains) {
        res[chain] = { ciCount: 0, postCount: 0, echoCount: 0 }

        for await (const logCis of getLogCis(chain)) {
            for (const ci of logCis) {
                for (const logEntry of ci.data.content) {
                    res[chain].ciCount++
                    res[chain][selCounter(logEntry.type)]++
                }
            }
        }

        total["ciCount"] += res[chain]["ciCount"]
        total["postCount"] += res[chain]["postCount"]
        total["echoCount"] += res[chain]["echoCount"]
    }

    return total
}
//#endregion

