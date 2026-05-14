export { TableName, db, deleteDatabase, tableCount }

import Dexie from "../../../../libs/dexie/dexie.js"
import { lg, modName } from "../../config.js"
import { schemaV1, SchemaV1 } from "./v1.js"

type TableName = keyof SchemaV1
const db = new Dexie(modName) as Dexie & SchemaV1
db.version(1).stores(schemaV1)

function deleteDatabase() {
    if (confirm("Do you really want to delete your database?")) {
        db.delete()
        return true
    }
    return false
}

function tableCount(tableName: TableName) {
    return db[tableName].count()
}