export {
    UpdateJobRecord,
    putUrlsFromCrawl, putJob,
    updateJob, updateFailedFileJobs,
    resetUnfinishedJobs, getWaitingJobs,
    getJobReports, deleteOldCrawlJobs, getJobById, getJobsAndCatsByCi
}

import { MakeOptional } from "../../../libs/basic/misc.js"
import { BulkError } from "../../../libs/dexie/dexie.js"
import { lg } from "../config.js"
import { Job, JobId, LoadingLocalFileInterruptedError, progress0, toJobReport, toJobSubject, toJobSubjectDb } from "../types/job.js"
import { db } from "./schema/db.js"
import { CategoryRecord, JobRecord, UserCiPrimaryKey } from "./schema/v1.js"
import { getUserCi } from "./uci.js"

type UpdateJobRecord = MakeOptional<Pick<JobRecord, 'updatedOn' | 'status' | 'progress' | 'failedError'>, 'progress'>
type PutUrlsFromCrawl = {
    added: number,
    alreadyExist: number,
    otherErrors: {
        url: string,
        error: Error
    }[]
}

async function putUrlsFromCrawl(urls: string[], archiveUrl: string): Promise<PutUrlsFromCrawl> {
    const now = new Date()
    const rows: JobRecord[] = urls.map(url => ({
        subject: {
            url: url,
            archiveUrl: archiveUrl,
        },
        addedOn: now,
        updatedOn: now,
        progress: progress0(),
        status: "waiting",
        queryHandlerLock: false,
        usedInStats: 0
    }))

    try {
        /**
         * Bug: if bulkPut fails with a ConstraintError ([subject.url+subject.archiveUrl] not unique) this
         * error is still shown in the console as undhandled despite being handled in the following catch.
         * Why? Does bulkPut run some async code outside of its own promise chain?
         * 
         * See:
         * https://github.com/dexie/Dexie.js/issues/691
         * https://github.com/dexie/Dexie.js/releases/tag/v1.5.0
         * https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
         * 
         */

        await db.t_job.bulkPut(rows)
        return { added: rows.length, alreadyExist: 0, otherErrors: [] }
    } catch (e) {
        if ((e as Error).name === 'BulkError') {
            const err = e as BulkError
            lg.log("If you see and unhandled BulkError, this is a bug. It is being handled here. The allegedly unhandled error: %O", err)
            let alreadyExists = 0
            let otherErrors = []
            for (const [pos, error] of Object.entries(err.failuresByPos)) {
                const url = urls[pos as unknown as number]
                if (error.name == "ConstraintError") {
                    alreadyExists++
                } else {
                    otherErrors.push({ url: url, error: error })
                }
            }
            const added = rows.length - alreadyExists - otherErrors.length
            return { added: added, alreadyExist: alreadyExists, otherErrors: otherErrors }
        } else {
            lg.error("Unknown error: %O", e)
            throw e //unknown error
        }
    }
}

async function deleteOldCrawlJobs(olderThanMs?: number) {
    olderThanMs ??= 1209600000 //2 weeks
    const thresholdDate = new Date(Date.now() - olderThanMs)
    return await db.t_job.where("updatedOn").below(thresholdDate)
        .and(x => toJobSubject(x.subject).type == "crawl")
        .delete()
}

async function getJobsAndCatsByCi(pk: UserCiPrimaryKey) {
    const ci = await getUserCi(pk[0], pk[1])
    if (ci == undefined) return null
    return {
        jobs: (await db.t_job.bulkGet(ci.jobIds)) as JobRecord[],
        cats: (await db.t_category.bulkGet(ci.catIds)) as CategoryRecord[]
    }
}

async function getJobById(jobId: JobId) {
    const job = await db.t_job.get(jobId)
    if (job == undefined) return undefined
    return toJobReport(job)
}

async function getJobReports(maxAgeMs: number) {
    const thresholdDate = new Date(Date.now() - maxAgeMs)
    const res = await db.t_job.where("updatedOn").aboveOrEqual(thresholdDate).toArray()
    return res.map(toJobReport)
}

async function putJob(job: Job): Promise<JobId> {
    const now = new Date()
    const row: JobRecord = {
        subject: toJobSubjectDb(job),
        addedOn: now,
        updatedOn: now,
        progress: progress0(),
        status: "waiting",
        queryHandlerLock: true,
        usedInStats: 0
    }

    const jobId = await db.t_job.put(row)
    if (jobId === undefined) throw new TypeError("assertion violated: put returned undefined in DexieDatabase:putJob(), expected auto-incremeneted primary key")
    return jobId
}

async function updateJob(jobId: number, changes: UpdateJobRecord): Promise<boolean> {
    const c = changes as JobRecord
    c.updatedOn = new Date()

    if (changes.failedError !== undefined) {
        lg.error("Job %s failed: %O", jobId, changes.failedError)
    }

    const res = await db.t_job.update(jobId, c)
    return res == 1
}

/**
 * Sets the status of all local file jobs that could not finish because 
 * the tab was closed to `"failed"`
 */
async function updateFailedFileJobs() {
    const err = new LoadingLocalFileInterruptedError()
    try {
        await db.t_job.where("status").anyOf("waiting", "enqueued", "started")
            .and(x => x.subject.filename != undefined)
            .modify({ status: "failed", failedError: err })
    } catch (e) {
        lg.error("Failed to by `resetUnfinishedJobsupdate all interrupted file jobs: %O", e)
    }
}

/**
 * Sets the status of all crawl and URL jobs that could not finish 
 * because the tab was closed to status `"waiting"` and removes
 * `queryHandlerLock`. 
 * 
 * These jobs will be returned by `getWaitingJobsForCrawledUrls()`.
 */
async function resetUnfinishedJobs() {
    try {
        await db.t_job.where("status").anyOf("waiting", "enqueued", "started")
            .and((x) => x.subject.filename == undefined)
            .modify({ status: "waiting", queryHandlerLock: false, progress: progress0() })
    } catch (e) {
        lg.error("Failed to reset all unfinished url and crawl jobs: %O", e)
    }
}

/**
 * Returns jobs that were reset by `resetUnfinishedJobs()` since
 * they could not finish before the tab was closed and URL jobs
 * that came from crawling an archive.
 */
async function getWaitingJobs() {
    return await db.t_job.where("status").equals("waiting")
        .and((x) => x.subject.filename == undefined && !x.queryHandlerLock)
        .toArray()
}
