export {
    Job, JobType, JobInDb, JobStatus, JobProgress, JobSubjectDb, JobId, JobReport, JobStartedBy,
    LoadUrlJob, LoadFileJob, CrawlJob,
    LoadUrlJobInDb, LoadFileJobInDb, CrawlJobInDb,
    LoadingLocalFileInterruptedError,
    toJobReport, toJobSubjectDb, toJobSubject, progress0, toCategorySource,
    categoryFromJob,
    toJobInDb, toJobStatus, startedByUser, startedByUserR,

    jobStatusT
}

import { ManagerEventTaskRelated } from "../../../libs/manager/events.js"
import { CategoryRecordSourceType, defaultCategory, JobRecord } from "../db/schema/v1.js"

type JobId = number
type JobStatus = typeof jobStatusT[number]

type Job = LoadUrlJob | LoadFileJob | CrawlJob
type JobInDb = LoadUrlJobInDb | LoadFileJobInDb | CrawlJobInDb
type JobType = Job['type']

type LoadUrlJob = {
    type: "url",
    url: string,
    archiveUrl?: string
}

type LoadFileJob = {
    type: "file",
    file: File
}

type CrawlJob = {
    type: "crawl",
    url: string
}

type LoadUrlJobInDb = LoadUrlJob & JobIdProp
type LoadFileJobInDb = LoadFileJob & JobIdProp
type CrawlJobInDb = CrawlJob & JobIdProp
type JobIdProp = { jobId: JobId }

/**
 * What is being worked on: 
 * - loading user CIs from local file (filename defined)
 * - loading user CIs from URL (url defined; archiveUrl undefined => manually added)
 * - crawling an archive (file, url undefined and archiveUrl defined)
 */
type JobSubjectDb = {
    filename?: string,
    url?: string,
    archiveUrl?: string
}

type JobSubject = JobSubjectFile | JobSubjectUrl | JobSubjectCrawl
type JobSubjectFile = { type: "file", filename: string }
type JobSubjectUrl = { type: "url", url: string, archiveUrl?: string }
type JobSubjectCrawl = { type: "crawl", url: string }

type JobProgress = {
    itemsAdded: number,
    itemsSkipped: number, //CIs already in db / archive URLs already crawled
    itemsInvalid: number, //not valid JSON, or wrong signature (empty lines are not counted here)
    curLine: number,
    bytesProcessed: number
    totalBytes: number | null, //null => filesize unknown
}

/**
 * Used outside of `cidb/db` instead of JobRecord where `JobSubjectDb`
 * is converted `JobSubject`.
 */
type JobReport = Omit<JobRecord, 'subject'> & {
    jobId: number,
    subject: JobSubject
}

type JobStartedBy = typeof jobStartedByT[number]

const jobStartedByT = ["user","script","anyone"] as const
const jobStatusT = ["waiting", "enqueued", "started", "completed", "aborted", "failed"] as const

//#region helper functions
function toJobReport(jr: JobRecord): JobReport {
    return {
        ...jr,
        jobId: jr.jobId!,
        subject: toJobSubject(jr.subject)
    }
}

function toJobSubjectDb(x: Job): JobSubjectDb {
    switch (x.type) {
        case "url": return { url: x.url, archiveUrl: x.archiveUrl ?? undefined }
        case "file": return { filename: x.file.name }
        case "crawl": return { archiveUrl: x.url }
    }
}

function toJobSubject(x: JobSubjectDb): JobSubject {
    if (x.filename != undefined) return { type: "file", filename: x.filename }
    if (x.url != undefined) return { type: "url", url: x.url, archiveUrl: x.archiveUrl }
    if (x.archiveUrl != undefined) return { type: "crawl", url: x.archiveUrl! }
    throw new Error("invalid JobSubjectDb (filename, url and archiveUrl are all undefined)")
}

/**
 * Restore job from db to a job that can be passed to the manager.
 * Not possible for jobs of type "file" since the file handle is lost.
 */
function toJobInDb(x: JobRecord): JobInDb {
    switch (toJobSubject(x.subject).type) {
        case "file":
            throw new Error("cannot reconstruct JobInDb of type 'file' from JobRecord")
        case "url":
            return {
                jobId: x.jobId!,
                type: "url",
                url: x.subject.url!,
                archiveUrl: x.subject.archiveUrl
            }
        case "crawl":
            return {
                jobId: x.jobId!,
                type: "crawl",
                url: x.subject.archiveUrl!
            }
    }
}

function toJobStatus(ev: ManagerEventTaskRelated<any, any, any>): JobStatus {
    return ev.type == "progressed" ? "started" : ev.type
}

function startedByUser(job: JobInDb) {
    let archiveUrl: string | undefined
    if (job.type == "url") archiveUrl = job.archiveUrl
    return startedByUser0(job.type, archiveUrl)
}

function startedByUserR(job: JobReport): boolean {
    let archiveUrl: string | undefined
    if (job.subject.type == "url") archiveUrl = job.subject.archiveUrl
    return startedByUser0(job.subject.type, archiveUrl)
}

function startedByUser0(type: "file" | "url" | "crawl", archiveUrl: string | undefined) {
    return type == "file" || (type == "url" && archiveUrl == undefined)
}

function progress0(): JobProgress {
    return {
        itemsAdded: 0,
        itemsSkipped: 0,
        itemsInvalid: 0,
        curLine: 0,
        bytesProcessed: 0,
        totalBytes: null
    }
}

function toCategorySource(job: LoadUrlJob | LoadFileJob) {
    let res: { source: string, sourceType: CategoryRecordSourceType }
    switch (job.type) {
        case "url":
            res = {
                source: job.archiveUrl ? job.archiveUrl : job.url,
                sourceType: job.archiveUrl ? "archive" : "url"
            }
            break
        case "file":
            res = {
                source: job.file.name,
                sourceType: "file"
            }
            break
    }
    return res
}

function categoryFromJob(job: LoadFileJob | LoadUrlJob): string | undefined {
    switch (job.type) {
        case "file":
            return categoryFromFilename(job.file.name)
        case "url":
            const fn = filenameFromUrl(job.url)
            return fn === undefined ? undefined : categoryFromFilename(fn)
    }
}

function filenameFromUrl(url: string) {
    const lastEl = <T>(x: T[]) => x[x.length - 1]
    try {
        const x = new URL(url)
        return decodeURI(lastEl(x.pathname.split("/")))
    } catch (e) {
        return undefined
    }
}

function categoryFromFilename(name: string): string | undefined {
    const r = /^\[([^\[\]]+)\]/
    const res = r.exec(name)
    if (res === null) return defaultCategory
    return res[1]
}
//#endregion

class LoadingLocalFileInterruptedError extends Error {
    constructor() {
        super("tab was closed before file finished loading")
        this.name = "LoadingLocalFileInterruptedError"
    }
}