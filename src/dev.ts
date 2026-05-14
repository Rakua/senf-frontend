export { init, devTest }

import { exposeToDev, lg, logEventsFrom, modules, mutedData, devTest } from "./config.dev.js"
import { EmittedEvent } from "./modules/libs/basic/events.js"
import { DefaultLogger } from "./modules/libs/basic/logger.js"

declare global {
    interface Window {
        dev: any
    }
}

function init() {
    //listen to events from all modules that emit events (except log)
    const listenTo = []
    for (const m of modules) {
        if (m.addListener !== undefined) {
            m.addListener(logEvent(m.modName))
            listenTo.push(m.modName)
        }
    }
    //lg.log("added listeners to modules: %O", listenTo)
    lg.log("logging events from: %O", logEventsFrom.map(x => x.name))

    //mute
    DefaultLogger.setMuted(mutedData)
    lg.log("muted: %O", DefaultLogger.getMuted())

    //expose entities to developer for testing
    const namedMods: { [key: string]: any } = {}
    modules.forEach(m => namedMods[m.modName] = m)
    window.dev = {
        ...exposeToDev,
        mods: namedMods,
    }
}

function logEvent(moduleName: string, filter?: (ev: EmittedEvent) => boolean) {
    filter ??= () => true
    return function (ev: EmittedEvent) {
        const x = logEventsFrom.find(x => x.name == moduleName)
        if (x === undefined || !(x.filter ?? (() => true))(ev)) return
        lg.log("event %s.%s:%O", moduleName, ev.type, ev.data)
    }
}
