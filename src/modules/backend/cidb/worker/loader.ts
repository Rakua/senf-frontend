export {
    VerifyUserCi, VerifyUserCiInvalid, VerifyUserCiValid, LoaderContext, VerifyUserCiParameters,
    loadUserCis, verifyUserCi, crawlArchive, getSizeFromHeader
}

import { Logger } from "../../../libs/basic/logger.js"
import { fromJsonTotal, sleep, throwToReturn, toIsoStringWoMs, toNumber } from "../../../libs/basic/misc.js"
import { BufferedOperation, ConcurrentBufferOperation } from "../../../libs/etc/buffer.js"
import { hasType } from "../../../libs/etc/guard.js"
import { lineIterator, utf8ByteLength } from "../../../libs/etc/misc.js"
import { verifyEd25519JsonSignRequest } from "../../../libs/etc/sdst.js"
import { StreamWithBytesProcessedBeingTracked, unzippedStream } from "../../../libs/etc/stream.js"
import { ManagedWebWorker } from "../../../libs/manager/worker.js"
import { bypassChecks, chains, stubsDisabled } from "../config.js"
import { putUrlsFromCrawl } from "../db/jobs.js"
import { LogCiChecker } from "../db/pci.js"
import { exRecord } from "../db/schema/v1.js"
import { putUserCis, putUserCisMetadata } from "../db/uci.js"
import { ciId, ciMetadata, CiSource, PlatformKey, UserCi, verifyUserCiShape } from "../types/ci.js"
import { categoryFromJob, CrawlJobInDb, LoadFileJobInDb, LoadUrlJobInDb, progress0 } from "../types/job.js"
import { CiWithCategory, LoaderInitData, LoaderInput, LoaderOutput, LoaderProgress, StubUserCi, StubWithCategory } from "../types/misc.js"

//#region types

type LoaderContext = {
    mww: ManagedWebWorker<LoaderInput, LoaderProgress, LoaderOutput, LoaderInitData>,
    parameters: LoaderInitData,
    lcc: LogCiChecker,
    lg: Logger
}

type VerifyUserCiParameters = Pick<LoaderInitData, "keys" | "inaugurationTimestamp" | "serverClientTimeDelta">

type VerifyUserCi = VerifyUserCiValid | VerifyUserCiInvalid
type VerifyUserCiValid = {
    type: "valid",
    ci: UserCi
}
type VerifyUserCiInvalid = {
    type: "invalid",
    code: VerifyUserCiInvalidCode,
    reason: string,
    args: any[]
}

type VerifyUserCiInvalidCode = "INVALID_CHAIN" | "INVALID_STRUCTURE" | "NO_PLATFORM_SIG" | "MULTIPLE_PLATFORM_SIGS" | "TIMESTAMP_BEFORE_INAUG" | "FUTURE_TIMESTAMP"
    | "SIGNING_KEY_NOT_FOUND" | "PLATFORM_KEYID_MISMATCH" | "INVALID_SIGNATURE"
//#endregion

const stubExample: StubUserCi = {
    chain: "",
    seqNo: 0
}

/**
 * Loads user CIs and stubs into cidb
 */
//async function loadUserCis(context: LoaderContext, reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>, source: CiSource, totalBytes: number | null, job: LoadFileJobInDb | LoadUrlJobInDb): Promise<LoaderOutput | undefined> {
async function loadUserCis(context: LoaderContext, stream: ReadableStream, source: CiSource, totalBytes: number | null, job: LoadFileJobInDb | LoadUrlJobInDb): Promise<LoaderOutput | undefined> {
    const lg = context.lg

    const putCis = async (cis: CiWithCategory[]) => {
        const puc = await putUserCis(cis, { type: "job", job: job }, context.parameters.statsTrustLevel)

        //update progress after a put operation has finished
        progress.itemsAdded += puc.added
        progress.itemsSkipped += puc.alreadyExist
        for (const oe of puc.errors) {
            lg.error("Failed to add CI %O because %O", oe.ci, oe.error)
        }
    }

    const putStubs = async (stubs: StubWithCategory[]) => {
        lg.debug("putStubs called with %O", stubs)
        const puc = await putUserCisMetadata(context.lcc, stubs, job)
        lg.debug("putStubs puc: %O", puc)

        //update progress after a put operation has finished
        progress.itemsAdded += puc.added
        progress.itemsSkipped += puc.unverifiable
        for (const oe of puc.errors) {
            lg.error("Failed to add stub %O because %O", oe.stub, oe.error)
        }
    }

    //wait for all put operations to finish and if one has failed throw an error
    const beforeReturn = async () => {
        const promises = [...putCisC.promises(), ...putStubsC.promises()]
        const putResults = await Promise.allSettled(promises)
        const failedPuts = putResults.filter(p => p.status == "rejected")
        if (failedPuts.length > 0) {
            const errs = failedPuts.map(x => x.reason.toString())
            throw new Error("Failed puts: \n" + errs.join("\n"))
        }
    }

    const category = categoryFromJob(job)
    const sourceStr = toSourceStr(source)
    const progress = progress0()
    progress.totalBytes = totalBytes
    const trackStream = new StreamWithBytesProcessedBeingTracked(stream,
        (bytesProcessed) => { progress.bytesProcessed = bytesProcessed }
    )
    const reader = (await unzippedStream(trackStream.stream())).getReader()

    const putCisC = new ConcurrentBufferOperation(putCis)
    const putStubsC = new ConcurrentBufferOperation(putStubs)

    const bufferCis = new BufferedOperation(context.parameters.ciBufferSize, null, putCisC.getBufferOperation())
    const bufferStubs = new BufferedOperation(context.parameters.ciBufferSize, null, putStubsC.getBufferOperation())

    for await (const { line: line, isLast: isLast } of lineIterator(reader, { fatal: true, maxLineLength: context.parameters.maxLineLength })) {
        if (progress.curLine % context.parameters.abortCheckAfterNIterations === context.parameters.abortCheckAfterNIterations - 1) {
            context.mww.progressed(progress)

            //give manager opportunity to abort task
            await sleep(0)
            lg.debug("check for abort")
            if (context.mww.shouldAbort()) {
                //aborted 
                await beforeReturn()
                return undefined
            }
        }

        progress.curLine++

        if (line.trim() == "") continue //skip empty line

        const obj0 = fromJsonTotal(line)
        if (!obj0.ok) {
            //invalid JSON
            const args = [progress.curLine, sourceStr, obj0.error]
            lg.warn("Presumed user CI on line %s in %s is not a valid JSON string: %O", ...args)
            progress.itemsInvalid++
            continue
        }
        const obj = convertUserCiMetadataRecordToStub(obj0.value, lg)

        //check if object is a stub and process accordingly
        if (hasType(obj, stubExample, { value: null })) {
            if (stubsDisabled) {
                lg.debug("Line %s is a stub but ignored since stubs are disabled: %O", progress.curLine, obj)
                progress.itemsInvalid++ //count as invalid
                continue
            }
            lg.debug("Line %s is a stub: %O", progress.curLine, obj)
            await bufferStubs.load({ stub: obj, category: category })
            continue
        }

        //process line as ci
        const ciObj = Object.hasOwn(obj, "ci") ? obj.ci : obj
        const res = await verifyUserCi(context.parameters, ciObj, lg)
        if (res.type == "invalid") {
            const args = [progress.curLine, sourceStr, ...res.args]
            lg.warn("Presumed user CI on line %s in %s is invalid. " + res.reason, ...args)
            progress.itemsInvalid++
            continue
        }

        lg.debug("Add %O to cidb", res.ci)
        await bufferCis.load({ ci: res.ci, category: category })
    }

    //completed
    await bufferCis.flush()
    await bufferStubs.flush()
    await beforeReturn()

    if (progress.totalBytes != null) progress.bytesProcessed = progress.totalBytes
    context.mww.progressed(progress)
    return progress
}

/**
 * Checks shape of ciObj and signature are correct and if timestamp is not
 * in the future or before inauguration.
 */
async function verifyUserCi(parameters: VerifyUserCiParameters, ciObj: any, lg: Logger): Promise<VerifyUserCi> {
    //normalize data.content.signatures = null to empty array
    if (ciObj.data?.content?.signatures === null) ciObj.data.content.signatures = []

    const rv = { value: null }
    if (!verifyUserCiShape(ciObj, rv))
        return { type: "invalid", code: "INVALID_STRUCTURE", reason: "Object has invalid structure (%O)", args: [rv] }

    const ci = ciObj
    const chain = ciMetadata(ci).chain
    if (!chains.includes(chain))
        return { type: "invalid", code: "INVALID_CHAIN", reason: "CI has invalid chain (got %O, expected one of %O)", args: [chain, chains] }

    //time smaller than inauguration time or larger than current server time -> invalid
    const ciTimestamp = ciMetadata(ci).timestamp

    if (ciTimestamp < parameters.inaugurationTimestamp[chain])
        return { type: "invalid", code: "TIMESTAMP_BEFORE_INAUG", reason: "CI has timestamp before inauguration CI (%O)", args: [ciTimestamp] }

    const currentServerTimestamp = Date.now() + parameters.serverClientTimeDelta
    const tsDiff = ciTimestamp.getTime() - currentServerTimestamp
    if (tsDiff > 300000)
        return { type: "invalid", code: "FUTURE_TIMESTAMP", reason: "CI has timestamp after current server time (difference %s ms)", args: [tsDiff] }

    const key = parameters.keys[chain].find(key => key.validFrom <= ciTimestamp && ciTimestamp <= key.validUntil)
    if (key == undefined)
        return { type: "invalid", code: "SIGNING_KEY_NOT_FOUND", reason: "Platform signing key for verifying CI not found (CI timestamp %O)", args: [ciTimestamp] }

    if (key.keyId != ci.signatures[0].keyId)
        return { type: "invalid", code: "PLATFORM_KEYID_MISMATCH", reason: "KeyId of platform signature of CI is not matching expected on (got %s, expected: %s)", args: [key.keyId, ci.signatures[0].keyId] }

    if (ciMetadata(ci).seqNo <= (bypassChecks(chain) ?? 0)) {
        lg.security("Bypassing signature check for CI %O", ci)
        return { type: "valid", ci: ci as UserCi }
    }
    const verify = await verifySignature(ci, key)
    return verify.type == "invalid" ? verify : { type: "valid", ci: ci as UserCi }
}

type VerifySignatureRv = VerifySignatureRvValid | VerifySignatureRvInvalid
type VerifySignatureRvValid = { type: "valid" }
type VerifySignatureRvInvalid = { type: "invalid", code: "INVALID_SIGNATURE", reason: string, args: any[] }

//async function verifySignature(ci: any, key: PlatformKey, useNullSignature: boolean): Promise<VerifySignatureRv> {    
async function verifySignature(ci: any, key: PlatformKey): Promise<VerifySignatureRv> {
    const sr: any = structuredClone(ci)
    const ciMd = ciMetadata(ci)
    const srMd = ciMetadata(sr) as any
    srMd.timestamp = toIsoStringWoMs(ciMd.timestamp)
    //if (useNullSignature) sr.data.content.signatures = null
    sr.signatures[0].publicKey = key.publicKey //add public key for verification
    const sigCheck = await verifyEd25519JsonSignRequest(sr)
    if (!sigCheck.signatures[0].isValid) {
        return {
            type: "invalid",
            code: "INVALID_SIGNATURE",
            reason: "CI has invalid signature (chain: %s, seqNo: %s)",
            args: [ciMd.chain, ciMd.seqNo]
        }
    }

    return { type: "valid" }
}

//does not support href attributes that span multiple lines or not enclosed in double quotes '"'
async function crawlArchive(context: LoaderContext, stream: ReadableStream<Uint8Array<ArrayBufferLike>>, input: CrawlJobInDb, totalBytes: number | null): Promise<LoaderOutput | undefined> {
    const lg = context.lg

    const reader = stream.getReader()
    const absUrl = throwToReturn((href: string) => new URL(href, input.url))
    const put = async (jsonlUrls: string[]) => {
        const puc = await putUrlsFromCrawl(jsonlUrls, input.url)

        //update progress after a put operation has finished
        progress.itemsAdded += puc.added
        progress.itemsSkipped += puc.alreadyExist
        for (const oe of puc.otherErrors) {
            lg.error("Failed to add URL %O from crawl: %O", oe.url, oe.error)
        }
    }

    const progress = progress0()
    progress.totalBytes = totalBytes

    const putC = new ConcurrentBufferOperation(put)
    const buffer = new BufferedOperation(context.parameters.urlBufferSize, null, putC.getBufferOperation())

    for await (const { line: line, isLast: isLast } of lineIterator(reader, { fatal: true, maxLineLength: 300000 })) {
        if (progress.curLine % context.parameters.abortCheckAfterNIterations === context.parameters.abortCheckAfterNIterations - 1) {
            //only update progress each evey n iterations b/c postMessage is expensive
            context.mww.progressed(progress)

            //give manager opportunity to abort task            
            await sleep(0)
            if (context.mww.shouldAbort()) return undefined
        }

        progress.curLine++
        progress.bytesProcessed += utf8ByteLength(line) + (isLast ? 0 : 1)

        //get all href attributes        
        const hrefs = [...line.matchAll(/href\s*=\s*(['"])(.*?)\1/gi)].map(match => match[2])
        for (const href of hrefs) {
            const url0 = absUrl(href)
            if (!url0.ok) {
                progress.itemsInvalid++
                continue
            }
            const url = url0.value
            if (context.parameters.uciFileExtensions.find(ext => url.pathname.endsWith(ext)) === undefined) {
                //progress.itemsInvalid++
                continue
            }

            buffer.load(url.href)
        }
    }

    await buffer.flush()
    await Promise.allSettled(putC.promises())

    //completed
    context.mww.progressed(progress)
    return progress
}

//#region helpers
function getSizeFromHeader(resp: Response): number | null {
    if (resp.headers.has("Content-Length")) {
        const x = toNumber(resp.headers.get("Content-Length") ?? "")
        if (x !== null) return x
    } else if (resp.headers.has("File-Size")) {
        const x = toNumber(resp.headers.get("File-Size") ?? "")
        if (x !== null) return x
    } else if (resp.headers.has("X-File-Size")) {
        const x = toNumber(resp.headers.get("X-File-Size") ?? "")
        if (x !== null) return x
    }
    return null
}

function toSourceStr(source: CiSource) {
    let sourceStr: string
    if (source.type == "file") {
        sourceStr = `local file ${source.filename}`
    } else if (source.type == "post") {
        sourceStr = `post`
    } else {
        if (source.archiveUrl == "") {
            sourceStr = `URL ${source.url}`
        } else {
            sourceStr = `URL ${source.url} from archive ${source.archiveUrl}`
        }
    }
    return sourceStr
}

/**
 * If an object is a userCiMetadata record and contains a location or a poster
 * then convert it to a stub object. 
 * 
 * This is useful when loading an exported db file since its userCiMetadata records
 * are converted to stubs automatically. By loading an exported db file instead of
 * importing it the categories, jobs and platform CIs are ignored.
 */
function convertUserCiMetadataRecordToStub(obj: any, lg: Logger) {
    const rv = { value: null }
    if (hasType(obj, exRecord.t_userCiMetadata, rv) && !Object.hasOwn(obj.ci.data, "content")) {
        const ciMd = ciMetadata(obj.ci)
        const location = ciMd.location
        const poster = obj.poster
        if (location !== undefined || poster !== undefined) {
            const stub = {
                chain: ciMd.chain,
                seqNo: ciMd.seqNo,
                location: location,
                poster: poster
            }
            lg.debug("converting userCiMetadata record to stub %O => %O", obj, stub)
            return stub
        }
    }

    return obj
}
//#endregion
