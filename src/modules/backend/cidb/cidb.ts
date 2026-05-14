export {
    JobId, JobReport, JobReportCriteria,
    Query, UserCiPrimaryKey, EntityModel,
    SerializableQuery, SerializableQueryFilter, SerializableQueryOrder, SerializableQueryIndex,
    CiType, KeyId, TimeUnit, SortOrder, CategorySelection,

    modName, init,

    queryWithProgress, queryWithoutProgress, fromKeys, fromSerializableQuery,
    yourCis, externalCis, getLocationsStartingWith, getUserCi,
    userCiExists, getCiCount, getCiCountAddedAfter,
    reactiveCounts, ciCountR, postCountR, echoCountR, echoWithStubsCountR, urlCountR, keyIdCountR, globalCiCountR, globalEchoCountR, globalPostCountR,

    loadPlatformCis, reloadPlatformCis,

    loadFile, loadUrl, crawlArchive, loadCiIntoDb, verifyUserCi,
    jsonSrFromUserCi, serializeUserCi,

    retryJob, abortJob, jobReports, jobReportsCount, getJobById,

    testStats, resetStats, recomputeStats,

    exportDatabase, exportCis, importDatabase, deleteDatabase,
    exportDatabaseParameters, importDatabaseParameters,

    aliasOf, keyIdOfAlias, setAlias, unsetAlias, addYourAnonCi, addYourKeyId,

    isUserCiPrimaryKey,

    tableCount,

    bypassChecks, bypassChecksData, bypassChecksActive,

    getCiSourcesAndCategories,

    getCategories,

    addListener, removeListener,
}

import { addListenerForBecomingMainTab, addListenerForMainTab, isMainTab, postMessageToMainTab } from "../../libs/etc/tab.js"
import { modName, lg, chains, bypassChecks, bypassChecksData, bypassChecksActive } from "./config.js"
import { fetchPlatformCis, getCiSourcesAndCategories } from "./misc.js"
import { abortJob, addCrawlJob, addLoadFileJob, addLoadUrlJob, initManager, initManagerQueryHandlers, manager, retryJob } from "./manager.js"
import { CiId, ciId, ciMetadata, ciPoster, ciPrimaryKey, CiType, KeyId, normalizeCiTimestamp, PlatformKey, serializeUserCi, UserChain, UserCi } from "./types/ci.js"
import { JobId, JobReport } from "./types/job.js"
import { clearPlatformCis, getInaugurationCi, getKeyCis, getLastPlatformCiSeqNo, getLogCis, getPlatformCiKeyByTime } from "./db/pci.js"
import { getCiCount, getCiCountAddedAfter, getUserCi as getUserCi0, cisByKeyIds, moveToFake, putUserCis, externalCis } from "./db/uci.js"
import { Archive, ComputerMessage, isUserCiPrimaryKey } from "./types/misc.js"
import { deleteOldCrawlJobs, getJobById } from "./db/jobs.js"
import { initReactiveValues, JobReportCriteria, jobReports, jobReportsCount, ciCountR, postCountR, echoCountR, echoWithStubsCountR, urlCountR, keyIdCountR, globalCiCountR, globalEchoCountR, globalPostCountR, updateGlobalStats, reactiveCounts, initLoadedValues } from "./reactive.js"
import { settings } from "./settings.js"
import { verifyAllStats } from "./db/stats-verify.js"
import { Aliases, YourAnonCis, YourKeyIds } from "./personal.js"
import { PropertyContext } from "./db/entity.js"
import { queryWithoutProgressGen, queryWithProgressGen, fromKeysGen } from "./db/query.js"
import { addListener, removeListener, emitEvent } from "./events.js"
import { DefaultLogger } from "../../libs/basic/logger.js"
import { distinctArray } from "../../libs/basic/misc.js"
import { UserCiPrimaryKey } from "./db/schema/v1.js"
import { deleteDatabase, tableCount } from "./db/schema/db.js"
import { getLocationsStartingWith as getLocationsStartingWith0, resetStats } from "./db/stats.js"
import { fromSerializableQuery as fromSerializableQuery0, Query, SerializableQuery, SerializableQueryFilter, SerializableQueryIndex, SerializableQueryOrder, SortOrder, TimeUnit } from "./types/query.js"
import { EntityModel, EntityName, toEntity } from "./types/entity.js"
import { exportCis, exportDatabase, exportDatabaseParameters } from "./db/export/export.js"
import { importDatabase as importDatabaseGen, importDatabaseParameters } from "./db/export/import.js"

import { addListener as addWorkerListener } from "./worker/computer.js"
import { verifyUserCi as verifyUserCi0, VerifyUserCiInvalid, VerifyUserCiParameters } from "./worker/loader.js"
import { firstUpdateTimeFinished, getTimePair } from "../time.js"
import { CategorySelection, getCategories as getCategories0 } from "./db/category.js"
import { ReactiveAtom, readOnlyReactiveValue } from "../../libs/basic/reactive.js"

const context: PropertyContext = {
    yourAnonCis: new YourAnonCis(settings.yourAnonCis.reactiveRw()),
    yourKeyIds: new YourKeyIds(settings.yourKeyIds.reactiveRw()),
    aliases: new Aliases(settings.aliases.reactiveRw())
} as const
let computerWorker: Worker

const categoryMappingR = new ReactiveAtom(getCategories0())

const queryWithoutProgress = queryWithoutProgressGen(context)
const queryWithProgress = queryWithProgressGen(context)
const fromKeys = fromKeysGen(context)

const importDatabase = importDatabaseGen.bind(null, settings.statsTrustLevel.get())

async function getLocationsStartingWith(prefix: string, ignoreCase: boolean, limit?: number) {
    const locs = await getLocationsStartingWith0(prefix, ignoreCase, limit)
    return locs.map(l => toEntity("location", l, context))
}

function init() {
    initLoadedValues()
    initReactiveValues()
    initManagerQueryHandlers()

    addListenerForBecomingMainTab(async () => {
        const promises = chains.map(async (chain) => await loadPlatformCis(chain))
        await Promise.allSettled(promises)

        lg.debug("platform cis finished loading; initialize manager")
        initManager()

        //lg.debug("disable auto jobs in cidb for debugging")
        //return

        //set interval for auto crawling archives from settings every x minutes
        setInterval(crawlArchives, settings.recrawlInterval.get())
        crawlArchives()

        computerWorker = initComputerWorker()
        addListener((ev) => {
            lg.debug("updating stats because %O", ev)
            updateStats()
        }, ["loadersFinished", "importFinished"])

        addListener((ev) => {
            lg.info("loadersFinished event done")
        }, ["loadersFinished"])

        try {
            const x = await deleteOldCrawlJobs()
            lg.log("Deleted %s old crawl jobs in db", x)
        } catch (e) {
            lg.log("Failed to delete old crawl jobs: %O", e)
        }
    })

    addListenerForMainTab(() => {
        lg.debug("update stats msg received")
        const msg: ComputerMessage = { type: "work" }
        computerWorker.postMessage(msg)
    }, { module: modName, type: "updateStats" })

    addListener(async (ev) => {
        lg.info("Updating global stats because import finished")
        updateGlobalStats()

        if (isMainTab()) {
            lg.info("Recompute stats because import finished")
            await recomputeStats()
        }
    }, ["importFinished"])

    addListener(async (ev) => {
        //refresh category mapping
        lg.debug("refreshing category mapping")
        categoryMappingR.set(getCategories0())
    }, ["loadersFinished", "importFinished"])
}

async function getUserCi(ciId: CiId) {
    const res = await getUserCi0(ciId.chain, ciId.seqNo)
    return res == undefined ? undefined : res.ci
}

async function yourCis() {
    const x = await cisByKeyIds(context.yourKeyIds.get())
    return distinctArray(x.concat(context.yourAnonCis.get()))
}

function initComputerWorker() {
    const w = new Worker("modules/backend/cidb/worker/computer.w.js", { type: "module" })
    const msg: ComputerMessage = {
        type: "init",
        data: {
            limit: 0,
            serverClientTimeDelta: 0,
            timeBetweenLogCis: 0,
            sleepIntv: 1000 * 60 * 5,
            mutedData: DefaultLogger.getMuted()
        }
    }
    w.postMessage(msg)
    return w
}

/**
 * Update precomputed stats and verifies user CIs against
 * hashes in log CIs. 
 * 
 * Sends a message to the main tab which triggers the computer 
 * worker to start working.
 */
function updateStats() {
    lg.debug("Send updateStats message to main tab")
    postMessageToMainTab(modName, "updateStats", null)
}

async function loadPlatformCis(chain: string) {
    const lastCiSeqNo = (await getLastPlatformCiSeqNo(chain)) ?? 0

    lg.info("Updating platform CIs for chain %s (last PCI in db has seq. no. %O)", chain, lastCiSeqNo)
    await fetchPlatformCis(chain, lastCiSeqNo + 1)
    lg.info("Finished updating platform CIs")
}

async function reloadPlatformCis(chain?: string) {
    if (chain === undefined) {
        lg.info("Deleting and reloading all platform CIs")
        await clearPlatformCis()
        await Promise.allSettled(chains.map(chain => loadPlatformCis(chain)))
        lg.info("Finished reloading platform CIs")
    } else {
        lg.info("Deleting and reloading all platform CIs for chain %s", chain)
        await clearPlatformCis(chain)
        await loadPlatformCis(chain)
        lg.info("Finished reloading platform CIs for chain %s", chain)
    }
}

async function loadUrl(jsonlUrl: string): Promise<JobId> {
    return await addLoadUrlJob(jsonlUrl)
}

async function loadFile(jsonlFile: File): Promise<JobId> {
    return await addLoadFileJob(jsonlFile)
}

async function crawlArchive(archive: Archive) {
    //note: will be shown as started by script
    return await addCrawlJob(archive.url)
}

async function crawlArchives() {
    for (const archive of settings.archives.get()) {
        await crawlArchive(archive)
    }
}

async function verifyUserCi(ci: UserCi) {
    const promises = chains.map(async (chain) => await loadPlatformCis(chain))
    await Promise.allSettled(promises)

    const keys: Record<UserChain, PlatformKey[]> = {}
    const inaugTimestamp: Record<UserChain, Date> = {}

    for (const chain of chains) {
        keys[chain] = (await getKeyCis(chain)).map(pci => pci.data.content)
        inaugTimestamp[chain] = ciMetadata((await getInaugurationCi(chain))).timestamp
    }
    lg.debug("verifyUserCi keys", keys)

    await firstUpdateTimeFinished
    const timePair = getTimePair()
    const timeDiff = timePair.serverTime.getTime() - timePair.clientTime.getTime()

    const verifyParam: VerifyUserCiParameters = {
        keys: keys,
        inaugurationTimestamp: inaugTimestamp,
        serverClientTimeDelta: timeDiff
    }

    return await verifyUserCi0(verifyParam, ci, lg)
}

async function fromSerializableQuery<E extends EntityName>(entity: E, sq0: SerializableQuery<E>): Promise<Query<E>> {
    return fromSerializableQuery0(entity, sq0, await categoryMappingR.get())
}

function getCategories() {
    return readOnlyReactiveValue(categoryMappingR)
}




/**
 * Converts user CI into an object that can be sent to SDST via a
 * verify request. The public key of the platform signing key is
 * added.
 */
async function jsonSrFromUserCi(ci: UserCi) {
    const ci0 = normalizeCiTimestamp(ci)
    const key = await getPlatformCiKeyByTime(ciMetadata(ci).chain, ciMetadata(ci).timestamp)
    if (key !== undefined) {
        (ci0.signatures[0] as any).publicKey = key.data.content.publicKey
    }

    return ci0
}


type LoadCiIntoDb = LoadCiIntoDbOk | LoadCiIntoDbInvalid
type LoadCiIntoDbOk = {
    type: "ok",
    alreadyExists: boolean,
    ciId: CiId
}
type LoadCiIntoDbInvalid = {
    type: "invalid",
    reason: VerifyUserCiInvalid
}

/**
 * Use this to load a CI that was posted by the user or received via a
 * share link.
 * 
 * 
 * @returns false if CI is not from post module and already exists in db
 */
async function loadCiIntoDb(ci: UserCi, fromPostModule: boolean): Promise<LoadCiIntoDb> {
    lg.debug("put user CI %O (fromPostModule %O)", ci, fromPostModule)

    //if (!fromPostModule) {
    if (true) {
        //verify
        const res = await verifyUserCi(ci)
        lg.debug("loadCiIntoDb res", res)
        if (res.type == "invalid") return { type: "invalid", reason: res }
    }

    const fci = await getUserCi0(ciMetadata(ci).chain, ciMetadata(ci).seqNo)
    if (fci !== undefined) {
        if (fromPostModule) {
            lg.security("CI %O already exists in CIDB", ciId(ci))
            //already loaded into db before? should not be possible
            await moveToFake([[ciMetadata(ci).chain, ciMetadata(ci).seqNo]])
        } else {
            return { type: "ok", alreadyExists: true, ciId: ciId(ci) }
        }
    }

    if (fromPostModule) {
        //update settings to remember "your posts"
        const poster = ciPoster(ci)
        if (poster == null) {
            context.yourAnonCis.add(ciPrimaryKey(ci))
        } else {
            if (context.yourKeyIds.add(poster)) {
                lg.info("KeyId %s added to your KeyIds", poster)
            }
        }
    }

    const res = await putUserCis([{ ci: ci }], { type: "external", fromPostModule: fromPostModule }, settings.statsTrustLevel.get())
    if (res.errors.length > 0) throw res.errors[0].error

    //update stats if CIs from post module are trusted
    if (settings.statsTrustLevel.get() == "trustSignature" || (settings.statsTrustLevel.get() == "trustFromPostModule" && fromPostModule)) {
        updateStats()
    }

    emitEvent({
        type: "loadedCiFromMainThread",
        data: ci
    })

    return { type: "ok", alreadyExists: false, ciId: ciId(ci) }
}

/**
 * Use in conjunction with query as parameter for index to
 * get user's CIs. Example:
 */
// async function yourCis(type: CiType) : Promise<PrimaryKeyOf<"t_userCi">> {
//     const enityName = ciTypeToEntityName(type)


//     settings.yourKeyIds.get()
// }

async function userCiExists(chain: string, seqNo: number) {
    return await getUserCi0(chain, seqNo) !== undefined
}

async function testStats() {
    lg.info("Verifying precomputed stats")

    let passed = true

    const resLocation = await verifyAllStats("location", context)
    if (resLocation.length == 0) {
        lg.info("Location stats verified, no error ✅")
    } else {
        lg.error("Computed location stats deviate from precomputed ones: %O", resLocation)
        passed = false
    }

    const resPoster = await verifyAllStats("poster", context)
    if (resPoster.length == 0) {
        lg.info("Poster stats verified, no error ✅")
    } else {
        lg.error("Computed poster stats deviate from precomputed ones: %O", resPoster)
        passed = false
    }

    return passed
}

/**
 * Can only be called from main thread
 * 
 * todo: rewrite such that it can be called from any thread
 * by sending a query to the main thread (set up query handler)
 */
async function recomputeStats() {
    if (computerWorker == undefined) {
        throw new Error("recomputeStats() can only be called from main tab")
    }

    lg.info("Removing precomputed stats")
    await resetStats()
    lg.info("Recomputing precomputed stats")

    return new Promise<void>((resolve) => {
        addWorkerListener(async (ev) => {
            lg.info("Finished recomputing stats: %O", ev)
            await testStats()
            resolve()
        }, ["finished"])

        updateStats()
    })
}

//#region aliases

function aliasOf(keyId: KeyId) {
    return context.aliases.getAlias(keyId)
}

function keyIdOfAlias(alias: string) {
    return context.aliases.getKeyId(alias)
}

type SetAlias = SetAliasOk | SetAliasAlreadyExists | SetAliasTooLong
type SetAliasOk = { type: "ok" }
type SetAliasAlreadyExists = { type: "exists", keyId: KeyId }
type SetAliasTooLong = { type: "tooLong" }

function setAlias(keyId: string, alias: string): SetAlias {
    if (alias.length > 42) return { type: "tooLong" }
    const ekid = context.aliases.getKeyId(alias)
    if (ekid !== undefined && ekid !== keyId) return { type: "exists", keyId: ekid }
    context.aliases.setAlias(keyId, alias)
    return { type: "ok" }
}

function unsetAlias(keyId: string): boolean {
    return context.aliases.unsetAlias(keyId)
}

//#endregion

/**
 * @returns true if anon CI id was not already included
 */
function addYourAnonCi(pk: [string, number]) {
    return context.yourAnonCis.add(pk)
}

/**
 * @returns true if keyId was not already included
 */
function addYourKeyId(kid: string) {
    return context.yourKeyIds.add(kid)
}