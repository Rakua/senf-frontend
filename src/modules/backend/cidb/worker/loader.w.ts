import { DefaultLogger, Logger } from "../../../libs/basic/logger.js"
import { ManagedWebWorker } from "../../../libs/manager/worker.js"
import { CiSource } from "../types/ci.js"
import { LoaderInitData, LoaderInput, LoaderProgress, LoaderOutput } from "../types/misc.js"
import { LogCiChecker, newLogCiChecker } from "../db/pci.js"
import { crawlArchive, getSizeFromHeader, LoaderContext, loadUserCis } from "./loader.js"
import { setLogger as setUciLogger } from "../db/uci.js"

type MWW = ManagedWebWorker<LoaderInput, LoaderProgress, LoaderOutput, LoaderInitData>

declare var self: DedicatedWorkerGlobalScope

const mww : MWW = new ManagedWebWorker(self, work, init)
let context: LoaderContext
let lg: Logger

// onunhandledrejection = (ev) => {
//     lg.error("Unhandled promise rejection for promise %O: %O", ev.promise, ev.reason)
// }

async function init(initData: LoaderInitData) {
    lg = new DefaultLogger("cidb:loader:" + mww.workerId())
    DefaultLogger.setMuted(initData.mutedData)        
    context = {
        lcc: await newLogCiChecker(),
        parameters: initData,
        mww: mww,
        lg: lg
    }    
    lg.info("init loader")    
    setUciLogger(lg)
    await context.lcc.init()
}

async function work(input: LoaderInput): Promise<LoaderOutput | undefined> {
    switch (input.type) {
        case "url":
            const resp = await fetch(input.url)
            if (!resp.ok) {
                throw new Error(`${resp.status} ${resp.statusText}`)
            }

            const totalBytes = getSizeFromHeader(resp)            
            const sourceUrl: CiSource = {
                type: "url",
                url: input.url,
                archiveUrl: input.archiveUrl ?? ""
            }
            return loadUserCis(context, resp.body!, sourceUrl, totalBytes, input)

        case "file":
            const sourceFile: CiSource = {
                type: "file",
                filename: input.file.name
            }
            return loadUserCis(context, input.file.stream(), sourceFile, input.file.size, input)

        case "crawl":
            const respArch = await fetch(input.url)
            const totalBytesArch = getSizeFromHeader(respArch)
            return crawlArchive(context, respArch.body!, input, totalBytesArch)
    }
}
