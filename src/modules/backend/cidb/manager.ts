export {
    initManager, updateJobRecord, addLoadFileJob, addLoadUrlJob, addCrawlJob, abortJob,
    initManagerQueryHandlers, retryJob,
    manager
}

import { DefaultLogger } from "../../libs/basic/logger.js"
import { sleep } from "../../libs/basic/misc.js"
import { queryMainTab as queryMainTab0, setMainTabQueryHandler } from "../../libs/etc/tab.js"
import { Manager } from "../../libs/manager/manager.js"
import { firstUpdateTimeFinished, getTimePair } from "../time.js"
import { eventIsTaskRelated, ManagerEvent, ManagerEventCompleted, ManagerEventProgressed, taskRelatedEventTypes } from "./../../libs/manager/events.js"
import { chains, lg, modName } from "./config.js"
import { getJobById, getWaitingJobs, putJob, resetUnfinishedJobs, updateFailedFileJobs, updateJob, UpdateJobRecord } from "./db/jobs.js"
import { getInaugurationCi, getKeyCis } from "./db/pci.js"
import { JobRecord } from "./db/schema/v1.js"
import { emitEvent } from "./events.js"
import { JobQueue } from "./queue.js"
import { settings } from "./settings.js"
import { ciMetadata, PlatformKey, UserChain } from "./types/ci.js"
import { Job, JobId, JobInDb, toJobInDb, toJobStatus, CrawlJob, LoadUrlJob, LoadFileJob } from "./types/job.js"
import { LoaderInitData, LoaderInput, LoaderOutput, LoaderProgress } from "./types/misc.js"

//#region types
type CidbManager = Manager<LoaderInput, LoaderProgress, LoaderOutput, LoaderInitData>
type QueryType = QueryTypeAdd | QueryTypeAbort
type QueryTypeAdd = typeof queryTypeAdd
type QueryTypeAbort = typeof queryTypeAbort
const queryTypeAdd = "addQuery"
const queryTypeAbort = "abortQuery"
//#endregion

let resolveManager: (val: CidbManager) => void
let resolveRestartJobsFinished: () => void

const manager: Promise<CidbManager> = new Promise((resolve) => resolveManager = resolve)
const restartJobsFinished: Promise<void> = new Promise((resolve) => resolveRestartJobsFinished = resolve)
let updateAfter = Promise.resolve()

function initManagerQueryHandlers() {
    setMainTabQueryHandler<Job, JobId>(modName, queryTypeAdd, queryHandlerAdd)
    setMainTabQueryHandler<JobId, boolean>(modName, queryTypeAbort, queryHandlerAbort)
}

async function initManager() {
    lg.debug("initManager()")

    const keys: Record<UserChain, PlatformKey[]> = {}
    const inaugTimestamp: Record<UserChain, Date> = {}

    for (const chain of chains) {
        keys[chain] = (await getKeyCis(chain)).map(pci => pci.data.content)
        const ciMd = ciMetadata(await getInaugurationCi(chain))
        inaugTimestamp[chain] = ciMd.timestamp
    }

    await firstUpdateTimeFinished
    const timePair = getTimePair()
    const timeDiff = timePair.serverTime.getTime() - timePair.clientTime.getTime()

    const initData: LoaderInitData = {
        keys: keys,
        inaugurationTimestamp: inaugTimestamp,
        serverClientTimeDelta: timeDiff,
        uciFileExtensions: settings.uciFileExtensions.get(),
        abortCheckAfterNIterations: settings.abortCheckAfterNIterations.get(),
        ciBufferSize: settings.ciBufferSize.get(),
        urlBufferSize: settings.urlBufferSize.get(),
        maxLineLength: settings.maxLineLength.get(),
        maxCrawledUrlSize: settings.maxCrawledUrlSize.get(),
        statsTrustLevel: settings.statsTrustLevel.get(),
        mutedData: DefaultLogger.getMuted()
    }

    const m: CidbManager =
        new Manager(2, "modules/backend/cidb/worker/loader.w.js", {
            managerName: modName + ":manager",
            initData: initData,
            taskQueue: new JobQueue(),
            taskIdFromInput: (job) => job.jobId.toString() //taskId == jobId
        })

    m.addListener(updateJobRecord, taskRelatedEventTypes)
    m.addListener((ev) => {
        type Ev = ManagerEventProgressed<LoaderInput, LoaderProgress> | ManagerEventCompleted<LoaderInput, LoaderOutput>
        if ((ev as Ev).data.input.type == "crawl") {
            lg.debug("addWaitingJobs() after crawl event progressed/completed")
            addWaitingJobs()
        }
    }, ["progressed", "completed"])

    //emit CidbEventLoadersFinished if all loader workers are idling after last
    //finished job in Manager
    m.addListener(async () => {
        await sleep(100)
        if (!m.hasUnfinishedTasks())
            emitEvent({ type: "loadersFinished", data: null })
    }, ["completed", "aborted", "failed"])

    resolveManager(m)

    //add existing tasks from database
    restartJobs()
}

async function addLoadFileJob(file: File): Promise<JobId> {
    const job: LoadFileJob = {
        type: "file",
        file: file
    }
    return await queryMainTab(queryTypeAdd, job)
}

async function addLoadUrlJob(url: string, archiveUrl?: string): Promise<JobId> {
    const job: LoadUrlJob = {
        type: "url",
        url: url,
        archiveUrl: archiveUrl
    }
    return await queryMainTab(queryTypeAdd, job)
}

async function addCrawlJob(url: string): Promise<JobId> {
    lg.debug("add crawl job %O", url)
    const job: CrawlJob = {
        type: "crawl",
        url: url
    }
    return await queryMainTab(queryTypeAdd, job)
}

async function abortJob(jobId: JobId) {
    return await queryMainTab(queryTypeAbort, jobId)
}

async function retryJob(jobId: JobId) {
    await restartJobsFinished //wait until restarting old jobs has finished
    const m = await manager

    const job = await getJobById(jobId)
    if (job == undefined) return false

    if (!((job.status == "aborted" || job.status == "failed") && job.subject.type != "file"))
        return false

    //reset status to waiting and call
    const updated = await updateJob(jobId, { status: "waiting", queryHandlerLock: false } as JobRecord)
    if (!updated) return false

    //remove task from manager as otherwise addWaitingJobs would not be able to add it again as new task
    m.cleanTask(jobId.toString())

    await addWaitingJobs()
    return true
}

async function queryHandlerAdd(job: Job): Promise<JobId> {
    await restartJobsFinished //wait until restarting old jobs has finished
    const m = await manager

    const jobId = await putJob(job)
    const jobInDb: JobInDb = { ...job, jobId: jobId }
    lg.debug("new task from queryHandlerAdd: %O", jobInDb)
    m.newTask(jobInDb, { useDefaultCatchHandler: true })

    return jobId
}

async function queryHandlerAbort(jobId: JobId): Promise<boolean> {
    lg.debug("queryHandlerAbort called with jobId %s", jobId)

    await restartJobsFinished //wait until restarting old jobs has finished
    const m = await manager

    const res = await m.abortTask(jobId.toString())
    lg.debug("abortTask res: %O", res)
    return res
}

function queryMainTab(type: QueryTypeAdd, input: Job): Promise<JobId>
function queryMainTab(type: QueryTypeAbort, input: JobId): Promise<boolean>
function queryMainTab(type: QueryType, input: Job | JobId): Promise<JobId | boolean> {
    lg.debug("QueryMainTab received query type %s", type)
    return queryMainTab0(modName, type, input)
}

//update job record whenever manager emits a task-related event
async function updateJobRecord(ev: ManagerEvent<LoaderInput, LoaderProgress, LoaderOutput>) {
    if (!eventIsTaskRelated(ev)) return

    //promise chaining ensures updates are written in order to the job table
    updateAfter = updateAfter.finally(async () => {
        const jobId = ev.data.input.jobId
        const changes: UpdateJobRecord = {
            status: toJobStatus(ev)
        } as UpdateJobRecord

        if (ev.type == "progressed") changes.progress = ev.data.progress
        if (ev.type == "completed") changes.progress = ev.data.output
        if (ev.type == "failed") changes.failedError = ev.data.error

        const res = await updateJob(jobId, changes)
        if (!res) lg.error("failed to update job")
    })
}

async function restartJobs() {
    const m = await manager

    //update jobs from previous manager and add to new manager
    await updateFailedFileJobs()
    await resetUnfinishedJobs()
    await addWaitingJobs()

    resolveRestartJobsFinished()
}

/**
 * After crawling of an archive has progressed or completed, all newly added URLs
 * to load (status = "waiting") are loaded from the db and passed to the manager.
 * Also used to restart jobs. 
 */
async function addWaitingJobs() {
    const m = await manager

    for (const jr of await getWaitingJobs()) {
        try {
            const jobInDb = toJobInDb(jr)
            lg.debug("new task from add waiting jobs: %O", jobInDb)

            //only add task to manager if it was not already added by previous call
            if (!m.hasTask(jobInDb.jobId.toString()))
                m.newTask(jobInDb, { useDefaultCatchHandler: true })
        } catch (e) {
            lg.error("Failed to reconstruct job from record in db: %O", e)
        }
    }

}