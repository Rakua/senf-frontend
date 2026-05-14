export {
    getInaugurationCi, getKeyCis, getAllKeyCis, getLogCis, getLastPlatformCiSeqNo, getPlatformCiKeyByTime,
    putPlatformCis, clearPlatformCis, newLogCiChecker,
    LogCiChecker, VerifiedStub
}

import { db } from "./schema/db.js"
import { ciHash, CiId, ciId, ciMetadata, CiType, LogEntry, PlatformCi, PlatformCiInauguration, PlatformCiKey, PlatformCiLog, toCiUrn, UserChain, UserCi } from "../types/ci.js"
import { BulkError, DexieError } from "../../../libs/dexie/dexie.js"
import { platformChain } from "../misc.js"
import { anonPoster, PlatformCiRecord } from "./schema/v1.js"
import { binarySearch } from "../../../libs/etc/misc.js"
import { bypassChecks, chains, lg } from "../config.js"
import { saltedHash } from "../../../libs/etc/sdst.js"
import { StubUserCi } from "../types/misc.js"

type VerifiedStub = {
    index: number,
    stub: StubUserCi,
    logCi: PlatformCiLog | null, //null => no log CI exists => unverifiable
    logEntry?: LogEntry,
    invalid: {
        location?: string,
        poster?: string
    }
}

async function putPlatformCis(pcis: PlatformCi[]) {
    const now = new Date()
    const rows: PlatformCiRecord[] = pcis.map(pci => ({
        ci: pci,
        addedOn: now
    }))

    try {
        await db.t_platformCi.bulkAdd(rows)
    } catch (e) {
        const err = e as DexieError
        if (err.name === "BulkError") {
            //lg.error("db.t_platformCi.bulkAdd BulkError")

            for (const [pos, error] of Object.entries((err as BulkError).failuresByPos)) {                
                const cid = ciId(rows[pos as unknown as number].ci)
                if(error.name == "ConstraintError") continue //PCI already exists
                lg.error("Failed to add platform CI %s@%s: %O", cid.seqNo, cid.chain, error)
            }
        } else {
            throw e
        }
    }
}

/**
 * Deletes all platform CI records for a given chain in the database.
 * 
 * @param chain if undefined, all platform CI records are deleted; user chain
 */
async function clearPlatformCis(chain?: UserChain) {
    if (chain === undefined) {
        await db.t_platformCi.clear()
        return
    }
    await db.t_platformCi.where("ci.data.metadata.chain").equals(platformChain(chain)).delete()
}

async function getInaugurationCi(chain: UserChain): Promise<PlatformCiInauguration> {
    const res = await db.t_platformCi
        .where("ci.data.metadata.type").equals(CiType.Inauguration)
        .and(r => r.ci.data.metadata.chain == platformChain(chain))
        .toArray()

    if (res.length == 0) throw new Error("Inauguration CI not found for chain " + chain)
    return res[0].ci as PlatformCiInauguration
}

async function* getLogCis(chain: UserChain) {
    const limit = 1000
    let offset = 0

    while (true) {
        const res = await db.t_platformCi
            .where("ci.data.metadata.type").equals(CiType.Log)
            .and(r => ciMetadata(r.ci).chain == platformChain(chain))
            .offset(offset).limit(limit).toArray()
        if (res.length == 0) return
        offset += res.length

        yield res.map(r => (r.ci as PlatformCiLog))
    }
}

async function getAllKeyCis(): Promise<Record<UserChain,PlatformCiKey[]>> {
    const res : Record<UserChain, PlatformCiKey[]> = {}
    for(const c of chains) {
        res[c] = await getKeyCis("a")
    }
    return res
}

async function getKeyCis(chain: UserChain): Promise<PlatformCiKey[]> {
    const res = await db.t_platformCi
        .where("ci.data.metadata.type").equals(CiType.Key)
        .and(r => ciMetadata(r.ci).chain == platformChain(chain))
        .toArray()

    return res.map(r => (r.ci as PlatformCiKey))
}

async function getPlatformCiKeyByTime(chain: UserChain, time: Date): Promise<PlatformCiKey | undefined> {
    const keys = await getKeyCis(chain)
    return keys.find(k => k.data.content.validFrom <= time && k.data.content.validUntil >= time)
}

/**
 * @returns null => no platform CI in database
 */
async function getLastPlatformCiSeqNo(chain: UserChain) {
    const res = await getLastPlatformCi(chain)
    if (res == null) return null
    return ciMetadata(res).seqNo
}

async function getLastPlatformCi(chain: UserChain) {
    const res = await db.t_platformCi
        .orderBy("ci.data.metadata.timestamp").reverse()
        .filter(r => ciMetadata(r.ci).chain == platformChain(chain))
        .limit(1).toArray()
    return res.length == 0 ? null : res[0].ci
}


//index used for binary search to quickly look up the log CI seq. no. of a user CI
type LogCiCheckerIndex = Record<UserChain, { logCiSeqNo: number[], lastSeqNo: number[] }>
type HashVerification = HashVerificationOk | HashVerificationFail | HashVerificationUnverifiable

type HashVerificationOk = {
    type: "ok",
    logCiSeqNo: number
}

type HashVerificationFail = {
    type: "fail",
    logCiSeqNo: number
}

type HashVerificationUnverifiable = {
    type: "unverifiable"
}

async function newLogCiChecker() {
    const lcc = new LogCiChecker()
    await lcc.init()
    return lcc
}

/**
 * Use to look up the log entry for a user CI and to verify the location, poster
 * or hash of a user CI. Use the function `newLogCiChecker` to create an initialized
 * log ci checker.
 */
class LogCiChecker {
    #index: LogCiCheckerIndex = {}
    #initialized = false

    async init() {
        const lastEl = <T>(x: T[]): T => x[x.length - 1]

        if (this.#initialized) return //dont initialize more than once

        for (const chain of chains) {
            this.#index[chain] = { logCiSeqNo: [], lastSeqNo: [] }

            let rows: PlatformCiRecord[] | undefined
            let offset = 0
            while (rows === undefined || rows.length > 0) {
                rows = await db.t_platformCi
                    .where("ci.data.metadata.chain").equals(platformChain(chain))
                    .and(r => ciMetadata(r.ci).type == CiType.Log)
                    .offset(offset).limit(1000).toArray()
                offset += rows.length
                for (const row of rows) {
                    const logCi = row.ci as PlatformCiLog
                    if (logCi.data.content.length == 0) continue
                    this.#index[chain].logCiSeqNo.push(ciMetadata(row.ci).seqNo)
                    this.#index[chain].lastSeqNo.push(lastEl(logCi.data.content).seqNo)
                }
            }
        }

        this.#initialized = true
    }

    lookupLogCiSeqNo(ciId: CiId): number | null {
        if (!this.#initialized)
            throw new Error("LogCiLookup intialization not complete (forgot to await LogCiLookup.init()?)")

        const index = this.#index[ciId.chain]
        const res = binarySearch(ciId.seqNo, index.lastSeqNo)
        if (res === null) return null
        return index.logCiSeqNo[res]
    }

    async getLogCi(ciId: CiId): Promise<PlatformCiLog | null> {
        return (await this.getLogCis([ciId]))[0] ?? null
    }

    async getLogCis(ciIds: CiId[]): Promise<(PlatformCiLog | null)[]> {
        const nonExistingPk: [string, number] = ["", 0]
        const pks: [string, number][] = []
        for (const ciId of ciIds) {
            const logSeqNo = this.lookupLogCiSeqNo(ciId)
            pks.push(logSeqNo === null ? nonExistingPk : [platformChain(ciId.chain), logSeqNo])
        }
        const recs = await db.t_platformCi.bulkGet(pks)
        return recs.map(r => r == undefined ? null : r.ci as PlatformCiLog)
    }

    /**
     * Verifies locations and posters of each stub in `stubs` and adds the log CI
     * and log entry from that CI. A stub is unverifiable if no log CI exists
     * for it. Invalid information is removed from the stub and set in the invalid
     * property.
     * 
     * If the log entry of a CI contains no keyId, the poster property of the 
     * returned stub is set to `anonPoster`.
     */
    async verifyStubs(stubs: StubUserCi[]) {
        const res: VerifiedStub[] = []

        const logCis = await this.getLogCis(stubs)
        for (let i = 0; i < stubs.length; i++) {
            const stub = stubs[i]
            const logCi = logCis[i]
            const vs: VerifiedStub = { index: i, stub: stub, logCi: logCi, invalid: {} }
            if (logCi == null) {
                //cannot verify since no corresponding log CI exists
                res.push(vs)
                continue
            }

            //get log entry
            const logEntry = logCi.data.content.find(e => e.seqNo == stub.seqNo)
            if (logEntry == undefined) {
                lg.impossible("Log entry for CI %s@%s not found in log CI %O", stub.seqNo, stub.chain, logCi)
                throw new Error(`Log entry for CI ${stub.seqNo}@${stub.chain} not found in log CI with seq. no. ${ciMetadata(logCi).seqNo}`)
            }
            vs.logEntry = logEntry

            //verify location if present
            if (stub.location != undefined && logEntry.location.hash
                != await saltedHash(stub.location, logEntry.location.salt)) {
                vs.invalid.location = stub.location
                delete vs.stub.location
            }

            //verify poster if present
            if (logEntry.keyId == undefined) {
                //if no keyId in log entry => poster is anon; set stub value
                stub.poster = anonPoster
            } else {
                if (stub.poster != undefined && logEntry.keyId!.hash
                    != await saltedHash(stub.poster, logEntry.keyId!.salt)) {
                    vs.invalid.poster = stub.poster
                    delete vs.stub.poster
                }
            }

            res.push(vs)
        }

        return res
    }

    /**
     * Checks if the hashes of the user CIs match the ones in the platform
     * log CIs. If the hash of the user CI at index i matches the resulting
     * array contains the log CI seq. no. at the same index. If it does not
     * match, it contains `"fake"` and if there is no log CI for the user CI
     * yet, it contains `"unverifiable"`.
     */
    async verifyCis(cis: UserCi[]) {
        const res: HashVerification[] = []

        const ciIds = cis.map(ci => ciId(ci))
        const logCis = await this.getLogCis(ciIds)
        for (let i = 0; i < cis.length; i++) {
            const ci = cis[i]
            const ciMd = ciMetadata(ci)
            const cid = ciIds[i]
            const logCi = logCis[i]

            if (logCi == null) {
                //not verifiable since no log CI exists
                res.push({ type: "unverifiable" })
                continue
            }

            if(ciMd.seqNo <= (bypassChecks(ciMd.chain) ?? 0)) {
                lg.security("Bypassing hash check for CI %O. Your database might be tainted now!", ci)
                res.push({ type: "ok", logCiSeqNo: ciMetadata(logCi).seqNo })
                continue
            }

            //get log entry
            const logEntry = logCi.data.content.find(e => e.seqNo == cid.seqNo)
            if (logEntry == undefined) {
                lg.impossible("Log entry for CI %s@%s not found in log CI %O", cid.seqNo, cid.chain, logCi)
                throw new Error(`Log entry for CI ${cid.seqNo}@${cid.chain} not found in log CI with seq. no. ${ciMetadata(logCi).seqNo}`)
            }

            res.push({
                type: (await ciHash(ci) == logEntry.hash) ? "ok" : "fail",
                logCiSeqNo: ciMetadata(logCi).seqNo
            })

            //#region legacy code for null sigs (bak)
            // const ci2: any = structuredClone(ci)
            // ci2.data.content.signatures = null
            // const nullHash = await ciHash(ci2)
            // const hashMatches = await ciHash(ci) == logEntry.hash || nullHash == logEntry.hash
            // res.push({
            //     type: hashMatches ? "ok" : "fail",
            //     logCiSeqNo: ciMetadata(logCi).seqNo
            // })  
            //#endregion          
        }

        return res
    }
}


