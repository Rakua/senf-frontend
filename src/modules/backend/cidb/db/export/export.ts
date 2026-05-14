//#region import/export
export { exportDatabase, exportDatabaseParameters, exportCis }

import { toJson } from "../../../../libs/basic/misc.js"
import { ReactiveAtom } from "../../../../libs/basic/reactive.js"
import { asyncGeneratorToStream, streamToBlob } from "../../../../libs/etc/stream.js"
import { serializeUserCi } from "../../cidb.js"
import { lg } from "../../config.js"
import { settings } from "../../settings.js"
import { toJobSubject } from "../../types/job.js"
import { db } from "../schema/db.js"
import { JobRecord, UserCiPrimaryKey } from "../schema/v1.js"
import { DbAbortSignal, tableStartLine, tablesToExport } from "./common.js"
//#endregion

//#region types
type TablesToExport = typeof tablesToExport[number]

type ExportProgress = {
    totalTableCount: number,

    processedRowCount: ReactiveAtom<number>,
    totalRowCount: ReactiveAtom<number>,

    currentTable: ReactiveAtom<string>,
    currentTableRowCount: ReactiveAtom<number>,
    currentTableProcessedRowCount: ReactiveAtom<number>
}
//#endregion

//#region main functions
/**
 * Exports records of all tables except t_poster and t_location since their
 * contents can be computed from the other tables. 
 * 
 * @param progress pass variables returned by `exportDatabaseParameters()`
 * @returns JSONL with table header separators in gzip as blob or undefined 
 * if the user aborted the export
 */
async function exportDatabase(progress: ExportProgress, abortSignal: DbAbortSignal) {
    const { lastJobId, lastCatId } = await db.transaction("r", [db.t_job, db.t_category], async () => {
        const lastJob = await db.t_job.reverse().first()
        const lastCat = await db.t_category.reverse().first()
        return {
            lastJobId: lastJob ? lastJob.jobId! : 0,
            lastCatId: lastCat ? lastCat.catId! : 0
        }
    })
    // use date after getting lastJobId and lastCatId as cut-off 
    // date to ensure that their respective records are included
    const addedOnCutOff = new Date()

    lg.debug("export: maxJobId %O, maxCatId: %O", lastJobId, lastCatId)

    const generator = fetchTableData(progress, abortSignal, addedOnCutOff, lastJobId, lastCatId)
    const stream = asyncGeneratorToStream(generator)
    const gzStream = stream.pipeThrough(new CompressionStream("gzip"))
    const blob = await streamToBlob(gzStream, { type: 'application/gzip' })
    return abortSignal.abort ? undefined : blob
}

/**
 * @param progress use to determine the progress of the export operation
 * @param abortSignal set `abortSignal.abort` to `true` to signal that export should be aborted
 * @param addedOnCutOff records added after this date are excluded from the exported file
 * @param lastJobId foreign key references to job ids larger than this are filtered out
 * @param lastCatId foreign key references to cat ids larger than this are filtered out
 */
async function* fetchTableData(progress: ExportProgress, abortSignal: DbAbortSignal, addedOnCutOff: Date, lastJobId: number, lastCatId: number) {
    const excludeCrawlJobs = settings.excludeCrawlJobsFromExport.get()
    const limit = settings.recordLimit.get()
    const te = new TextEncoder()

    progress.processedRowCount.set(0)
    progress.totalRowCount.set(0)

    //compute total row count
    const rowCount: Record<TablesToExport, number> = {
        t_platformCi: 0,
        t_userCi: 0,
        t_userCiMetadata: 0,
        t_fakeUserCi: 0,
        t_category: 0,
        t_job: 0
    }
    let total = 0
    for (const table of tablesToExport) {
        rowCount[table] = await db[table].count()
        total += rowCount[table]
    }
    progress.totalRowCount.set(total)

    //compute database file
    for (const table of tablesToExport) {
        yield te.encode(tableStartLine(table)) as Uint8Array<ArrayBuffer>
        progress.currentTable.set(table)
        progress.currentTableRowCount.set(rowCount[table])
        progress.currentTableProcessedRowCount.set(0)

        let offset = 0
        while (true) {
            if (abortSignal.abort) return //aborted export            

            const rows = await db[table].offset(offset).limit(limit).toArray()
            if (rows.length == 0) break //finished table 

            //filter out jobs of crawls (archiveUrl only in subject?)
            const data = rows
                .filter((x) => {
                    //filter out records that were added after export started
                    if (x.addedOn > addedOnCutOff) return false

                    //accept non-job records
                    if (!isJobRecord(x)) return true

                    //exclude crawl jobs if the setting excludeCrawlJobsFromExport is true
                    return !excludeCrawlJobs || toJobSubject(x.subject).type != "crawl"
                })
                .map((x) => {
                    //filter out job and cat ids in record that were added after export started
                    if (hasJobIds(x)) x.jobIds = x.jobIds.filter(id => id <= lastJobId)
                    if (hasCatIds(x)) x.catIds = x.catIds.filter(id => id <= lastCatId)
                    return x
                })

            yield te.encode(data.map(toJson).join("\n") + "\n") as Uint8Array<ArrayBuffer>
            offset += rows.length

            //update progress
            progress.processedRowCount.set(progress.processedRowCount.get() + rows.length)
            progress.currentTableProcessedRowCount.set(progress.currentTableProcessedRowCount.get() + rows.length)
        }
    }

    if (progress.totalRowCount.get() == 0) {
        //ensures 100% progress if all tables are empty
        progress.totalRowCount.set(1)
        progress.processedRowCount.set(1)
    }
}

/**
 * Use to generate the parameters for `exportDatabase()`. The properties
 * of the returned object are used to report the progress of the export operation.
 */
function exportDatabaseParameters() {
    const progress: ExportProgress = {
        totalTableCount: tablesToExport.length,

        processedRowCount: new ReactiveAtom(0),
        totalRowCount: new ReactiveAtom(0),

        currentTable: new ReactiveAtom(tablesToExport[0]),
        currentTableRowCount: new ReactiveAtom(0),
        currentTableProcessedRowCount: new ReactiveAtom(0)
    }
    const signal: DbAbortSignal = { abort: false }

    return {
        progress: progress,
        abortSignal: signal
    }
}
//#endregion

//#region export CIs only
async function exportCis(pks?: UserCiPrimaryKey[]) {
    const generator = pks == undefined ? fetchAllCis() : fetchGivenCis(pks)
    const stream = asyncGeneratorToStream(generator)
    const blob = await streamToBlob(stream, { type: 'text/plain' })
    return blob
    // const gzStream = stream.pipeThrough(new CompressionStream("gzip"))
    // const blob = await streamToBlob(gzStream, { type: 'application/gzip' })
    // return blob
}

async function* fetchGivenCis(pks: UserCiPrimaryKey[]) {
    const te = new TextEncoder()
    const limit = settings.recordLimit.get()
    let page = 0

    while (true) {
        const pksPart = pks.slice(page * limit, (page + 1) * limit)
        const rows = await db.t_userCi.bulkGet(pksPart)
        if (rows.length == 0) break //finished
        const cis = rows.filter(x => x != undefined).map(x => x.ci)
        yield te.encode(cis.map(serializeUserCi).join("\n") + "\n") as Uint8Array<ArrayBuffer>
        page++
    }
}

async function* fetchAllCis() {
    const te = new TextEncoder()
    const limit = settings.recordLimit.get()
    let offset = 0

    while (true) {
        const rows = (await db.t_userCi.offset(offset).limit(limit).toArray()).map(x => x.ci)
        if (rows.length == 0) break //finished
        yield te.encode(rows.map(serializeUserCi).join("\n") + "\n") as Uint8Array<ArrayBuffer>
        offset += rows.length
    }
}
//#endregion

//#region helpers
function isJobRecord(x: any): x is JobRecord {
    return Object.hasOwn(x, "jobId")
}

function hasJobIds(x: any): x is { jobIds: number[] } {
    return Object.hasOwn(x, "jobIds")
}

function hasCatIds(x: any): x is { catIds: number[] } {
    return Object.hasOwn(x, "catIds")
}
//#endregion