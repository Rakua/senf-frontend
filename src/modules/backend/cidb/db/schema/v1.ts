export {
    SchemaV1, PlatformCiRecord, UserCiRecord, UserCiMetadataRecord, FakeUserCiRecord, JobRecord, CategoryRecord,
    PosterRecord, LocationRecord, Stats, CiStats, StatisticsStatus,
    PrimaryKeyOf, UserCiPrimaryKey, CategoryRecordSourceType,
    AnonPoster, Unknown,
    schemaV1, anonPoster, unknown, statisticStatus, defaultCategory, posterIsKeyId, exRecord
}

import { MakeOptional } from "../../../../libs/basic/misc.js"
import { EntityTable, Table } from "../../../../libs/dexie/dexie.js"
import { intersectionType, literalType, optionalType, unionType } from "../../../../libs/etc/guard.js"
import { UserCi, PlatformCi, KeyId, UserCiMetadata, userCiExample, userCiExampleWithoutContent, platformCiExample } from "../../types/ci.js"
import { JobProgress, JobStatus, jobStatusT, JobSubjectDb } from "../../types/job.js"
import { Uri } from "../../types/misc.js"

type PseudoBoolean = 0 | 1 //use for indexed boolean columns since booleans cannot be indexed
type Unknown = typeof unknown
type AnonPoster = typeof anonPoster
type StatisticsStatus = typeof statisticStatus[keyof typeof statisticStatus]

type PrimaryKeyOf<T extends keyof SchemaV1> = NonNullable<PrimaryKeyOf_InferPk<SchemaV1[T]>>
type PrimaryKeyOf_InferPk<T> = T extends Table<any, infer PK> ? PK : never

type UserCiPrimaryKey = PrimaryKeyOf<"t_userCi"> //[chain, seqNo]
//type CategoryRecordSourceType = "archive" | "url" | "file"
type CategoryRecordSourceType = typeof categoryRecordSourceTypeT[number]

const categoryRecordSourceTypeT = ["archive", "url", "file"] as const

const anonPoster = "anon" as const
const unknown = "?" as const
const defaultCategory = "[" as const
const statisticStatus = {
    UnknownOrUnverified: 0,
    VerifiedAndUnused: 1,
    VerifiedAndUsed: 2 //either because it was used in a stats update or info was already used in previous update
} as const

/**
 * Determines if a poster column from t_location or t_userCiMetadata contains a keyId
 */
function posterIsKeyId(poster: string | undefined) {
    return poster !== undefined && poster !== anonPoster && poster !== unknown
}

//poster kind for location and for userci table in entity


//#region tables
interface PlatformCiRecord {
    ci: PlatformCi,
    addedOn: Date
}

type UserCiRecord = UserCiRecord0<UserCi> & {
    /*
        Used to determine if this CI was already added to the loaded
        stats of the corresponding entries in t_location and t_poster
        or should be used in next update
    */
    loadedStatus: StatisticsStatus
}

/**
 * Contains only information from stubs that have been verified against a 
 * platform log CI. Can be queried for echo CIs in addition to UserCiRecord.
 * 
 * The field fromPostModule is always 0 (false) since stubs cannot come 
 * from the post module.
 * 
 * todo: the field catIds must be synced to t_userCi periodically
 */
type UserCiMetadataRecord = MakeOptional<UserCiRecord0<UserCiMetadata>, 'poster'>

type UserCiRecord0<T extends UserCi | UserCiMetadata> = {
    ci: T,

    poster: KeyId | AnonPoster, //set poster as property for indexing
    addedOn: Date,

    fromPostModule: PseudoBoolean,
    fromExternal: PseudoBoolean,
    jobIds: number[], //jobs that contained this user CI or stub
    catIds: number[],  //categories associated with this user CI

    logCiSeqNo: number, //seq no of platform/log CI it is contained in; 0 => not checked yet  

    /*
        Used to determine if location/poster was already added to stats (2) 
        or should be used in next update (1)
    */
    locationStatus: StatisticsStatus,
    posterStatus: StatisticsStatus
}

/**
 * User CIs that fail verification (hash in log does not match) are moved
 * here from UserCiRecord. Existence of a record in this table implies that 
 * the platform's signing key is compromised or a wrong key was used for
 * verification (e.g. due to server settings). 
 */
interface FakeUserCiRecord extends UserCiRecord {
    id?: number
}

/**
 * User CIs can be assigned a category by its source to facilitate browsing.
 * A category should contain only lowercase letters, hyphens and periods as 
 * separators for subcategories like newsgroup names.
 *
 * A category can be assigned to a set of CIs by prefixing the JSONL file
 * containing them with "[$CAT_NAME]", e.g. "[comp.ai]_2025-10-20.jsonl".
 * 
 * A category entry includes what type of source it came from (sourceType) 
 * and the source itself. If a category came from  
 * - an archive, the source is the archive url
 * - a URL, the source is the URL
 * - a file, the source is the filename
 */
interface CategoryRecord {
    catId?: number,
    category: string,
    source: string, //archive url, local file filename, manual url
    sourceType: CategoryRecordSourceType,
    addedOn: Date
}

interface Stats {
    global: CiStats,
    loaded: CiStats,

    echoSum: number,
    echoMax: number,
    echoAvg: number
}

interface CiStats {
    /**
     * For a PosterRecord ciCount means the number of CIs by that poster
     * For a LocationRecord ciCount means the number of CIs for that location
     */
    ciCount: number,
    postCount: number,
    echoCount: number,

    firstCi?: Date,     //undefined may mean unknown or no post exists
    firstPost?: Date,
    firstEcho?: Date,

    lastCi?: Date,
    lastPost?: Date,
    lastEcho?: Date
}

interface LocationRecord extends Stats {
    location: Uri,
    scheme: string,
    parent: Uri | Unknown | undefined //parent location; only defined for CIs 
    poster: KeyId | AnonPoster | Unknown | undefined, //only defined for CIs   

    catIds: number[]
}

interface PosterRecord extends Stats {
    keyId: KeyId,
    publicKey?: string, //undefined => unknown (no CI from them or not udpated yet)

    //waited by this poster for his own CIs
    waitingTimeSum: number,
    waitingTimeMax: number,
    waitingTimeAvg: number

    totalEchoSum: number, //echoSum + waitingTimeSum
    totalEchoMax: number,
    totalEchoAvg: number, //totalEchoSum / (ciCount+receivedEchoCount)

    receivedEchoCount: number //sum of echoCount over all CIs by that poster

    catIds: number[]    
}

interface JobRecord {
    jobId?: number,
    subject: JobSubjectDb,

    addedOn: Date,
    updatedOn: Date

    progress: JobProgress,
    status: JobStatus,
    /**
     * Used to prevent from calling manager.newTask twice for the same job, i.e.
     * once from queryHandler() and once from addWaitingJobs(). Is set to true
     * only for tasks received by the query handler. When a page is reloaded
     * the queryHandlerLock of all unfinished jobs is set to false. 
     */
    queryHandlerLock: boolean,    

    failedError?: Error, //if status is failed, store failed error here
    // catch by listening to manager events of type failed and write to db

    usedInStats: PseudoBoolean //used to determine if catIds and jobIds for 
    //t_location and t_poster were already computed from this job
    //if job is of type crawl then it is true
}
//#endregion

//#region indexes
const platformCiIndexes = [
    '[ci.data.metadata.chain+ci.data.metadata.seqNo]',
    'ci.data.metadata.chain',
    'ci.data.metadata.timestamp',
    'ci.data.metadata.type',
    'addedOn'
]

const userCiIndexes = [
    '[ci.data.metadata.chain+ci.data.metadata.seqNo]',
    'ci.data.metadata.type', //used for counting
    'ci.data.metadata.location',
    'ci.data.metadata.timestamp',
    'poster',

    'addedOn',
    'fromPostModule',
    'fromExternal',
    '*jobIds',
    '*catIds',

    'logCiSeqNo', // != 0 => hash verified against platform log CI
    'locationStatus',
    'posterStatus'
]

const fakeUserCiIndexes = ['++id']

const categoryIndexes = [
    '++catId',
    'category',
    '[source+sourceType]',
    '&[category+source+sourceType]' //must be unique
]

const ciStatsIndexes = [
    'ciCount',
    'postCount',
    'echoCount',

    'firstCi',
    'firstPost',
    'firstEcho',

    'lastCi',
    'lastPost',
    'lastEcho'
]

const statsIndexes = ['echoSum', 'echoMax', 'echoAvg'].concat(
    ciStatsIndexes.map(x => "global." + x),
    ciStatsIndexes.map(x => "loaded." + x)
)

const catIdsIndexed = ['*jobIds','*catIds']

const locationIndexes = ['location', 'scheme', 'parent', 'poster'].concat(statsIndexes, catIdsIndexed)
const posterIndexes = [
    'keyId', 'waitingTimeSum', 'waitingTimeMax', 'waitingTimeAvg',
    'totalEchoSum', 'totalEchoMax', 'totalEchoAvg', 'receivedEchoCount'
].concat(statsIndexes, catIdsIndexed)

const jobRecordIndexes = [
    '++jobId',
    'updatedOn',
    '&[subject.url+subject.archiveUrl]',

    //not needed?
    'subject.filename',
    'subject.url',
    'subject.archiveUrl',
    'addedOn',
    'status',
    'usedInStats'
]
//#endregion

type SchemaV1 = {
    t_platformCi: Table<PlatformCiRecord, [string, number]>,
    t_userCi: Table<UserCiRecord, [string, number]>,
    t_userCiMetadata: Table<UserCiMetadataRecord, [string, number]>,
    t_fakeUserCi: Table<FakeUserCiRecord, number>,

    t_category: EntityTable<CategoryRecord, 'catId'>,
    t_location: Table<LocationRecord, string>,
    t_poster: Table<PosterRecord, string>, //indexed by keyid

    t_job: EntityTable<JobRecord, 'jobId'>
}

const schemaV1 = {
    t_platformCi: platformCiIndexes.join(","),
    t_userCi: userCiIndexes.concat(["loadedStatus"]).join(","),
    t_userCiMetadata: userCiIndexes.join(","), //same indexes as t_userCi
    t_fakeUserCi: fakeUserCiIndexes.join(","),

    t_category: categoryIndexes.join(","),
    t_location: locationIndexes.join(","),
    t_poster: posterIndexes.join(","),

    t_job: jobRecordIndexes.join(",")
}

//#region record types as values
const exPseudoBoolean = literalType(0, 1)

const exJobRecordSubject = unionType(
    { filename: "" }, //file upload
    { url: "" }, //manual url 
    { url: "", archiveUrl: "" }, //get url from crawl job
    { archiveUrl: "" } //crawl job
)

const exJobRecord = {
    jobId: 0,
    subject: exJobRecordSubject,
    addedOn: new Date(),
    updatedOn: new Date(),
    progress: {
        itemsAdded: 0,
        itemsSkipped: 0,
        itemsInvalid: 0,
        curLine: 0,
        bytesProcessed: 0,
        totalBytes: unionType(0, null)
    },
    status: literalType(...jobStatusT),
    queryHandlerLock: false,
    usedInStats: 0
}

const exCategoryRecord = {
    catId: 0,
    category: "",
    source: "",
    sourceType: literalType(...categoryRecordSourceTypeT),
    addedOn: new Date()
}

const exPlatformCiRecord = {
    ci: platformCiExample,
    addedOn: new Date()
}

const exUserCiCommonRecord = {
    addedOn: new Date(),

    fromPostModule: exPseudoBoolean,
    fromExternal: exPseudoBoolean,
    jobIds: [0],
    catIds: [0],

    logCiSeqNo: 0,

    locationStatus: literalType(...Object.values(statisticStatus)),
    posterStatus: literalType(...Object.values(statisticStatus))
}

const exUserCiRecord = intersectionType(exUserCiCommonRecord, {
    //ci: userCiEx,
    ci: userCiExample,
    poster: ""
})

const exUserCiMetadataRecord = intersectionType(exUserCiCommonRecord, {
    ci: userCiExampleWithoutContent,
    poster: optionalType("")
})

const exFakeUserCiRecord = intersectionType(exUserCiRecord, {
    id: 0
})

//todo: use correct type predicate for ci 
const exRecord = {
    t_platformCi: exPlatformCiRecord,
    t_userCi: exUserCiRecord,
    t_userCiMetadata: exUserCiMetadataRecord,
    t_fakeUserCi: exFakeUserCiRecord,

    t_category: exCategoryRecord,
    t_job: exJobRecord
} as const

//#endregion
