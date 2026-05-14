export { PrimaryKeyOfEntity, PropertyContext, entities, entityMainTable }

import { db } from "./schema/db.js"
import { ciBody, CiId, ciMetadata, ciPostTime, ciPrimaryKey, ciWaitingTime, toCiUrn, UserCi, UserCiPost } from "../types/ci.js"
import { anonPoster, CategoryRecord, JobRecord, LocationRecord, PosterRecord, PrimaryKeyOf, Stats, unknown, UserCiMetadataRecord, UserCiPrimaryKey, UserCiRecord } from "./schema/v1.js"
import { arrayToMap, distinctArray } from "../../../libs/basic/misc.js"
import { Aliases, YourAnonCis, YourKeyIds } from "../personal.js"

//#region types
type PropertyContext = {
    yourAnonCis: YourAnonCis,
    yourKeyIds: YourKeyIds,
    aliases: Aliases
}

type PosterKind = "keyid" | "anon" | "unknown"

type PrimaryKeyOfEntity<E extends keyof EntityMainTable> = PrimaryKeyOf<EntityMainTable[E]>
type EntityMainTable = typeof entityMainTable

type JoinedCiRecord<T extends UserCiRecord | UserCiMetadataRecord> = {
    userCiRecord: T,
    locationRecord: LocationRecord | undefined,
    posterRecord: PosterRecord | undefined,
    categoryRecords: CategoryRecord[],
    jobRecords: JobRecord[]
}

type PostEntityRecord = JoinedCiRecord<UserCiRecord>
type EchoEntityRecord = JoinedCiRecord<UserCiRecord> | JoinedCiRecord<UserCiMetadataRecord>
type CiEntityRecord = PostEntityRecord | EchoEntityRecord

type CiMetadataEntityRecord = JoinedCiRecord<UserCiRecord> | JoinedCiRecord<UserCiMetadataRecord>

//used to assert which projections cannot return undefined for PostEntitiyRecord 
type CiPropertiesInPost = typeof ciProperties & {
    location: { projection: (x: CiEntityRecord) => string },
    poster: { projection: (x: CiEntityRecord) => string },
    ci: { projection: (x: CiEntityRecord) => UserCi },
    isSigned: { projection: (x: CiEntityRecord) => boolean },
    metadataOnly: { projection: (x: CiEntityRecord) => false }
}

type FetchJoinedCiRecordsTable = "t_userCi" | "t_userCiMetadata"
type FetchJoinedCiRecordsJcr<T extends FetchJoinedCiRecordsTable> =
    T extends "t_userCi" ? UserCiRecord : UserCiMetadataRecord

//#endregion

//#region entity definitions
const entityMainTable = {
    "post": "t_userCi",
    "echo": "t_userCi",
    "poster": "t_poster",
    "location": "t_location",
    "ciMetadata": "t_userCi"
} as const

const statsProperties = {
    echoSum: { index: "echoSum", projection: (x: Stats) => x.echoSum },
    echoMax: { index: "echoMax", projection: (x: Stats) => x.echoMax },
    echoAvg: { index: "echoAvg", projection: (x: Stats) => x.echoAvg },

    ciCount: { index: "global.ciCount", projection: (x: Stats) => x.global.ciCount },
    postCount: { index: "global.postCount", projection: (x: Stats) => x.global.postCount },
    echoCount: { index: "global.echoCount", projection: (x: Stats) => x.global.echoCount },

    firstCi: { index: "global.firstCi", projection: (x: Stats) => x.global.firstCi },
    firstPost: { index: "global.firstPost", projection: (x: Stats) => x.global.firstPost },
    firstEcho: { index: "global.firstEcho", projection: (x: Stats) => x.global.firstEcho },

    lastCi: { index: "global.lastCi", projection: (x: Stats) => x.global.lastCi },
    lastPost: { index: "global.lastPost", projection: (x: Stats) => x.global.lastPost },
    lastEcho: { index: "global.lastEcho", projection: (x: Stats) => x.global.lastEcho },

    loadedCiCount: { index: "loaded.ciCount", projection: (x: Stats) => x.loaded.ciCount },
    loadedPostCount: { index: "loaded.postCount", projection: (x: Stats) => x.loaded.postCount },
    loadedEchoCount: { index: "loaded.echoCount", projection: (x: Stats) => x.loaded.echoCount },

    loadedFirstCi: { index: "loaded.firstCi", projection: (x: Stats) => x.loaded.firstCi },
    loadedFirstPost: { index: "loaded.firstPost", projection: (x: Stats) => x.loaded.firstPost },
    loadedFirstEcho: { index: "loaded.firstEcho", projection: (x: Stats) => x.loaded.firstEcho },

    loadedLastCi: { index: "loaded.lastCi", projection: (x: Stats) => x.loaded.lastCi },
    loadedLastPost: { index: "loaded.lastPost", projection: (x: Stats) => x.loaded.lastPost },
    loadedLastEcho: { index: "loaded.lastEcho", projection: (x: Stats) => x.loaded.lastEcho }
} as const

const locationProperties = {
    ...statsProperties,
    location: { index: "location", projection: (x: LocationRecord) => x.location },
    scheme: { index: "scheme", projection: (x: LocationRecord) => x.scheme },
    parent: { index: "parent", projection: (x: LocationRecord) => x.parent },
    poster: { index: "poster", projection: (x: LocationRecord) => x.poster },

    posterKind: { index: "poster", projection: posterKindProjLocation },

    catIds: {index: "catIds", projection: (x: LocationRecord) => x.catIds},
} as const

const posterProperties = {
    ...statsProperties,

    waitingTimeSum: { index: "waitingTimeSum", projection: (x: PosterRecord) => x.waitingTimeSum },
    waitingTimeMax: { index: "waitingTimeMax", projection: (x: PosterRecord) => x.waitingTimeMax },
    waitingTimeAvg: { index: "waitingTimeAvg", projection: (x: PosterRecord) => x.waitingTimeAvg },

    totalEchoSum: { index: "totalEchoSum", projection: (x: PosterRecord) => x.totalEchoSum },
    totalEchoMax: { index: "totalEchoMax", projection: (x: PosterRecord) => x.totalEchoMax },
    totalEchoAvg: { index: "totalEchoAvg", projection: (x: PosterRecord) => x.totalEchoAvg },

    receivedEchoCount: { index: "receivedEchoCount", projection: (x: PosterRecord) => x.receivedEchoCount },

    keyId: { index: "keyId", projection: (x: PosterRecord) => x.keyId },
    publicKey: { index: "publicKey", projection: (x: PosterRecord) => x.publicKey },
    alias: { projection: (x: PosterRecord, y: PropertyContext) => y.aliases.getAlias(x.keyId) },

    catIds: {index: "catIds", projection: (x: PosterRecord) => x.catIds},
} as const

const ciProperties = {
    location: { index: "ci.data.metadata.location", projection: (x: CiEntityRecord) => ciMetadata(x.userCiRecord.ci).location },
    postedOn: { index: "ci.data.metadata.timestamp", projection: (x: CiEntityRecord) => ciPostTime(x.userCiRecord.ci) },
    poster: { index: "poster", projection: (x: CiEntityRecord) => x.userCiRecord.poster },
    addedOn: { index: "addedOn", projection: (x: CiEntityRecord) => x.userCiRecord.addedOn },            
    fromPostModule: { index: "fromPostModule", projection: (x: CiEntityRecord) => x.userCiRecord.fromPostModule },        
    jobIds: { index: "jobIds", projection: (x: CiEntityRecord) => x.userCiRecord.jobIds },

    //use this to determine if a CI comes from a certain job
    firstJobId: { projection: (x: CiEntityRecord) => x.userCiRecord.fromExternal === 1 ? undefined : x.userCiRecord.jobIds[0]},
    // fromExternal: { projection: (x: CiEntityRecord) => x.userCiRecord.fromExternal },

    catIds: { index: "catIds", projection: (x: CiEntityRecord) => x.userCiRecord.catIds },

    posterKind: { index: "poster", projection: posterKindProjUserCi },

    isSigned: { projection: isSignedProj },
    keyId: { projection: (x: CiEntityRecord) => x.userCiRecord.poster !== undefined && x.userCiRecord.poster !== anonPoster ? x.userCiRecord.poster : undefined },
    alias: { projection: (x: CiEntityRecord, y: PropertyContext) => x.userCiRecord.poster == undefined ? undefined : y.aliases.getAlias(x.userCiRecord.poster) },
    isYou: { projection: isYouProj },

    /**
     * Undefined if poster is anon or unknown. Otherwise, true iff keyid has an alias.
     */
    hasAlias: { projection: (x: CiEntityRecord, y: PropertyContext) => posterKindProjUserCi(x) == "keyid" ? y.aliases.hasAlias(x.userCiRecord.poster!) : undefined },

    scheme: { projection: (x: CiEntityRecord) => ciMetadata(x.userCiRecord.ci).location == undefined ? undefined : new URL(ciMetadata(x.userCiRecord.ci).location).protocol.slice(0, -1) },

    waitingTime: { projection: (x: CiEntityRecord) => ciWaitingTime(x.userCiRecord.ci as UserCi) },
    maxWaitingTime: { projection: (x: CiEntityRecord) => Math.max((x.locationRecord?.echoMax ?? 0), ciWaitingTime(x.userCiRecord.ci as UserCi)) }, //does this include waiting time?
    totalWaitingTime: { projection: (x: CiEntityRecord) => (x.locationRecord?.echoSum ?? 0) + ciWaitingTime(x.userCiRecord.ci as UserCi) }, //does this include waiting time?

    echoMax: { projection: (x: CiEntityRecord) => x.locationRecord?.echoMax },
    echoSum: { projection: (x: CiEntityRecord) => x.locationRecord?.echoSum }, //does this include waiting time?
    postCount: { projection: (x: CiEntityRecord) => x.locationRecord?.global.postCount },
    loadedPostCount: { projection: (x: CiEntityRecord) => x.locationRecord?.loaded.postCount },
    lastReply: { projection: (x: CiEntityRecord) => x.locationRecord?.loaded.lastPost },

    categories: { projection: (x: CiEntityRecord) => x.categoryRecords.map(r => r.category) },
    archives: { projection: (x: CiEntityRecord) => x.jobRecords.map(r => r.subject.archiveUrl).filter(x => x != undefined) },
    fromLocalFile: { projection: (x: CiEntityRecord) => x.jobRecords.find(r => r.subject.filename != undefined) != undefined },
    fromUrl: { projection: (x: CiEntityRecord) => x.jobRecords.find(r => r.subject.url != undefined && r.subject.archiveUrl == undefined) != undefined },

    ci: { projection: (x: CiEntityRecord) => (x.userCiRecord.ci.data as any).content != undefined ? x.userCiRecord.ci as UserCi : undefined },
    ciMetadata: { projection: (x: CiEntityRecord) => ciMetadata(x.userCiRecord.ci) },
    ciId: { projection: (x: CiEntityRecord) => ({ chain: ciMetadata(x.userCiRecord.ci).chain, seqNo: ciMetadata(x.userCiRecord.ci).seqNo } as CiId) },
    ciType: { index: "ci.data.metadata.type", projection: (x: CiEntityRecord) => ciMetadata(x.userCiRecord.ci).type },
    ciUrn: { projection: (x: CiEntityRecord) => (toCiUrn({ chain: ciMetadata(x.userCiRecord.ci).chain, seqNo: ciMetadata(x.userCiRecord.ci).seqNo } as CiId)) },
    ciPk: { projection: (x: CiEntityRecord) => ([ciMetadata(x.userCiRecord.ci).chain, ciMetadata(x.userCiRecord.ci).seqNo] as UserCiPrimaryKey) },

    //false iff the record came from t_userCi; otherwise it came from t_userCiMetadata
    metadataOnly: { projection: (x: CiEntityRecord) => (x.userCiRecord.ci.data as any).content == undefined },

    ciInDb: { projection: (x: CiEntityRecord) => (x.userCiRecord.ci.data as any).content != undefined }
} as const

const postProperties = {
    ...(ciProperties as CiPropertiesInPost),
    content: { projection: (x: CiEntityRecord) => ciBody(x.userCiRecord.ci as UserCiPost) }
} as const

const echoProperties = ciProperties
const ciMetadataProperties = ciProperties

const entities = {
    post: {
        properties: postProperties,
        fetch: fetchPostEntities,
    },
    echo: {
        properties: echoProperties,
        fetch: fetchEchoEntities
    },
    ciMetadata: {
        properties: ciMetadataProperties,
        fetch: fetchCiMetadataEntities
    },
    poster: {
        properties: posterProperties,
        fetch: fetchPosterEntities
    },
    location: {
        properties: locationProperties,
        fetch: fetchLocationEntities
    }
} as const
//#endregion

//#region projections
function isSignedProj(x: CiEntityRecord): boolean | undefined {
    return x.userCiRecord.poster == undefined
        ? undefined
        : (x.userCiRecord.poster != anonPoster)
}

/**
 * @returns undefined if poster is unknown (record from t_userCiMetadata)
 */
function isYouProj(x: CiEntityRecord, y: PropertyContext): boolean | undefined {
    return x.userCiRecord.poster == undefined ? undefined
        : (x.userCiRecord.poster != anonPoster
            ? y.yourKeyIds.contains(x.userCiRecord.poster)
            : y.yourAnonCis.contains(ciPrimaryKey(x.userCiRecord.ci)))
}

function posterKindProjLocation(x: LocationRecord): PosterKind | undefined {
    if (x.poster === undefined) return undefined
    if (x.poster == anonPoster) return "anon"
    if (x.poster == unknown) return "unknown"
    return "keyid"
}

function posterKindProjUserCi(x: CiEntityRecord): PosterKind {
    if (x.userCiRecord.poster == undefined) return "unknown"
    if (x.userCiRecord.poster == anonPoster) return "anon"
    return "keyid"
}
//#endregion

//#region fetch entities
async function fetchPostEntities(keys: UserCiPrimaryKey[]): Promise<(PostEntityRecord | undefined)[]> {
    return await fetchJoinedCiRecords("t_userCi", keys)
}

async function fetchEchoEntities(keys: UserCiPrimaryKey[]): Promise<(EchoEntityRecord | undefined)[]> {
    const res1 = await fetchJoinedCiRecords("t_userCi", keys)
    const res2 = await fetchJoinedCiRecords("t_userCiMetadata", keys)
    const res: (EchoEntityRecord | undefined)[] = []
    for (let i = 0; i < keys.length; i++) {
        res.push(res1[i] ?? res2[i])
    }
    return res
}

async function fetchCiMetadataEntities(keys: UserCiPrimaryKey[]): Promise<(CiMetadataEntityRecord | undefined)[]> {
    const res1 = await fetchJoinedCiRecords("t_userCi", keys)
    const res2 = await fetchJoinedCiRecords("t_userCiMetadata", keys)
    const res: (CiMetadataEntityRecord | undefined)[] = []
    for (let i = 0; i < keys.length; i++) {
        res.push(res1[i] ?? res2[i])
    }
    return res
}

async function fetchPosterEntities(keys: PrimaryKeyOfEntity<"poster">[]) {
    return await db.t_poster.bulkGet(keys)
}

async function fetchLocationEntities(keys: PrimaryKeyOfEntity<"location">[]) {
    return await db.t_location.bulkGet(keys)
}

/**
 * Returns joined record for keys. If a key was not found the corresponding entry in
 * the returned array is undefined.
 */
async function fetchJoinedCiRecords<T extends "t_userCi" | "t_userCiMetadata">(table: T, keys: UserCiPrimaryKey[]): Promise<(JoinedCiRecord<FetchJoinedCiRecordsJcr<T>> | undefined)[]> {
    return await db.transaction("r", [db[table], db.t_location, db.t_poster, db.t_category, db.t_job], async () => {
        type S = FetchJoinedCiRecordsJcr<T>
        const ciRecords0 = await db[table].bulkGet(keys) as (S | undefined)[]
        const ciRecords = ciRecords0.filter(rec => rec !== undefined)

        const urns = keys.map(([c, s]) => toCiUrn({ chain: c, seqNo: s }))
        const ciRecordsPosters = ciRecords.map(ci => ci.poster).filter(x => x != undefined && x != anonPoster) as string[]
        const keyIds = distinctArray(ciRecordsPosters) as string[]
        const jobIds = distinctArray(ciRecords.flatMap(rec => rec.jobIds))
        const catIds = distinctArray(ciRecords.flatMap(rec => rec.catIds))

        //location of ciRecords0[i] is in locationRecords0[i]
        const locationRecords0 = await db.t_location.bulkGet(urns)
        const posterRecords = (await db.t_poster.bulkGet(keyIds)).filter(x => x != undefined)
        const jobRecords = (await db.t_job.bulkGet(jobIds)).filter(x => x != undefined)
        const catRecords = (await db.t_category.bulkGet(catIds)).filter(x => x != undefined)

        const posterMap = arrayToMap(posterRecords, x => x.keyId)
        const jobMap = arrayToMap(jobRecords, x => x.jobId!)
        const catMap = arrayToMap(catRecords, x => x.catId!)

        const res: (JoinedCiRecord<FetchJoinedCiRecordsJcr<T>> | undefined)[] = []
        for (let i = 0; i < ciRecords0.length; i++) {
            const rec = ciRecords0[i]
            if (rec == undefined) {
                //key not found
                res.push(undefined)
                continue
            }
            res.push({
                userCiRecord: rec,
                locationRecord: locationRecords0[i],
                posterRecord: rec.poster != undefined ? posterMap.get(rec.poster) : undefined,
                categoryRecords: rec.catIds.map(catId => catMap.get(catId)).filter(x => x != undefined),
                jobRecords: rec.jobIds.map(jobId => jobMap.get(jobId)).filter(x => x != undefined)
            })
        }
        return res
    })
}
//#endregion
