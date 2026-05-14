//#region import/export
export { ImportDatabase as ImportDatabaseRv, importDatabase, importDatabaseParameters }

import { toJson } from "../../../../libs/basic/misc.js"
import { ReactiveAtom } from "../../../../libs/basic/reactive.js"
import Dexie from "../../../../libs/dexie/dexie.js"
import { hasType, TypeMismatch } from "../../../../libs/etc/guard.js"
import { lineIterator } from "../../../../libs/etc/misc.js"
import { StreamWithBytesProcessedBeingTracked, unzippedStream } from "../../../../libs/etc/stream.js"
import { lg, modName, stubsDisabled } from "../../config.js"
import { emitEvent } from "../../events.js"
import { settings } from "../../settings.js"
import { ciMetadata } from "../../types/ci.js"
import { toJobSubject } from "../../types/job.js"
import { StatsTrustLevel } from "../../types/misc.js"
import { LogCiChecker, newLogCiChecker } from "../pci.js"
import { db } from "../schema/db.js"
import { CategoryRecord, exRecord, FakeUserCiRecord, JobRecord, PlatformCiRecord, statisticStatus, UserCiMetadataRecord, UserCiRecord } from "../schema/v1.js"
import { putUserCiMetadataRecords, putUserCiRecords, verifyUserCiMetadataRecords } from "../uci.js"
import { DbAbortSignal, parseLine, TablesToExport, tablesToExport } from "./common.js"

//#endregion

//#region types
type ImportProgress = {
    currentTable: ReactiveAtom<TablesToExport>,
    totalBytes: ReactiveAtom<number | null>, //null => unknown
    processedBytes: ReactiveAtom<number>
    processedRows: ReactiveAtom<number>,
    newRows: ReactiveAtom<number>
}

type ImportDatabase = ImportDatabaseOk | ImportDatabaseAborted | ImportDatabaseError
type ImportDatabaseOk = { type: "ok" }
type ImportDatabaseAborted = { type: "aborted" }
type ImportDatabaseError = { type: "error", error: ImportError }

type GlobalKey = string
/**
 * Used to check if a record from the import already exists in the db
 */
type ExistingRecords = {
    t_job: Map<GlobalKey, number>
    t_category: Map<GlobalKey, number>
}

/**
 * Used to translate the foreign key references in the import.
 * Maps a job or category id in the import to its id in the db.
 */
type IdTranslation = {
    t_job: Map<number, number>,
    t_category: Map<number, number>
}

//#endregion

const lockName = `${modName}:import`
const referencedTables = {
    t_job: {
        id: "jobId",
        foreigKeyColName: "jobIds"
    },
    t_category: {
        id: "catId",
        foreigKeyColName: "catIds"
    }
} as const

async function importDatabase(trustLevel: StatsTrustLevel, stream: ReadableStream, totalBytes: number | null, progress: ImportProgress, abortSignal: DbAbortSignal): Promise<ImportDatabase> {
    progress.totalBytes.set(totalBytes)
    try {
        return await navigator.locks.request(lockName, { ifAvailable: true },
            async (lock) => {
                if (lock === null) {
                    //an import is already in progress => cannot start new import
                    return { type: "error", error: new ImportLockError() }
                }
                return await importDatabase0(trustLevel, stream, progress, abortSignal)
            })
    } catch (e) {
        if (e instanceof Dexie.AbortError) {
            //user aborted or error within transaction
            lg.debug("User aborted import or error within transaction: %O", e.inner)
            return e.inner as ImportDatabaseAborted | ImportDatabaseError
        } else {
            //unknown error
            lg.debug("Unknown error", e)
            throw e
        }
    }
}

async function importDatabase0(trustLevel: StatsTrustLevel, stream: ReadableStream, progress: ImportProgress, abortSignal: DbAbortSignal): Promise<ImportDatabase> {
    const lcc = await newLogCiChecker()

    const res = await db.transaction("rw", tablesToExport, async (): Promise<ImportDatabase> => {
        lg.debug("starting import")

        const existingsRecs = await fetchExistingRecords()
        lg.debug("import existing records", existingsRecs)
        const idTranslation: IdTranslation = {
            t_job: new Map(),
            t_category: new Map()
        }

        let curTableIndex = -1 //index for tablesToExport; -1 => not started yet
        let curLineNo = 1 //1-based line number in import file
        let rowBuffer: { line: number, data: any }[] = []

        const getCurTable = () => curTableIndex === -1 ? null : tablesToExport[curTableIndex]
        const flushBuffer = async () => {
            try {
                lg.debug("flushing import buffer for %O (%O)", getCurTable(), rowBuffer.length)

                if (getCurTable() == "t_job") {
                    //condition auto url jobs to prevent unique constraint violation in case
                    //an auto url job has been done in the local db with another addedOn date
                    for (const rb of rowBuffer) {
                        const jobRec = rb.data as JobRecord
                        if (jobRec.subject.url === undefined || jobRec.subject.archiveUrl === undefined) continue

                        //only check auto url jobs
                        lg.debug("check auto url job %O", jobRec)
                        const existingId = existingsRecs.t_job.get(globalKey("t_job", jobRec))
                        if (existingId !== undefined) continue

                        //no matching auto url job in current db => modify subject.url                        
                        jobRec.subject.url += "##import=sf&addedOn=" + jobRec.addedOn.getTime()
                        lg.debug("no matching auto url job => modify subject url %O", jobRec.subject.url)
                    }
                }

                const newlyAdded = await importRecords(getCurTable()!, rowBuffer, existingsRecs, idTranslation, trustLevel, lcc)
                progress.newRows.set(progress.newRows.get() + newlyAdded)
                rowBuffer = []
            } catch (e) {
                lg.error("flush buffer failed:", e)
                abortImportTransaction({ type: "error", error: new ImportOtherError(e as Error) })
            }
        }

        const trackStream = new StreamWithBytesProcessedBeingTracked(stream,
            (bytesProcessed) => { progress.processedBytes.set(bytesProcessed) }
        )

        const uzStream = await Dexie.waitFor(unzippedStream(trackStream.stream()))
        const lineIt = lineIterator(uzStream.getReader())

        const updateProgress = (emptyLine: boolean) => {
            if (!emptyLine) {
                const pr = progress.processedRows.get()
                progress.processedRows.set(pr + 1)
            }
            curLineNo++
        }
        while (true) {
            try {
                const res = await Dexie.waitFor(lineIt.next())

                if (abortSignal.abort) abortImportTransaction({ type: "aborted" })
                if (res.done === true) {
                    //finished reading stream
                    trackStream.close()
                    return { type: "ok" }
                }

                const curTable = getCurTable()
                const x = parseLine(res.value.line)
                let emptyLine = false

                switch (x.type) {
                    case "table":
                        //not the first table => flush buffer with rows for previous table
                        if (curTable !== null) await flushBuffer()

                        curTableIndex++
                        const expectedNextTable = getCurTable()
                        if (curTableIndex >= tablesToExport.length || x.name !== expectedNextTable) {
                            const err = new ImportUnexpectedTableError(curLineNo, x.name, expectedNextTable)
                            lg.debug("unexpected tables err", err)
                            abortImportTransaction({
                                type: "error",
                                error: err
                            })
                        }
                        progress.currentTable.set(curTable!)
                        break

                    case "row":
                        if (curTable === null) {
                            //row line before table line
                            abortImportTransaction({ type: "error", error: new ImportFirstLineNotATableError() })
                        }

                        //check that data has the structure required by curTable
                        const rv = { value: null }
                        lg.debug("check type for table %O", curTable)

                        if (!hasType(x.data, exRecord[curTable], rv)) {
                            const err = rv as unknown as TypeMismatch
                            abortImportTransaction({
                                type: "error",
                                error: new ImportRowStructureError(curLineNo, getCurTable()!, err)
                            })
                        }

                        rowBuffer.push({ line: curLineNo, data: x.data })
                        if (rowBuffer.length >= settings.recordLimit.get()) await flushBuffer()
                        break

                    case "empty":
                        emptyLine = true
                        break

                    case "invalid":
                        //JSON syntax error
                        abortImportTransaction({
                            type: "error",
                            error: new ImportSyntaxError(curLineNo, x.reason)
                        })
                }

                updateProgress(emptyLine)
            } catch (e) {
                const err = e as Error
                if (err.name == "AbortError") {
                    throw e
                } else {
                    lg.error("imprortDb0 transaction failed", e)
                    abortImportTransaction({
                        type: "error",
                        error: new ImportOtherError(err)
                    })
                }
            }
        }
    })
    lg.debug("transaction finished")
    emitEvent({ type: "importFinished", data: res })
    return res
}

/**
 * Returns number of newly added records
 */
async function importRecords(table: TablesToExport, records: { line: number, data: any }[], existingRecords: ExistingRecords, idTranslation: IdTranslation, trustLevel: StatsTrustLevel, lcc: LogCiChecker): Promise<number> {
    switch (table) {
        case "t_platformCi": {
            try {
                const rows0 = records as { line: number, data: PlatformCiRecord }[]
                const rows = rows0.map(x => x.data)

                await db.t_platformCi.bulkAdd(rows)

                if (ciMetadata(rows[0].ci).seqNo == 1) {
                    const addedOnA = rows[0].addedOn.toISOString()
                    const res = await db.t_platformCi.get(["qa2p", 1])
                    const addedOnB = res?.addedOn.toISOString()
                    lg.test(addedOnA == addedOnB, "comparing dates %O = %O (file = db)", addedOnA, addedOnB)
                }

                db.t_platformCi.get(["qa2p", 1])
                return records.length
            } catch (e) {
                if (e instanceof Dexie.BulkError) {
                    //assumption: all failures are platform CIs that already exist in DB,
                    //i.e. primary key already exists
                    return records.length - e.failures.length
                } else {
                    throw e
                }
            }
        }

        //tables referenced in other tables
        case "t_job":
        case "t_category": {
            let rows = records as { line: number, data: JobRecord | CategoryRecord }[]

            if (table == "t_job") {
                //reset usedInStats flag; crawl => 1 because not applicable, otherwise 0
                rows = (rows as { line: number, data: JobRecord }[]).map(x => {
                    x.data.usedInStats = toJobSubject(x.data.subject).type == "crawl" ? 1 : 0
                    return x
                })
            }

            const newRows: { idFromFile: number, recordWithoutId: JobRecord | CategoryRecord }[] = []
            for (const row of rows) {
                //pretend we are in the case "t_job" for typing

                //check if record already exists
                const idColName = referencedTables[table].id as "jobId"
                const idFromFile = (row.data as JobRecord)[idColName]!
                const existingId = existingRecords[table].get(globalKey(table as "t_job", row.data as JobRecord))
                if (existingId !== undefined) {
                    //this record already exists in db => doesn't need to be inserted
                    idTranslation[table].set(idFromFile, existingId)
                } else {
                    //record needs to be added to db                          
                    delete (row.data as JobRecord)[idColName]
                    newRows.push({
                        idFromFile: idFromFile,
                        recordWithoutId: row.data
                    })
                }
            }

            const newKeys = await db[table as "t_job"].bulkPut(newRows.map(x => x.recordWithoutId as JobRecord), { allKeys: true })
            //check that there are no undefined entries in newKeys
            for (let i = 0; i < newRows.length; i++) {
                const newKey = newKeys[i]
                if (newKey == undefined) throw new Error("Got no new id for record: " + toJson(newRows[i]))
                idTranslation[table].set(newRows[i].idFromFile, newKey)
            }
            return newRows.length
        }

        //tables referencing other tables
        case "t_userCi":
        case "t_userCiMetadata":
        case "t_fakeUserCi": {
            const rows = records as { line: number, data: UserCiRecord | UserCiMetadataRecord | FakeUserCiRecord }[]

            //condition the rows
            for (const row of rows) {
                //remove id from fake user CI records since new ids will be generated for them
                if (table == "t_fakeUserCi") delete (row.data as FakeUserCiRecord).id

                //translate catIds and jobIds in the records
                for (const foreignTable of ["t_job", "t_category"] as const) {
                    const rt = referencedTables[foreignTable]
                    row.data[rt.foreigKeyColName].forEach((foreignKey, i) => {
                        const newId = idTranslation[foreignTable].get(foreignKey)
                        if (newId == undefined) {
                            throw new Error("Invalid foreign key (" + foreignKey + " -> " + foreignTable + ") on line " + row.line)
                        }
                        row.data[rt.foreigKeyColName][i] = newId
                    })
                }

                //it is assumed that the platform signature of CIs is correct
                if (table == "t_userCi") {
                    row.data.logCiSeqNo = 0 // make CIDB verfiy CI against hash again
                    const status = trustLevel == "trustSignature" ? statisticStatus.VerifiedAndUnused : statisticStatus.UnknownOrUnverified
                    row.data.posterStatus = status
                    row.data.locationStatus = status
                }
            }

            switch (table) {
                case "t_userCi": {
                    const records = rows.map(r => r.data as UserCiRecord)
                    const res = await putUserCiRecords(records)
                    return res.added
                }

                case "t_userCiMetadata": {
                    if (stubsDisabled) return 0

                    const records = rows.map(r => r.data as UserCiMetadataRecord)
                    const res0 = await verifyUserCiMetadataRecords(records, lcc)
                    if (res0.length > 0) {
                        lg.error("Failed to verfiy user CI metadata records: %O", res0)
                        throw new Error("Failed to verify some CI metadata records")
                    }
                    const res = await putUserCiMetadataRecords(records)
                    return records.length - res.length
                }

                case "t_fakeUserCi": {
                    const records = rows.map(r => r.data as FakeUserCiRecord)
                    await db.t_fakeUserCi.bulkPut(records)
                    return records.length
                }
            }
        }
    }
}

//#region helpers

/**
 * Call to abort the import database transaction and roll back the db to its previous 
 * state. The parameter `x` is used as return value in `importDatabase()`.
 */
function abortImportTransaction(x: ImportDatabaseAborted | ImportDatabaseError): never {
    throw new Dexie.AbortError(x)
}

/**
 * Returns existing records of referenced tables as lookup map with their 
 * global key as index and the table id as value.
 */
async function fetchExistingRecords(): Promise<ExistingRecords> {
    return {
        t_job: new Map((await db.t_job.toArray()).map(rec => [globalKey("t_job", rec), rec.jobId!])),
        t_category: new Map((await db.t_category.toArray()).map(rec => [globalKey("t_category", rec), rec.catId!]))
    }
}

/**
 * Returns a global key for a record from `table` that is used to check if a record from the 
 * import already exists in the database.
 */
function globalKey(table: "t_job", x: JobRecord): GlobalKey;
function globalKey(table: "t_category", x: CategoryRecord): GlobalKey;
function globalKey(table: ("t_job" | "t_category") & TablesToExport, x: JobRecord | CategoryRecord): GlobalKey {
    switch (table) {
        case "t_job": {
            const x0 = x as JobRecord
            return toJson([x0.addedOn, x0.subject])
        }
        case "t_category": {
            const x0 = x as CategoryRecord
            return toJson([x0.category, x0.source, x0.sourceType])
        }
    }
}

function importDatabaseParameters() {
    const progress: ImportProgress = {
        totalBytes: new ReactiveAtom<number | null>(null),
        processedBytes: new ReactiveAtom(0),
        processedRows: new ReactiveAtom(0),
        newRows: new ReactiveAtom(0),
        currentTable: new ReactiveAtom(tablesToExport[0])
    }
    const signal: DbAbortSignal = { abort: false }

    return {
        progress: progress,
        abortSignal: signal
    }
}
//#endregion

//#region errors
type ImportError = ImportLockError | ImportSyntaxError | ImportRowStructureError | ImportUnexpectedTableError | ImportFirstLineNotATableError | ImportOtherError

class ImportLockError extends Error {
    readonly name = "ImportLockError"

    constructor() {
        super("An import is already in progress")
    }
}

class ImportSyntaxError extends Error {
    readonly name = "ImportSyntaxError"
    readonly lineNo: number
    readonly err: Error

    constructor(lineNo: number, err: Error) {
        super(`Invalid JSON syntax on line ${lineNo}: ${err.message}`)
        this.lineNo = lineNo
        this.err = err
    }
}

class ImportRowStructureError extends Error {
    readonly name = "ImportRowStructureError"
    readonly lineNo: number
    readonly table: string
    readonly reason: TypeMismatch

    constructor(lineNo: number, table: string, reason: TypeMismatch) {
        //super(`Invalid row structure on line ${lineNo} for table ${table}`)
        super(`Invalid row structure on line ${lineNo} for table ${table} (${toJson(reason)})`)
        this.lineNo = lineNo
        this.table = table
        this.reason = reason
    }
}

class ImportUnexpectedTableError extends Error {
    readonly name = "ImportUnexpectedTableError"
    readonly lineNo: number
    readonly gotTable: string
    readonly expectedTable: null | string

    constructor(lineNo: number, gotTable: string, expectedTable: null | string) {
        if (expectedTable === null) {
            super(`Unexpected table on line ${lineNo}: got ${gotTable} but expected previous table to be the last`)
        } else {
            super(`Unexpected table on line ${lineNo}: got ${gotTable}, expected ${expectedTable}`)
        }

        this.lineNo = lineNo
        this.gotTable = gotTable
        this.expectedTable = expectedTable
    }
}

class ImportFirstLineNotATableError extends Error {
    readonly name = "ImportFirstLineNotATableError"

    constructor() {
        super(`First line is not a table`)
    }
}

class ImportOtherError extends Error {
    readonly name = "ImportOtherError"
    readonly inner: Error

    constructor(error: Error) {
        super(error.message)
        this.inner = error
    }
}

//#endregion