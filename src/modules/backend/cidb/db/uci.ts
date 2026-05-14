export {
    CiWithCategory,
    getUserCi, getUserCiPayment, externalCis, getCiCount, getCiCountAddedAfter, getUnverifiedUserCiCount, cisByKeyIds,
    putUserCis, putUserCisMetadata,
    putUserCiRecords, putUserCiMetadataRecords, verifyStubUserCis, verifyUserCiMetadataRecords,
    getUnverifiedUserCis, setUserCisAsVerified, moveToFake,
    setLogger
}

import { Logger } from "../../../libs/basic/logger.js"
import { distinctArray } from "../../../libs/basic/misc.js"
import { BulkError } from "../../../libs/dexie/dexie.js"
import { platformName, lg as defLg } from "../config.js"
import { ciId, ciMetadata, ciPoster, ciPrimaryKey, CiType, KeyId, UserCi } from "../types/ci.js"
import { LoadFileJobInDb, LoadUrlJobInDb, toCategorySource } from "../types/job.js"
import { CiWithCategory, StatsTrustLevel, StubUserCi, StubWithCategory } from "../types/misc.js"
import { LogCiChecker, VerifiedStub } from "./pci.js"
import { db } from "./schema/db.js"
import { anonPoster, StatisticsStatus, statisticStatus, UserCiMetadataRecord, UserCiPrimaryKey, UserCiRecord } from "./schema/v1.js"

//#region types
type PutUserCis = {
    added: number,
    alreadyExist: number,
    errors: {
        ci: UserCi,
        error: Error
    }[]
}

type PutUserCisMetadata = {
    added: number,
    unverifiable: number,
    errors: {
        stub: StubUserCi,
        error: Error
    }[]
}

type PutUserCisMode = PutUserCisModeJob | PutUserCisModeExternal
type PutUserCisModeJob = {
    type: "job",
    job: LoadUrlJobInDb | LoadFileJobInDb
}
type PutUserCisModeExternal = {
    type: "external",
    fromPostModule: boolean
}

//#endregion

let lg: Logger = defLg

/**
 * Use to set an alternative logger
 */
function setLogger(logger: Logger) {
    lg = logger
}

async function getUserCi(chain: string, seqNo: number) {
    return await db.t_userCi.get([chain, seqNo])
}

async function getUserCiPayment(chain: string, seqNo: number) {
    const x = await db.t_userCi.get([chain, seqNo]) ?? await db.t_userCiMetadata.get([chain, seqNo])
    return x === undefined ? null : ciMetadata(x.ci).payment
}

/**
 * All CIs that have the `fromExternal` flag set to 1. Use to get
 * all CIs that have been loaded from share. 
 * @param fromPostModule whether fromPostModule posts should be included as well (default is false)
 */
async function externalCis(fromPostModule?: boolean) {
    fromPostModule ??= false
    let q = db.t_userCi.where("fromExternal").equals(1)
    if(fromPostModule) q.and((x) => x.fromPostModule == 1)
    return await q.toArray()
}

/*
    - either from job (loader.ts worker)
    - or external (from post module or share)
    {type: "job", job: ..} or {type: "main", fromPostModule}
*/

//async function putUserCis(cis: CiWithCategory[], job: LoadUrlJobInDb | LoadFileJobInDb | undefined, overwrite: boolean, trustLevel: StatsTrustLevel): Promise<PutUserCis> {
async function putUserCis(cis: CiWithCategory[], mode: PutUserCisMode, trustLevel: StatsTrustLevel): Promise<PutUserCis> {
    const job = mode.type == "job" ? mode.job : undefined
    const fromPostModule = mode.type == "external" && mode.fromPostModule
    const overwrite = fromPostModule

    lg.debug("putUserCis fromPostModule", mode.type, (mode as any).fromPostModule, fromPostModule)

    const now = new Date()
    const catCache = new CategoryCache()

    //compute records to add
    const rows: UserCiRecord[] = []
    for (const ciWithCat of cis) {
        const ci = ciWithCat.ci
        const poster = ciPoster(ci) ?? anonPoster

        let catId: number | undefined = undefined
        if (ciWithCat.category !== undefined && job !== undefined) {
            catId = await catCache.getCatId(ciWithCat.category, toCategorySource(job))
        }

        //todo: test three setting values to see if the correct status level is written to db
        const infoStatus =
            trustLevel == "trustSignature" ? statisticStatus.VerifiedAndUnused :
                trustLevel == "trustLogCi" ? statisticStatus.UnknownOrUnverified :
                    trustLevel == "trustFromPostModule" ? (fromPostModule ? statisticStatus.UnknownOrUnverified : statisticStatus.VerifiedAndUnused) :
                        statisticStatus.UnknownOrUnverified //impossible; default            

        const res: UserCiRecord = {
            ci: ci,
            poster: poster,
            fromPostModule: fromPostModule ? 1 : 0,
            fromExternal: mode.type == "external" ? 1 : 0,
            jobIds: job !== undefined ? [job.jobId] : [], //job undefined => from post module
            catIds: catId ? [catId] : [],
            addedOn: now,
            logCiSeqNo: 0,
            locationStatus: infoStatus,
            posterStatus: infoStatus,
            loadedStatus: infoStatus
        }
        rows.push(res)
    }

    //write to db
    return await putUserCiRecords(rows, overwrite)
}

/**
 * Inserts rows into t_userCi. For already existing CIs the new job and cat ids are added
 * to the existing record.
 */
async function putUserCiRecords(rows: UserCiRecord[], overwrite?: boolean) {
    overwrite ??= false

    const union = <T>(x: T[], y: T[]) => distinctArray(x.concat(y))

    return db.transaction("rw", [db.t_userCi], async () => {
        const existingRecords = await db.t_userCi.bulkGet(rows.map(r => ciPrimaryKey(r.ci)))

        const alreadyExistCount = existingRecords.filter(x => x != undefined).length

        for (let i = 0; i < rows.length; i++) {
            const er = existingRecords[i]
            if (er === undefined || overwrite) continue

            //use existing record and add job & cat ids from new record
            er.jobIds = union(er.jobIds, rows[i].jobIds)
            er.catIds = union(er.catIds, rows[i].catIds)
            rows[i] = er
        }

        try {
            await db.t_userCi.bulkPut(rows)
            const res = {
                added: rows.length - alreadyExistCount,
                alreadyExist: alreadyExistCount,
                errors: []
            }
            lg.info("putUserCiRecords: %O", res)
            return res
        } catch (e) {
            lg.error("Failed to write user CI records to db: %O", e)
            throw e
        }
    })
}

async function putUserCisMetadata(lcc: LogCiChecker, stubs: StubWithCategory[], job: LoadUrlJobInDb | LoadFileJobInDb): Promise<PutUserCisMetadata> {
    const now = new Date()
    const catCache = new CategoryCache()

    const vs0 = await lcc.verifyStubs(stubs.map(s => s.stub))
    const verifiedStubs: { vs: VerifiedStub, category?: string }[] = vs0
        .filter(x => x.logCi != null)
        .map((v, i) => ({ vs: v, category: stubs[i].category }))

    const unverifiable = stubs.length - verifiedStubs.length
    for (const s of verifiedStubs) {
        if (s.vs.invalid.location != undefined) {
            lg.warn("Location for user CI %s@%s is not %s", s.vs.stub.seqNo, s.vs.stub.chain, s.vs.invalid.location)
        }
        if (s.vs.invalid.poster != undefined) {
            lg.warn("Poster for user CI %s@%s is not %s", s.vs.stub.seqNo, s.vs.stub.chain, s.vs.invalid.poster)
        }
    }

    //convert stubs to UserCiMetadataRecords
    const newRecords: UserCiMetadataRecord[] = []
    for (let i = 0; i < verifiedStubs.length; i++) {
        const stub = verifiedStubs[i].vs.stub
        const cat = verifiedStubs[i].category
        const lcsn = ciMetadata(verifiedStubs[i].vs.logCi!).seqNo
        const logEntry = verifiedStubs[i].vs.logEntry!

        let catId: number | undefined = undefined
        if (cat !== undefined) {
            catId = await catCache.getCatId(cat, toCategorySource(job))
        }

        newRecords.push({
            ci: {
                data: {
                    metadata: {
                        platform: platformName,
                        chain: logEntry.chain,
                        seqNo: logEntry.seqNo,
                        timestamp: logEntry.timestamp,
                        type: logEntry.type,
                        payment: logEntry.payment,
                        location: stub.location
                    }
                }
            },
            poster: stub.poster,
            addedOn: now,
            fromPostModule: 0, //stub cannot be from post module
            fromExternal: 0, //stub cannot be external
            jobIds: [job.jobId],
            catIds: catId ? [catId] : [],
            logCiSeqNo: lcsn,
            locationStatus: stub.location != undefined ? statisticStatus.VerifiedAndUnused : statisticStatus.UnknownOrUnverified,
            posterStatus: stub.poster != undefined ? statisticStatus.VerifiedAndUnused : statisticStatus.UnknownOrUnverified,
        })
    }

    const errs = await putUserCiMetadataRecords(newRecords)
    return {
        added: verifiedStubs.length,
        unverifiable: unverifiable,
        errors: errs.map(x => ({
            stub: stubs[x.index].stub,
            error: x.error
        }))
    }
}

/**
 * Inserts the rows into t_userCiMetadata. If a corresponding record already
 * exists then the new information (poster/location) is added and job and cat
 * ids are combined.
 * 
 * The location, poster and logCiSeqNo entries in the input rows are not verified. 
 * They are assumed to be correct.
 * 
 * @returns an array of errors for each record that could not be put into the db
 * @throws throws an error if something else than a BulkError occured in `Dexie.bulkPut`
 */
async function putUserCiMetadataRecords(rows: UserCiMetadataRecord[]) {
    rows.forEach(r => {
        //prepare rows by setting location and poster status to 1 if given
        r.locationStatus = ciMetadata(r.ci).location !== undefined ? statisticStatus.VerifiedAndUnused : statisticStatus.UnknownOrUnverified
        r.posterStatus = r.poster !== undefined ? statisticStatus.VerifiedAndUnused : statisticStatus.UnknownOrUnverified
    })

    const pks: UserCiPrimaryKey[] = rows.map(r => ciPrimaryKey(r.ci))
    const existingRecords = await db.t_userCiMetadata.bulkGet(pks)

    //if a record for the CI already exists, merge the records
    for (let i = 0; i < rows.length; i++) {
        //merge new record with existing one in mergedRec
        const mergedRec = existingRecords[i]
        if (mergedRec == undefined) continue //nothing to merge

        const newLocation = ciMetadata(rows[i].ci).location
        const newPoster = rows[i].poster
        const newJobIds = rows[i].jobIds
        const newCatIds = rows[i].catIds

        //only add info if it was previously unknown
        const mrMd = ciMetadata(mergedRec.ci)
        if (mrMd.location == undefined && newLocation != undefined) {
            mrMd.location = newLocation
            mergedRec.locationStatus = statisticStatus.VerifiedAndUnused
        }
        if (mergedRec.poster == undefined && newPoster != undefined) {
            mergedRec.poster = newPoster
            mergedRec.posterStatus = statisticStatus.VerifiedAndUnused
        }

        //add new job and cat ids
        mergedRec.jobIds.push(...newJobIds)
        mergedRec.catIds.push(...newCatIds)
        mergedRec.jobIds = distinctArray(mergedRec.jobIds)
        mergedRec.catIds = distinctArray(mergedRec.catIds)

        rows[i] = mergedRec
    }

    //insert new/updated records
    try {
        await db.t_userCiMetadata.bulkPut(rows)
        return []
    } catch (e) {
        if ((e as Error).name === 'BulkError') {
            const err = e as BulkError
            let errors = []
            for (const [pos, error] of Object.entries(err.failuresByPos)) {
                const index = pos as unknown as number
                const record = rows[index]
                errors.push({ index: index, record: record, error: error })
            }
            return errors
        } else {
            lg.error("Unexpected error in uci.ts:putUserCisMetadataRecords(): %O", e)
            throw e
        }
    }
}


/**
 * Returns a list of stubs that are unverifiable (no log CI exists for them)
 * or the poster or location entry does not match the hash in the log CI.
 * 
 * If the returned list is empty, this means every stub is valid.
 */
async function verifyStubUserCis(stubs: StubUserCi[], lcc: LogCiChecker) {
    // if (lcc == undefined) {
    //     lcc = new LogCiChecker()
    //     await lcc.init()
    // }

    return (await lcc.verifyStubs(stubs))
        .filter(vs =>
            vs.logCi === null //no log CI exists to verify the stub
            || vs.invalid.location !== undefined //invalid location
            || vs.invalid.poster !== undefined) //invalid poster
}


/**
 * @returns array of records that could not be verified because no log CI
 * exists or the poster/location entry does not match the hash in the log CI.
 */
async function verifyUserCiMetadataRecords(records: UserCiMetadataRecord[], lcc: LogCiChecker) {
    //convert records to stubs
    const stubs: StubUserCi[] = records.map(r => ({
        chain: ciId(r.ci).chain,
        seqNo: ciId(r.ci).seqNo,
        location: ciMetadata(r.ci).location,
        poster: r.poster
    }))

    //verify them (res contains invalid ones)
    const res = await verifyStubUserCis(stubs, lcc)

    //add record of invalid stub for convenience 
    return res.map(vs => ({
        record: records[vs.index],
        vs: vs
    }))
}

/**
 * Helper for `putUserCis` and `putUserCisMetadata to get the category id for a given 
 * category and category source
 */
class CategoryCache {
    lastCategory: null | {
        category: string,
        categorySource: ReturnType<typeof toCategorySource>,
        catId: number
    }

    constructor() {
        this.lastCategory = null
    }

    /**
     * Returns id of the given category + categorySource. If it does not exist yet, it is inserted.
     */
    async getCatId(category: string, categorySource: ReturnType<typeof toCategorySource>): Promise<number> {
        //check cache
        if (this.lastCategory !== null
            && this.lastCategory.category == category
            && this.lastCategory.categorySource.source == categorySource.source
            && this.lastCategory.categorySource.sourceType == categorySource.sourceType) {
            return this.lastCategory.catId
        }

        //lookup category id or insert if it does not exist
        return await db.transaction("rw", [db.t_category], async () => {
            let catId: number

            const catKey: [string, string, string] = [category, categorySource.source, categorySource.sourceType]
            const res = await db.t_category.where('[category+source+sourceType]').equals(catKey).toArray()
            if (res.length > 0) {
                //category exists => write id to catId
                catId = res[0].catId!
            } else {
                //category does not exist yet => insert
                try {
                    catId = await db.t_category.put({
                        category: category,
                        ...categorySource,
                        addedOn: new Date()
                    }) as number
                } catch (e) {
                    const err = e as Error
                    throw new Error(`Failed to add new category: [${err.name}] ${err.message}`)
                }
            }

            this.lastCategory = { category: category, categorySource: categorySource, catId: catId }
            return catId
        })
    }

}

/**
 * @param type if omitted total user CI count is returned
 */
async function getCiCount(type?: CiType) {
    if (type == undefined) return await db.t_userCi.count()
    return await db.t_userCi.where("ci.data.metadata.type").equals(type).count()
}

async function getCiCountAddedAfter(addedAfter: Date, type?: CiType) {
    if (type == undefined) return await db.t_userCi.where("addedOn").above(addedAfter).count()
    return await db.t_userCi.where("addedOn").above(addedAfter)
        .and(x => ciMetadata(x.ci).type == type).count()
}

async function getUnverifiedUserCiCount() {
    return await db.t_userCi.where("logCiSeqNo").equals(0).count()
}

async function* getUnverifiedUserCis() {
    const limit = 500
    let offset = 0
    while (true) {
        const records = await db.t_userCi.where("logCiSeqNo").equals(0)
            .offset(offset).limit(limit).toArray()
        if (records.length == 0) break
        offset += records.length
        yield records
    }
}

/**
 * Returns the set of user CI primary keys where the poster is one of 
 * the given keyIds.
 */
async function cisByKeyIds(keyIds: KeyId[]): Promise<UserCiPrimaryKey[]> {
    const x = await db.t_userCi.where("poster").anyOf(keyIds).primaryKeys()
    const y = await db.t_userCiMetadata.where("poster").anyOf(keyIds).primaryKeys()
    return distinctArray(x.concat(y))
}

async function moveToFake(pks: UserCiPrimaryKey[]) {
    if (pks.length == 0) return
    lg.security("Moving user CIs %O to fake user CI table", pks)
    await db.transaction("rw", [db.t_userCi, db.t_fakeUserCi], async () => {
        const recs = (await db.t_userCi.bulkGet(pks)).filter(x => x != undefined)
        await db.t_fakeUserCi.bulkPut(recs)
        await db.t_userCi.bulkDelete(pks)
    })
}

async function setUserCisAsVerified(verified: { pk: UserCiPrimaryKey, logCiSeqNo: number }[]) {
    if (verified.length == 0) return
    await db.transaction("rw", [db.t_userCi], async () => {
        const pks = verified.map(x => x.pk)
        type Change = {
            key: UserCiPrimaryKey,
            changes: {
                logCiSeqNo: number,
                locationStatus?: StatisticsStatus,
                posterStatus?: StatisticsStatus,
                loadedStatus?: StatisticsStatus
            }
        }

        const changes: Change[] = []
        const recs = await db.t_userCi.bulkGet(pks)
        for (let i = 0; i < verified.length; i++) {
            const x = verified[i]
            const rec = recs[i]
            if (rec == undefined) {
                lg.impossible("Undefined rec in setUserCisAsVerified (verified = %O, recs = %O)", verified, recs)
                continue
            }
            const chg: Change = {
                key: x.pk,
                changes: { logCiSeqNo: x.logCiSeqNo }
            }

            //only update location and poster status if it was not used before
            if (rec.locationStatus != statisticStatus.VerifiedAndUsed) {
                //lg.debug("updating location status to verified and unused for %O", rec)
                chg.changes.locationStatus = statisticStatus.VerifiedAndUnused
            }
            if (rec.posterStatus != statisticStatus.VerifiedAndUsed) {
                //lg.debug("updating poster status to verified and unused for %O", rec)
                chg.changes.posterStatus = statisticStatus.VerifiedAndUnused
            }
            if (rec.loadedStatus != statisticStatus.VerifiedAndUsed) {
                //lg.debug("updating loaded status to verified and unused for %O", rec)
                chg.changes.loadedStatus = statisticStatus.VerifiedAndUnused
            }

            changes.push(chg)
        }
        await db.t_userCi.bulkUpdate(changes)
    })
}
