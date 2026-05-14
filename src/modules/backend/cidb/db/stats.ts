export {
    getPosterRecord, getLocationRecord, getUnusedInfos, getUnusedJobs, getUnusedJobsCount, getUnusedInfosUpperBound,
    getLocationsStartingWith, getKeyIdCount, getLocationCount,
    newLoadedCis, newLocations, newPosters, newJobsForCatIds, addPublicKeys, resetStats,
    setLogger
}

import { keyId as computeKeyId } from "../../../libs/etc/sdst.js"
import { ciId, ciMetadata, ciPostTime, ciPrimaryKey, ciSchemeName, ciType, CiType, KeyId, toCiUrn, UserCi, UserCiMetadata } from "../types/ci.js"
import { anonPoster, JobRecord, LocationRecord, posterIsKeyId, PosterRecord, statisticStatus, unknown, UserCiMetadataRecord, UserCiRecord } from "./schema/v1.js"
import { db } from "./schema/db.js"
import { extractScheme, Uri } from "../types/misc.js"
import { distinctArray } from "../../../libs/basic/misc.js"
import { lg as defLg } from "../config.js"
import { Logger } from "../../../libs/basic/logger.js"
import { normalizeLocation } from "../misc.js"

type UnusedInfoType = "location" | "poster" | "loaded"
type GetUnusedInfosRv<Z> = AsyncGenerator<Z[], void, unknown>

let lg: Logger = defLg

/**
 * Use to set an alternative logger
 */
function setLogger(logger: Logger) {
    lg = logger
}

async function getUnusedJobsCount(): Promise<number> {
    return await db.t_job.where("usedInStats").equals(0).count()
}

async function* getUnusedJobs(): AsyncGenerator<JobRecord[], void, unknown> {
    const limit = 1000
    let offset = 0
    while (true) {
        const res = await db.t_job.where("usedInStats").equals(0)
            .offset(offset).limit(limit).toArray()
        if (res.length == 0) return //end of result set reached
        offset += res.length
        yield res
    }
}

/**
 * Returns all records from t_userCi or t_userCiMetaData in batches where
 * `type+"Status"` is verified & unused and the corresponding record in the 
 * other table does not exist or does not have $type+"Status" verified & used.
 */
function getUnusedInfos(type: "loaded"): GetUnusedInfosRv<UserCiRecord>;
function getUnusedInfos(type: "location" | "poster"): GetUnusedInfosRv<UserCiMetadataRecord>;
async function* getUnusedInfos(type: UnusedInfoType) {
    if (type == "loaded") {
        const limit = 1000
        let offset = 0
        while (true) {
            const res = await db.t_userCi.where("loadedStatus")
                .equals(statisticStatus.VerifiedAndUnused)
                .offset(offset).limit(limit).toArray()
            if (res.length == 0) return //end of result set reached
            offset += res.length
            yield res
        }
    } else {
        for await (const r of getUnusedInfos0("t_userCi", type)) {
            yield r
        }
        for await (const r of getUnusedInfos0("t_userCiMetadata", type)) {
            yield r
        }
    }
}

async function* getUnusedInfos0(from: "t_userCi" | "t_userCiMetadata", type: "location" | "poster") {
    const limit = 1000
    let offset = 0
    const otherTable = from == "t_userCi" ? "t_userCiMetadata" : "t_userCi"
    const col = type == "location" ? "locationStatus" : "posterStatus"

    while (true) {
        const res = await db.transaction("rw", [db.t_userCi, db.t_userCiMetadata], async () => {
            const r1 = await db[from].where(col).equals(statisticStatus.VerifiedAndUnused)
                .offset(offset).limit(limit).toArray()
            if (r1.length == 0) return null //end of result set reached
            offset += r1.length

            //corresponding records in otherTable
            const r2 = await db[otherTable].bulkGet(r1.map(r => ciPrimaryKey(r.ci)))
            const infoUsed: any = { [col]: statisticStatus.VerifiedAndUsed }

            //check if infos were already used from other table
            const res: UserCiMetadataRecord[] = []
            const changes = []
            for (let i = 0; i < r1.length; i++) {
                const r2i = r2[i]
                if (r2i != undefined && r2i[col] === statisticStatus.VerifiedAndUsed) {
                    //info was already used
                    changes.push({
                        key: ciPrimaryKey(r1[i].ci),
                        changes: infoUsed
                    })
                } else {
                    res.push(r1[i])
                }
            }
            //update status of entries that were already used in other table
            lg.debug("getUnusedInfos0: already used %O", changes)
            lg.debug("new info: %O", res)
            await db[from].bulkUpdate(changes)
            return res
        })

        if (res == null) break
        yield res
    }
}

/**
 * Returns an upper bound on the number of records returned by `getUnusedInfos(type)`.
 * It is not exact because the same unused information may be counted twice if it 
 * comes from a user CI and a stub. 
 */
async function getUnusedInfosUpperBound(type: UnusedInfoType) {
    if (type == "loaded") {
        return await db.t_userCi.where("loadedStatus").equals(statisticStatus.VerifiedAndUnused).count()
    }

    const col = type == "location" ? "locationStatus" : "posterStatus"
    return await db.t_userCi.where(col).equals(statisticStatus.VerifiedAndUnused).count()
        + await db.t_userCiMetadata.where(col).equals(statisticStatus.VerifiedAndUnused).count()
}

async function getPosterRecord(keyId: KeyId) {
    return await db.t_poster.get(keyId)
}

async function getLocationRecord(location: string) {
    return await db.t_location.get(normalizeLocation(location))
}

async function getLocationsStartingWith(prefix: string, ignoreCase: boolean, limit?: number) {
    const sw = ignoreCase ? "startsWithIgnoreCase" : "startsWith"
    const res0 = db.t_location.where("location")[sw](prefix)
    const res1 = limit ? res0.limit(limit) : res0
    return await res1.toArray()
}

async function getKeyIdCount() {
    return await db.t_poster.count()
}

async function getLocationCount(schemes: string[]) {
    return await db.t_location.where("scheme").anyOf(schemes).count()
}

async function addPublicKeys(publicKeys: string[]) {
    //compute key ids for public keys
    const keyIds: string[] = []
    for (const pk of publicKeys) {
        keyIds.push(await computeKeyId(pk))
    }

    //bulk update poster records with public keys
    db.transaction("rw", [db.t_poster], async () => {
        const recs0 = await db.t_poster.bulkGet(keyIds)
        const recs: PosterRecord[] = []
        for (let i = 0; i < keyIds.length; i++) {
            let rec = recs0[i] ?? defaultPosterRecord(keyIds[i])
            rec.publicKey = publicKeys[i]
            recs.push(rec)
        }
        await db.t_poster.bulkPut(recs)
    })
}

/**
 * Resets all stats so that they can be recomputed.
 * 
 * In particular, all entries in t_poster and t_location are deleted
 * and the columns locationStatus and posterStatus in t_userCi and 
 * t_userCiMetadata are changed from 2 (verified and used) to 1 
 * (verified and unused). And the column usedInStats in t_job is set
 * to 0 for all rows.
 */
async function resetStats() {
    await db.t_poster.clear()
    await db.t_location.clear()

    const tables = ["t_userCi", "t_userCiMetadata"] as const
    const cols = ["locationStatus", "posterStatus"] as const
    for (const t of tables) {
        for (const c of cols) {
            await db[t].where(c).equals(statisticStatus.VerifiedAndUsed).modify((r) => {
                r[c] = statisticStatus.VerifiedAndUnused
            })
        }
    }
    await db.t_userCi.where("loadedStatus").equals(statisticStatus.VerifiedAndUsed).modify((r) => {
        r.loadedStatus = statisticStatus.VerifiedAndUnused
    })

    await db.t_job.toCollection().modify({usedInStats: 0})
}

async function newJobsForCatIds(recs: JobRecord[]) {
    lg.debug("newJobsForCatIds(): new job recs: %O", recs)

    //assuming the records are all unused
    await db.transaction("rw", [db.t_location, db.t_poster, db.t_userCi, db.t_userCiMetadata, db.t_job], async () => {
        //get the union of CIs from the given job records
        const userCiRecs = await db.t_userCi.where("jobIds").anyOf(recs.map(x => x.jobId!)).toArray()
        lg.debug("newJobsForCatIds(): affected user ci recs: %O", userCiRecs)        

        //computed affected locations and posters 
        const locations = distinctArray(userCiRecs.map(x => normalCiLocation(x.ci)))
        const posters = distinctArray(userCiRecs.map(x => x.poster))

        //contains the cat ids after adding the new ones
        const newCatIds = {
            location: new Map<string, number[]>(),
            poster: new Map<string, number[]>()
        }

        for (const userCiRec of userCiRecs) {
            //cat ids for locations from the given job records
            const loc = normalCiLocation(userCiRec.ci)
            const ml = newCatIds.location
            ml.set(loc, (ml.get(loc) ?? []).concat(userCiRec.catIds))

            //cat ids for posters from the given job records
            const poster = userCiRec.poster
            const mp = newCatIds.poster
            mp.set(poster, (mp.get(poster) ?? []).concat(userCiRec.catIds))
        }

        //update location and poster records
        const locRecs = (await db.t_location.bulkGet(locations))
            .map((x, i) => {
                const loc = locations[i]
                if (x == undefined) {                    
                    x = defaultLocationRecord(loc)
                    lg.debug("newJobsForCatIds(): location %O has no record -> using default %O", loc, x)
                }
                x.catIds = distinctArray(x.catIds.concat(newCatIds.location.get(loc)!))
                return x
            })
        const posterRecs = (await db.t_poster.bulkGet(posters))
            .map((x, i) => {
                const poster = posters[i]
                if (x == undefined) x = defaultPosterRecord(poster)
                x.catIds = distinctArray(x.catIds.concat(newCatIds.poster.get(poster)!))
                return x
            })
            .filter(x => x.keyId != "anon") //remove anon record

        lg.debug("newJobsForCatIds(): new loc recs %O", locRecs)
        lg.debug("newJobsForCatIds(): new poster recs %O", posterRecs)
        await db.t_location.bulkPut(locRecs)
        await db.t_poster.bulkPut(posterRecs)

        //update used in stats flag in t_job
        const changesInJobTable = recs.map(x => ({
            key: x.jobId!,
            changes: {
                usedInStats: 1
            }
        })) 
        lg.debug("newJobsForCatIds(): changes in job for %O", changesInJobTable)

        await db.t_job.bulkUpdate(recs.map(x => ({
            key: x.jobId!,
            changes: {
                usedInStats: 1
            }
        })) )
    })
}

/**
 * Update loaded stats in `t_location` and `t_poster` with CIs
 * from `t_userCi` that have not been used yet but are verified
 * (see `loadedStatus`)
 * @param recs 
 */
async function newLoadedCis(recs: UserCiRecord[]) {
    recs.forEach(normalizeRecLocation)
    await db.transaction("rw", [db.t_location, db.t_poster, db.t_userCi], async () => {
        //get all affected location and poster records as maps
        const locations = recs.map(r => ciMetadata(r.ci).location)
        const posters = recs.map(r => r.poster).filter(posterIsKeyId)
        const locationMap = await locationMapFromUris(locations)
        const posterMap = await posterMapFromKeyIds(posters)

        //update location and poster records
        for (let i = 0; i < recs.length; i++) {
            const rec = recs[i]
            const type = ciType(rec.ci) == CiType.Post ? "post" : "echo"

            updateCountAndDates("loaded", "ci", locationMap.get(normalCiLocation(rec.ci))!, ciPostTime(rec.ci))
            updateCountAndDates("loaded", type, locationMap.get(normalCiLocation(rec.ci))!, ciPostTime(rec.ci))

            const poster = rec.poster
            if (posterIsKeyId(poster)) {
                //only update if poster is a keyId
                updateCountAndDates("loaded", "ci", posterMap.get(poster)!, ciPostTime(rec.ci))
                updateCountAndDates("loaded", type, posterMap.get(poster)!, ciPostTime(rec.ci))
            }
        }

        const statusUpdate = recs.map(r => ({
            key: ciPrimaryKey(r.ci),
            changes: { loadedStatus: statisticStatus.VerifiedAndUsed }
        }))

        await db.t_location.bulkPut(mapToArray(locationMap))
        await db.t_poster.bulkPut(mapToArray(posterMap))
        await db.t_userCi.bulkUpdate(statusUpdate)
    })
}

/**
 * When the location X a CI Y was posted to becomes known, the
 * location record for X (parent) and Y (child) are updated.
 * For Y the parent field is set and for X the echo stats
 * of its poster are updated (if the poster is known).
 * If X is a CI and the poster P of X is known then poster
 * record P is updated as well
 */
async function newLocations(recs: UserCiMetadataRecord[]) {
    //remove records where location is not known or loc status is not verified & unused
    recs = recs.filter(r =>
        ciMetadata(r.ci).location != undefined
        && r.locationStatus == statisticStatus.VerifiedAndUnused)
    recs.forEach(normalizeRecLocation)

    const childLocations = recs.map(r => toCiUrn(ciId(r.ci)))
    const parentLocations = recs.map(r => ciMetadata(r.ci).location!)

    await db.transaction("rw", [db.t_location, db.t_poster, db.t_userCi, db.t_userCiMetadata], async () => {
        const childRecords = await db.t_location.bulkGet(childLocations)
        const parentMap = await locationMapFromUris(parentLocations)
        const parentKeyIds: KeyId[] = Array.from(parentMap.entries()
            .map(([_x, lr]) => lr.poster)
            .filter(x => x != undefined && posterIsKeyId(x))) as KeyId[]
        const posterMap = await posterMapFromKeyIds(parentKeyIds)
        const newChildRecords: LocationRecord[] = []

        for (let i = 0; i < recs.length; i++) {
            const md = ciMetadata(recs[i].ci)
            if (md.type != CiType.Post && md.type != CiType.Echo)
                throw new Error("unknown CI type (missing case in code?)")
            const location = md.location!
            const ciType = md.type == CiType.Post ? "post" : "echo"
            const waitingTime = md.payment.amount

            if (parentMap.has(childLocations[i])) {
                lg.debug("Child is parent as well %O", parentMap.get(childLocations[i]))
            }

            //update child location record: add parent
            //if a CI occurs as child and parent, modify the object referenced 
            //in the parentMap to ensure that the parent property is not overwritten 
            const childRec = parentMap.get(childLocations[i])
                ?? childRecords[i] ?? defaultLocationRecord(childLocations[i])

            childRec.parent = location
            newChildRecords.push(childRec)

            //update parent location record and poster record if poster is a keyId
            const parentRec = parentMap.get(location)!
            updateCountAndDates("global", "ci", parentRec, md.timestamp)
            updateCountAndDates("global", ciType, parentRec, md.timestamp)
            if (ciType == "echo") {
                //const totalEchoCount = parentRec.scheme == "ci" ? parentRec.global.echoCount + 1 : parentRec.global.echoCount
                updateSumMaxAvg("echo", parentRec, waitingTime, parentRec.global.echoCount)
                //updateSumMaxAvg("total", parentRec, waitingTime, totalEchoCount) //echoCount +1 if parentRec is ci
                if (posterIsKeyId(parentRec.poster)) {
                    const posterRec = posterMap.get(parentRec.poster!)!
                    //update echo and total values of poster record as well
                    posterRec.receivedEchoCount++

                    //posterRec.echoCount counts the number of echo CIs made by the poster 
                    //but echoAvg is the average echo waiting time the poster's CIs have
                    //received and therefore it must be computed w.r.t. receivedEchoCount
                    updateSumMaxAvg("echo", posterRec, waitingTime, posterRec.receivedEchoCount)
                    updateSumMaxAvg("total", posterRec, waitingTime, posterRec.global.ciCount + posterRec.receivedEchoCount)
                    lg.debug("updated posterRec %O", posterRec)
                }
            }
        }

        const statusUpdate = recs.map(r => ({
            key: ciPrimaryKey(r.ci),
            changes: { locationStatus: statisticStatus.VerifiedAndUsed }
        }))

        await db.t_location.bulkPut(newChildRecords)
        await db.t_location.bulkPut(mapToArray(parentMap))
        await db.t_poster.bulkPut(mapToArray(posterMap))
        await db.t_userCi.bulkUpdate(statusUpdate)
        await db.t_userCiMetadata.bulkUpdate(statusUpdate)
    })
}

/**
 * When the poster P of a CI X becomes known, update the stats of
 * the poster record of P and add poster to the location record of X
 */
async function newPosters(recs: UserCiMetadataRecord[]) {
    recs = recs.filter(r => r.posterStatus == statisticStatus.VerifiedAndUnused)
    recs.forEach(normalizeRecLocation)

    const anonRecs = recs.filter(r => r.poster === anonPoster)
    const kidRecs = recs.filter(r => posterIsKeyId(r.poster))

    //URN of recs[i] at urns[i]
    const urns = kidRecs.map(r => toCiUrn(ciId(r.ci)))
    const keyIds = kidRecs.map(r => r.poster as KeyId)
    lg.debug("keyIds: %O", keyIds)

    db.transaction("rw", [db.t_location, db.t_poster, db.t_userCi, db.t_userCiMetadata], async () => {
        const locationRecs = await db.t_location.bulkGet(urns)
        const posterMap = await posterMapFromKeyIds(keyIds)
        lg.debug("posterMap: %O", posterMap)

        const newLocationRecs: LocationRecord[] = []
        for (let i = 0; i < kidRecs.length; i++) {
            const md = ciMetadata(kidRecs[i].ci)
            if (md.type != CiType.Post && md.type != CiType.Echo)
                throw new Error("unknown CI type (missing case in code?)")
            const kid = keyIds[i]
            const ciType = md.type == CiType.Post ? "post" : "echo"
            const waitingTime = md.payment.amount

            //update location record: add poster
            const locationRec = locationRecs[i] ?? defaultLocationRecord(urns[i])
            locationRec.poster = kid
            newLocationRecs.push(locationRec)

            //update poster record
            const posterRec = posterMap.get(kid)!
            lg.debug("posterRec: %O", posterRec)
            //update counts and dates of poster (ci+post/echo)
            updateCountAndDates("global", "ci", posterRec, md.timestamp)
            updateCountAndDates("global", ciType, posterRec, md.timestamp)
            //update waiting time values of poster
            updateSumMaxAvg("waitingTime", posterRec, waitingTime, posterRec.global.ciCount)

            //update echo values of poster with echo values from the CI's location record     
            posterRec.receivedEchoCount += locationRec.global.echoCount
            posterRec.echoSum += locationRec.echoSum
            posterRec.echoMax = Math.max(posterRec.echoMax, locationRec.echoMax)
            posterRec.echoAvg = posterRec.receivedEchoCount == 0 ? 0 : posterRec.echoSum / posterRec.receivedEchoCount

            //update total values (add waiting time + echo sum of CI)
            const amountToAdd = waitingTime + locationRec.echoSum
            updateSumMaxAvg("total", posterRec, amountToAdd, posterRec.global.ciCount + posterRec.receivedEchoCount, true)
            //max has not been updated above; max update:
            posterRec.totalEchoMax = Math.max(posterRec.totalEchoMax, waitingTime, locationRec.echoMax)
        }

        const statusUpdate = kidRecs.concat(anonRecs).map(r => ({
            key: ciPrimaryKey(r.ci),
            changes: { posterStatus: statisticStatus.VerifiedAndUsed }
        }))

        const anonPosterUpdate = anonRecs.map(r => ({
            key: toCiUrn(ciId(r.ci)),
            changes: { poster: anonPoster }
        }))

        lg.debug("newPosters: add %O", mapToArray(posterMap))

        await db.t_poster.bulkPut(mapToArray(posterMap))
        await db.t_location.bulkPut(newLocationRecs)
        await db.t_location.bulkUpdate(anonPosterUpdate)
        await db.t_userCi.bulkUpdate(statusUpdate)
        await db.t_userCiMetadata.bulkUpdate(statusUpdate)
    })
}

async function posterMapFromKeyIds(keyIds: KeyId[]): Promise<Map<KeyId, PosterRecord>> {
    keyIds = distinctArray(keyIds)
    lg.debug("posterMapFromKeyIds: %O", keyIds)
    const recs = await db.t_poster.bulkGet(keyIds)
    const data: [KeyId, PosterRecord][] = []
    for (let i = 0; i < keyIds.length; i++) {
        data.push([keyIds[i], recs[i] ?? defaultPosterRecord(keyIds[i])])
    }
    return new Map(data)
}

async function locationMapFromUris(uris: string[]): Promise<Map<string, LocationRecord>> {
    uris = distinctArray(uris)
    const recs = await db.t_location.bulkGet(uris)
    const data: [string, LocationRecord][] = []
    for (let i = 0; i < uris.length; i++) {
        data.push([uris[i], recs[i] ?? defaultLocationRecord(uris[i])])
    }
    lg.debug("locationMapFromUrns %O => %O", uris, data)
    return new Map(data)
}

function mapToArray<S, T>(m: Map<S, T>): T[] {
    const arr: T[] = []
    for (const [_kid, pr] of m.entries()) {
        arr.push(pr)
    }
    return arr
}

function updateCountAndDates(type: "global" | "loaded", field: "ci" | "post" | "echo", r: LocationRecord | PosterRecord, ts: Date) {
    let countProp: "ciCount" | "postCount" | "echoCount"
    let firstProp: "firstCi" | "firstPost" | "firstEcho"
    let lastProp: "lastCi" | "lastPost" | "lastEcho"
    switch (field) {
        case "ci":
            countProp = "ciCount"
            firstProp = "firstCi"
            lastProp = "lastCi"
            break

        case "post":
            countProp = "postCount"
            firstProp = "firstPost"
            lastProp = "lastPost"
            break

        case "echo":
            countProp = "echoCount"
            firstProp = "firstEcho"
            lastProp = "lastEcho"
            break
    }

    r[type][countProp]++
    if (r[type][firstProp] == undefined || ts < r[type][firstProp]!) {
        r[type][firstProp] = ts
    }
    if (r[type][lastProp] == undefined || ts > r[type][lastProp]!) {
        r[type][lastProp] = ts
    }
}

function updateSumMaxAvg(type: "echo", r: LocationRecord | PosterRecord, amount: number, count: number): void;
function updateSumMaxAvg(type: "total" | "waitingTime", r: PosterRecord, amount: number, count: number, noMaxUpdate?: boolean): void;
function updateSumMaxAvg(type: "echo" | "total" | "waitingTime", r: LocationRecord | PosterRecord, amount: number, count: number, noMaxUpdate?: boolean): void {
    const updateMax = noMaxUpdate === undefined || noMaxUpdate === false

    let sumProp: "echoSum" | "totalEchoSum" | "waitingTimeSum"
    let maxProp: "echoMax" | "totalEchoMax" | "waitingTimeMax"
    let avgProp: "echoAvg" | "totalEchoAvg" | "waitingTimeAvg"

    switch (type) {
        case "echo":
            sumProp = "echoSum"
            maxProp = "echoMax"
            avgProp = "echoAvg"
            break

        case "total":
            sumProp = "totalEchoSum"
            maxProp = "totalEchoMax"
            avgProp = "totalEchoAvg"
            break

        case "waitingTime":
            sumProp = "waitingTimeSum"
            maxProp = "waitingTimeMax"
            avgProp = "waitingTimeAvg"
            break
    }

    r = r as PosterRecord
    r[sumProp] += amount
    if (updateMax) r[maxProp] = Math.max(r[maxProp], amount)
    r[avgProp] = r[sumProp] / count
}

function defaultLocationRecord(location: Uri): LocationRecord {
    const scheme = extractScheme(location)
    return {
        location: URL.parse(location)?.href ?? location,
        scheme: scheme,
        parent: scheme != ciSchemeName ? undefined : unknown,
        poster: scheme != ciSchemeName ? undefined : unknown,

        echoSum: 0,
        echoMax: 0,
        echoAvg: 0,

        catIds: [],

        global: {
            ciCount: 0,
            postCount: 0,
            echoCount: 0,
        },
        loaded: {
            ciCount: 0,
            postCount: 0,
            echoCount: 0,
        }
    }
}

function defaultPosterRecord(keyId: KeyId): PosterRecord {
    return {
        keyId: keyId,
        waitingTimeSum: 0,
        waitingTimeMax: 0,
        waitingTimeAvg: 0,
        totalEchoSum: 0,
        totalEchoMax: 0,
        totalEchoAvg: 0,
        receivedEchoCount: 0,
        echoSum: 0,
        echoMax: 0,
        echoAvg: 0,

        catIds: [],

        global: {
            ciCount: 0,
            postCount: 0,
            echoCount: 0,
        },
        loaded: {
            ciCount: 0,
            postCount: 0,
            echoCount: 0,
        }
    }
}

function normalizeRecLocation(x: UserCiMetadataRecord) {
    const md = ciMetadata(x.ci as UserCi)
    md.location = normalizeLocation(md.location)
}

function normalCiLocation(x: UserCi | UserCiMetadata) {
    return normalizeLocation(x.data.metadata.location!)
}