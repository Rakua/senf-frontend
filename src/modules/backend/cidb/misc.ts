export { fetchPlatformCis, platformChain, isVerifiedUserCi, normalizeLocation, getCiSourcesAndCategories }

import { BufferedOperation, ConcurrentBufferOperation } from "../../libs/etc/buffer.js"
import { proxiedFetch } from "../../libs/etc/fetch.js"
import { lineIterator } from "../../libs/etc/misc.js"
import { ciMetadata, PlatformCi } from "./types/ci.js"
import { lg } from "./config.js"
import { putPlatformCis } from "./db/pci.js"
import { defaultCategory, UserCiPrimaryKey, UserCiRecord } from "./db/schema/v1.js"
import { fromJson } from "../../libs/basic/misc.js"
import { getJobsAndCatsByCi } from "./db/jobs.js"
import { toJobSubject } from "./types/job.js"
import { getCategories } from "./db/category.js"

const bufferSize = 1000
const bufferLength = 262144 //256kB

function platformChain(chain: string) {
    return chain + "p"
}

function isVerifiedUserCi(uci: UserCiRecord) {
    return uci.logCiSeqNo > 0
}

/**
 * Fetches all platform CIs for `chain` starting from seq. no. `startSeqNo` 
 * and loads them into the database. Returns an array of promises that resolve 
 * when all writing operations to the database finished.
 */
async function fetchPlatformCis(chain: string, startSeqNo: number) {
    const endReachedStatus = 416
    const pChain = platformChain(chain)
    const url = "https://" + chain + ".senf.in/pci?start="
    const put = async (pcis: PlatformCi[]) => await putPlatformCis(pcis)
    const putC = new ConcurrentBufferOperation(put)
    const buffer = new BufferedOperation(bufferSize, bufferLength, putC.getBufferOperation())

    while (true) {
        lg.log("Fetching platform CIs (%s) starting from seq. no. %O", pChain, startSeqNo)

        try {
            const resp = await proxiedFetch(url + startSeqNo)
            const statusType = Math.floor(resp.status / 100)
            if (resp.status == endReachedStatus) {
                lg.log("Last platform CI has seq. no. %s", startSeqNo - 1)
                break
            }
            if (statusType != 2) {
                lg.error("Unexpected server status code %s (expected 2xx)", resp.status)
                break
            }
            if (resp.body == null) {
                lg.error("Variable resp.body is null")
                break
            }

            const reader = resp.body.getReader()
            let lineNo = 1
            let lastCi
            for await (const { line: line, isLast: isLast } of lineIterator(reader)) {
                if (line.trim() == "") continue //skip empty lines            
                try {
                    lastCi = fromJson(line) as PlatformCi
                    await buffer.load(lastCi, line.length)
                } catch (e) {
                    if (e instanceof SyntaxError) {
                        lg.impossible("Failed to parse line #%s: %O\n\nLine contents:\n%s", lineNo, e, line)
                    } else {
                        lg.error("Failed to insert some PCIs: %O", e)
                    }
                }
                lineNo++
            }
            try {
                await buffer.flush()
            } catch(e) {
                lg.error("Failed to insert some PCIs: %O", e)
            }
            

            if (lastCi == undefined) break //no CI was added
            const lastCiMd = ciMetadata(lastCi)
            if (lastCiMd.seqNo + 1 <= startSeqNo) break //prevent infinite loop
            startSeqNo = lastCiMd.seqNo + 1
        } catch (e) {
            lg.error("Fetch error: %O", e)
            break
        }
    }

    await Promise.allSettled(putC.promises())
}

function normalizeLocation(location: string) {
    const url = URL.parse(location)
    return url?.href ?? location
}

async function getCiSourcesAndCategories(pk: UserCiPrimaryKey) {
    const x = await getJobsAndCatsByCi(pk)
    if(x == null) return null
    x.jobs.sort((a, b) => a.addedOn.getTime() - b.addedOn.getTime())
    
    const jobs = x.jobs.map(y => {
        const subject = toJobSubject(y.subject)
        let fromData : Record<string,any> = {}
        switch (subject.type) {
            case "file":
                fromData.filename = subject.filename
                break
            case "url":
                if (subject.archiveUrl) fromData.archive = subject.archiveUrl
                fromData.url = subject.url
                break
            case "crawl":
                fromData.url = subject.url
                break
        }

        return {
            from: fromData,
            jobId: y.jobId,
            started: y.addedOn,
            finished: y.updatedOn,
            cats: []
        }

    })
    const cats = x.cats.map(y => ({
        name: y.category == defaultCategory ? null : y.category,
        source: y.source
    }))

    const res = {
        jobs: jobs,
        categories: cats
    }
    return res    
}

