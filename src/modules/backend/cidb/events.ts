export { CidbEvent, addListener, removeListener, emitEvent }

import { Events } from "../../libs/basic/events.js"
import { modName } from "./config.js"
import { ImportDatabaseRv } from "./db/export/import.js"
import { UserCi } from "./types/ci.js"

//#region event types
type CidbEvent = CidbEventLoadersFinished | CidbEventLoadedCiFromMainThread | CidbEventImportFinished

type CidbEventLoadersFinished = {
    type: "loadersFinished",
    data: null
}

/**
 * Emitted when a CI is loaded into the database via `loadCiIntoDb()`
 * from the main thread, e.g. for CIs posted by the user or a CI
 * that is received via a share link.
 */
type CidbEventLoadedCiFromMainThread = {
    type: "loadedCiFromMainThread",
    data: UserCi
}

type CidbEventImportFinished = {
    type: "importFinished",
    data: ImportDatabaseRv
}
//#endregion

const events = new Events<CidbEvent>({ scope: "global", emitterId: modName })
const addListener = events.export().addListener
const removeListener = events.export().removeListener
const emitEvent = events.emitEvent.bind(events)

// const testLoadersFinishedEvent = () => emitEvent({type: "loadersFinished", data: null})