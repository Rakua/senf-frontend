export {
    DbAbortSignal, TablesToExport,
    tablesToExport, tableStartLine, parseLine
}

import { fromJson, toJson } from "../../../../libs/basic/misc.js"
import { SchemaV1 } from "../schema/v1.js"

//#region types
type TablesToExport = typeof tablesToExport[number]

/**
 * Used to signal that an import or export operation should be aborted
 * by setting `abort` to true.
 */
type DbAbortSignal = {
    abort: boolean
}

type ParseLine = ParseLineTable | ParseLineRow | ParseLineInvalid | ParseLineEmpty
type ParseLineTable = { type: "table", name: string }
type ParseLineRow = { type: "row", data: any }
type ParseLineEmpty = { type: "empty" }
type ParseLineInvalid = { type: "invalid", reason: any }
//#endregion

/**
 * Order is important! Job and category table must be first so their IDs can be translated
 * to new ones first (or existing IDs of matching records are chosen).
 */
const tablesToExport = [
    "t_job",
    "t_category",
    "t_platformCi",
    "t_userCi",
    "t_userCiMetadata",
    "t_fakeUserCi"
] satisfies (keyof SchemaV1)[]


const tableProperty = "#TABLE"
const tableStart = (tableName: string) => ({ [tableProperty]: tableName })
const tableStartLine = (tableName: string) => toJson(tableStart(tableName)) + "\n"

function parseLine(line: string): ParseLine {
    if (line.trim() == "") return { type: "empty" }

    try {
        const obj = fromJson(line)
        if (Object.hasOwn(obj, tableProperty)) {
            const tableName = obj[tableProperty]
            if (typeof tableName != "string")
                throw new Error(`expected a string but got ${typeof tableName}`)

            return { type: "table", name: tableName }
        } else {
            return { type: "row", data: obj }
        }
    } catch (e) {
        return { type: "invalid", reason: e }
    }
}
