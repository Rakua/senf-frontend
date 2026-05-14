export {
    Archive, StubUserCi, StubWithCategory, CiWithCategory,
    LoaderInitData, LoaderInput, LoaderProgress, LoaderOutput, ComputerInitData, ComputerMessage,
    StatsTrustLevel, Uri, extractScheme, isUserCiPrimaryKey
}

import { MutedData } from "../../../libs/basic/logger.js"
import { splitAt } from "../../../libs/basic/misc.js"
import { hasType, tupleType } from "../../../libs/etc/guard.js"
import { AnonPoster, UserCiPrimaryKey } from "../db/schema/v1.js"
import { KeyId, PlatformKey, UserChain, UserCi } from "./ci.js"
import { JobInDb, JobProgress } from "./job.js"

type Uri = string // scheme:rest

type Archive = {
    url: string
}

type StubUserCi = {
    chain: string,
    seqNo: number,
    location?: string,
    poster?: KeyId | AnonPoster
}

type StubWithCategory = {
    stub: StubUserCi,
    category?: string
}

type CiWithCategory = {
    ci: UserCi,
    category?: string
}


//#region worker types
type LoaderInput = JobInDb
type LoaderProgress = JobProgress
type LoaderOutput = JobProgress
type LoaderInitData = {
    keys: Record<UserChain, PlatformKey[]>, // indexed by chain
    inaugurationTimestamp: Record<UserChain, Date>,
    serverClientTimeDelta: number, //server time - client time; add to client time to get approx server time        
    uciFileExtensions: string[], //file extensions 

    abortCheckAfterNIterations: number,
    ciBufferSize: number,
    urlBufferSize: number,
    maxLineLength: number,
    maxCrawledUrlSize: number,

    statsTrustLevel: StatsTrustLevel,

    mutedData: MutedData
}

type StatsTrustLevel = "trustSignature" | "trustFromPostModule" | "trustLogCi"

type ComputerMessage = ComputerMessageInit | ComputerMessageWork
type ComputerMessageInit = {
    type: "init",
    data: ComputerInitData
}
type ComputerMessageWork = { type: "work" }

type ComputerInitData = {
    limit: number,
    serverClientTimeDelta: number,
    timeBetweenLogCis: number, //time between log CIs (2h)
    sleepIntv: number,
    mutedData: MutedData
}
//#endregion

function extractScheme(uri: Uri) {
    const x = splitAt(uri, ":")
    if (!x.found) {
        throw new Error("No ':' in URI " + JSON.stringify(uri))
    }
    return x.left
}


function isUserCiPrimaryKey(x: any): x is UserCiPrimaryKey {
    return hasType(x, tupleType("", 0), { value: null })
}