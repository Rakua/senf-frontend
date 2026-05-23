/**
 * Configuration file for dev mode
 */

//#region import/export
export { lg, logEventsFrom, mutedData, exposeToDev, modules, devTest }

import { DefaultLogger, MutedData, MutedDataSources } from "./modules/libs/basic/logger.js"
import { EmittedEvent } from "./modules/libs/basic/events.js"

import * as BasicEvents from "./modules/libs/basic/events.js"
import * as BasicLogger from "./modules/libs/basic/logger.js"
import * as BasicReactive from "./modules/libs/basic/reactive.js"
import * as BasicMisc from "./modules/libs/basic/misc.js"

import * as EtcBuffer from "./modules/libs/etc/buffer.js"
import * as EtcFetch from "./modules/libs/etc/fetch.js"
import * as EtcGuard from "./modules/libs/etc/guard.js"
import * as EtcHighlight from "./modules/libs/etc/highlight.js"
import * as EtcMathjax from "./modules/libs/etc/mathjax.js"
import * as EtcMisc from "./modules/libs/etc/misc.js"
import * as EtcQueue from "./modules/libs/etc/queue.js"
import * as EtcRouter from "./modules/libs/etc/router.js"
import * as EtcSdst from "./modules/libs/etc/sdst.js"
import * as EtcSettings from "./modules/libs/etc/settings.js"
import * as EtcStorage from "./modules/libs/etc/storage.js"
import * as EtcTab from "./modules/libs/etc/tab.js"

import * as LibsManager from "./modules/libs/manager/manager.js"
import * as BackendTime from "./modules/backend/time.js"
import * as BackendPost from "./modules/backend/post/post.js"
import * as BackendCidb from "./modules/backend/cidb/cidb.js"

import { toggleDarkMode, toggleLayout } from "./config.js"
import { isMainTab } from "./modules/libs/etc/tab.js"
//#endregion

//#region types
interface ModuleI {
    modName: string,
    addListener?: (handler: (ev: any) => void, listensTo?: any) => string
}

type LogEventsFrom = { name: EventSource, filter?: EventFilter<any> }[]

type EventFilter<T = EmittedEvent> = (ev: T) => boolean
type EventSource = typeof eventSources[number]
type LogSource = typeof logSources[number]

//add module names that emit events or use a logger for auto completion
const logSources = [
    "main", "dev",

    "fetch", "highlight", "dialogs", "mathjax", "settings", "storage", "tab", "manager", "router", "scroll",

    "parser", "post", "time", "cidb", "cidb:*", "cidb:computer", "cidb:loader:*",

    "App", "HomePage", "InfoPage", "LoadPage", "LocationPage", "PlacesPage",
    "PostPage", "QueuePage", "SettingsPage", "SyntaxPage",

    "Countdown", "KeyId", "LoadingDots", "PostBody", "PostFull", "PostGallery", "EchoGallery", "CiGallery", "WaitingTime",
    "TabsComponent", "PaginatedComponent", "DateComponent", "UriComponent", "PosterComponent", "PromptComponent", "QuerybarComponent",
    "PeriodSelect", "GalleryFilter", "LocationGallery"
] as const
const eventSources = ["router", "settings", "storage", "tab", "manager", "cidb", "cidb:computer", "post"] as const
//#endregion

const modName = "dev"
const lg = new DefaultLogger(modName)
const modules: ModuleI[] = [
    EtcStorage, EtcSettings, EtcRouter, EtcTab, LibsManager,
    BackendTime, BackendPost, BackendCidb
]

//all events emitted by a module in this array are logged
const logEventsFrom: LogEventsFrom = [
    { name: "post", filter: (ev: BackendPost.PostEvent) => ev.type != "work" },
    { name: "cidb" },
    { name: "cidb:computer" },
    { name: "router" }
]

//the loggers of all sources in this array are muted (or unmuted if invertMute is true)
const mutedSources: MutedDataSources<LogSource> = [
    "main",
    "dev",
    // "settings",
    // "LocationPage",
    // "SettingsPage",
    //"PeriodSelect",
    //"TabsComponent",
    // "App",
    // "router",
    // "GalleryFilter",
    // "EchoGallery",
    // "LocationGallery",
    // "QuerybarComponent",

    // "HomePage",
    // "QueuePage",

    //"LocationPage",
    // "cidb",
    // "cidb:*",
    // "post",
    //"App",
    // "post",
    // "PostPage",
    //"CiGallery",
    //"App",
    //"UriComponent"
]

const mutedData: MutedData = {
    invertMute: true,
    mutedSources: mutedSources
}

const exposeToDev = {
    isMainTab, DefaultLogger,
    toggleDarkMode, toggleLayout,
    modules: {
        BasicEvents, BasicLogger, BasicReactive, BasicMisc,
        EtcBuffer, EtcFetch, EtcGuard, EtcHighlight, EtcMathjax, EtcMisc, EtcQueue,
        EtcRouter, EtcSdst, EtcSettings, EtcStorage, EtcTab, LibsManager,
        BackendTime, BackendPost, BackendCidb
    },
    settings: () => EtcSettings.getSettings(),
    test: {
        //navi: (page: string) => EtcRouter.navigateTo(new EtcRouter.NaviPath(page), true)
    }
}

/**
 * called in dev mode at the end of `main()`
 */
async function devTest() {
    lg.info("devTest() start")

    setTimeout(() => {
        (window as any).s = EtcSettings.getSettings()
    })

    //await testChainHashes()    
    //await testSigs(true)
    //await testLogHashes()
}
