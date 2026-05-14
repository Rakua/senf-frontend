export { verifyAllStats, verifyLocationStats, verifyPosterStats }

import { distinctArray, toJson } from "../../../libs/basic/misc.js"
import { CiType } from "../cidb.js"
import { lg } from "../config.js"
import { normalizeLocation } from "../misc.js"
import { EntityModel } from "../types/entity.js"
import { Query, QueryIndex } from "../types/query.js"
import { PropertyContext } from "./entity.js"
import { fromKeysGen, queryWithoutProgressGen } from "./query.js"
import { db } from "./schema/db.js"
import { CiStats, LocationRecord, PosterRecord, Stats } from "./schema/v1.js"

type ErrEntry<T = number | Date | undefined> = { stat: string, precomputed: T, computed___: T }
type StatsType = StatsTypeLocation | StatsTypePoster
type StatsTypeLocation = Omit<LocationRecord, 'location' | 'scheme' | 'parent' | 'poster'>
type StatsTypePoster = Omit<PosterRecord, 'keyId' | 'alias' | 'publicKey'>

async function verifyAllStats(type: "location" | "poster", context: PropertyContext) {
    const selector = {
        location: {
            table: db.t_location,
            verify: verifyLocationStats
        },
        poster: {
            table: db.t_poster,
            verify: verifyPosterStats
        }
    }
    const keys = await selector[type].table.toCollection().primaryKeys()
    const errs = []
    for (const key of keys) {
        const res = await selector[type].verify(key, context)
        if (res.length > 0) {
            errs.push({ [type]: key, errs: res })
        }
    }
    return errs
}

async function verifyLocationStats(location: string, context: PropertyContext) {
    location = normalizeLocation(location)
    const queryWithoutProgress = queryWithoutProgressGen(context)
    const fromKeys = fromKeysGen(context)

    const locRec = await db.t_location.get(location)
    if (locRec == undefined) throw new Error("location " + location + " does not exist in t_location")

    //const waitingTime = await getLocationWaitingTime(location)
    const index: QueryIndex<"ciMetadata"> = {
        type: "string",
        name: "location",
        values: {
            type: "set",
            literals: [location]
        }
    }

    //get all posts for given loc
    const pks = await queryWithoutProgress({ entity: "ciMetadata", index: index })
    const cis = await fromKeys("ciMetadata", pks)    
    const posts = cis.filter(ciMd => ciMd.ciType() == CiType.Post)
    const echos = cis.filter(ciMd => ciMd.ciType() == CiType.Echo)

    const cisInDb = cis.filter(x => x.ciInDb())
    const postsInDb = posts.filter(x => x.ciInDb())
    const echosInDb = echos.filter(x => x.ciInDb())

    const catIds = distinctArray(cisInDb.flatMap(x => x.catIds()))
    
    const sma = sumMaxAvg(echos.map(x => x.waitingTime()))
    const stats: StatsTypeLocation = {
        echoSum: sma.sum,
        echoMax: sma.max,
        echoAvg: sma.avg,

        //add CI's waiting time to echo values
        // totalEchoSum: sma.sum + waitingTime,
        // totalEchoMax: Math.max(sma.max, waitingTime),
        // totalEchoAvg: waitingTime > 0 ? ((sma.sum + waitingTime) / (echos.length + 1)) : sma.avg,        

        catIds: catIds,

        global: {
            ciCount: cis.length,
            postCount: posts.length,
            echoCount: echos.length,
            ...dates(posts, echos)
        },

        loaded: {
            ciCount: cisInDb.length,
            postCount: postsInDb.length,
            echoCount: echosInDb.length,
            ...dates(postsInDb, echosInDb)
        }
    } as const

    return computeMismatches(locRec, stats)
}

async function verifyPosterStats(keyId: string, context: PropertyContext) {
    const queryWithoutProgress = queryWithoutProgressGen(context)
    const fromKeys = fromKeysGen(context)

    const posterRec = await db.t_poster.get(keyId)
    if (posterRec == undefined) throw new Error("poster " + keyId + " does not exist in t_poster")

    const index = {
        type: "string",
        name: "poster",
        values: {
            type: "set",
            literals: [keyId]
        }
    } as Query<"ciMetadata">["index"] & Query<"location">["index"]

    const ciKeys = await queryWithoutProgress<"ciMetadata">({ entity: "ciMetadata", index: index })
    const locKeys = await queryWithoutProgress<"location">({ entity: "location", index: index })

    const cis = await fromKeys("ciMetadata", ciKeys)
    const posts = cis.filter(ciMd => ciMd.ciType() == CiType.Post)
    const echos = cis.filter(ciMd => ciMd.ciType() == CiType.Echo)

    const cisInDb = cis.filter(x => x.ciInDb())
    const postsInDb = posts.filter(x => x.ciInDb())
    const echosInDb = echos.filter(x => x.ciInDb())

    const locations = await fromKeys("location", locKeys)

    const waitingTimes = posts.map(x => x.waitingTime()).concat(echos.map(x => x.waitingTime()))
    const wtSma = sumMaxAvg(waitingTimes)

    const receivedEchoCount = locations.map(x => x.echoCount()).reduce(add)
    const echoSum = locations.map(x => x.echoSum()).reduce(add)
    const echoMax = locations.map(x => x.echoMax()).reduce(extreme("max"), 0) as number
    const echoAvg = receivedEchoCount == 0 ? 0 : echoSum / receivedEchoCount

    const totalSum = wtSma.sum + echoSum
    const totalEchoCount = receivedEchoCount + waitingTimes.length
    
    const catIds = distinctArray(cisInDb.flatMap(x => x.catIds()))

    const stats: Omit<PosterRecord, 'keyId' | 'alias' | 'publicKey'> = {
        waitingTimeSum: wtSma.sum,
        waitingTimeMax: wtSma.max,
        waitingTimeAvg: wtSma.avg,

        //over echo stats of locations that are CIs by keyId
        echoSum: echoSum,
        echoMax: echoMax,
        echoAvg: echoAvg,

        totalEchoSum: totalSum,
        totalEchoMax: Math.max(wtSma.max, echoMax),
        totalEchoAvg: totalEchoCount == 0 ? 0 : totalSum / totalEchoCount,

        receivedEchoCount: receivedEchoCount,

        catIds: catIds,

        global: {
            ciCount: cis.length,
            postCount: posts.length,
            echoCount: echos.length,
            ...dates(posts, echos)
        },

        loaded: {
            ciCount: cisInDb.length,
            postCount: postsInDb.length,
            echoCount: echosInDb.length,
            ...dates(postsInDb, echosInDb)
        }
    }

    return computeMismatches(posterRec, stats)
}

function computeMismatches(rec: LocationRecord, stats: StatsTypeLocation): ErrEntry[]
function computeMismatches(rec: PosterRecord, stats: StatsTypePoster): ErrEntry[]
function computeMismatches(rec: LocationRecord | PosterRecord, stats: StatsType): ErrEntry[] {
    type ErrEntry<T> = { stat: string, precomputed: T, computed___: T }

    const errs: (ErrEntry<number | Date | undefined>)[] = []

    const f0 = (statName: string, precomputed: number | Date | undefined, computed: number | Date | undefined) => {
        let eq = (x: any, y: any) => x === y
        if (precomputed instanceof Date || computed instanceof Date) {
            eq = (x: Date | undefined, y: Date | undefined) =>
                (x === undefined && y === undefined) ||
                (x !== undefined && y !== undefined && x.getTime() == y.getTime())
        } else if (isFloat(precomputed) || isFloat(computed)) {
            eq = floatEq
        } else if (Array.isArray(precomputed) && Array.isArray(computed)) {
            //for catIds
            eq = (x, y) => {
                x.sort()
                y.sort()
                if (x.length != y.length) return false
                for (let i = 0; i < x.length; i++) {
                    if (x[i] != y[i]) return false
                }
                return true
            }
        }

        if (!eq(precomputed, computed)) {
            errs.push({ stat: statName, precomputed: precomputed, computed___: computed })
        }
    }

    for (const statName0 in stats) {
        const statName = statName0 as keyof Stats
        if (statName == "global" || statName == "loaded") {
            for (const subStatName0 in stats[statName]) {
                const subStatName = subStatName0 as keyof CiStats
                const precomputed = rec[statName][subStatName]
                const computed = stats[statName][subStatName]
                f0(statName + "." + subStatName, precomputed, computed)
            }
            continue
        }

        const precomputed = rec[statName]
        const computed = stats[statName]
        f0(statName, precomputed, computed)
    }

    return errs
}

function sumMaxAvg(data: number[]) {
    const sum = data.reduce(add, 0)
    return {
        sum: sum,
        max: data.reduce(extreme("max"), 0) as number,
        avg: data.length == 0 ? 0 : sum / data.length
    }
}

function dates(posts: EntityModel<"ciMetadata">[], echos: EntityModel<"ciMetadata">[]) {
    const firstPost = posts.map(x => x.postedOn()).reduce(extreme("min"), undefined)
    const firstEcho = echos.map(x => x.postedOn()).reduce(extreme("min"), undefined)
    const lastPost = posts.map(x => x.postedOn()).reduce(extreme("max"), undefined)
    const lastEcho = echos.map(x => x.postedOn()).reduce(extreme("max"), undefined)

    const res = {
        firstCi: extreme("min")(firstPost, firstEcho) as Date | undefined,
        lastCi: extreme("max")(lastPost, lastEcho) as Date | undefined,
        firstPost: firstPost as Date | undefined,
        lastPost: lastPost as Date | undefined,
        firstEcho: firstEcho as Date | undefined,
        lastEcho: lastEcho as Date | undefined
    }

    return res
}

function extreme(mode: "max" | "min") {
    return (x: number | Date | undefined, y: number | Date | undefined) => {
        if (typeof x == "number" && typeof y == "number")
            return Math[mode](x, y)

        if ((typeof x == "number") != (typeof y == "number"))
            throw new Error("x,y must be both numbers or neither of them; got x= " + toJson(x) + ", y=" + toJson(y) + "")

        const xd = x as Date | undefined
        const yd = y as Date | undefined
        const arr = [xd, yd].filter(x => x != undefined).map(x => x.getTime())
        return arr.length == 0 ? undefined : new Date(Math[mode](...arr))
    }
}

function add(x: number, y: number) {
    return x + y
}

function floatEq(x: number, y: number) {
    return Math.abs(x - y) < 0.01
}

function isFloat(x: any) {
    if (typeof x != "number") return false
    return x % 1 > 0
}