import { DefaultLogger } from "../../../libs/basic/logger.js"
import { sleep } from "../../../libs/basic/misc.js"
import { LogCiChecker, newLogCiChecker } from "../db/pci.js"
import { setLogger as setStatsLogger } from "../db/stats.js"
import { ComputerInitData, ComputerMessage } from "../types/misc.js"
import { work0 } from "./computer.js"

let lcc : LogCiChecker
let context: ComputerInitData
const lg = new DefaultLogger("cidb:computer")

declare var self: DedicatedWorkerGlobalScope
self.onmessage = async (ev) => {
    const msg = ev.data as ComputerMessage
    switch (msg.type) {
        case "init":
            lg.info("init computer")    
            setStatsLogger(lg)
            context = msg.data
            DefaultLogger.setMuted(context.mutedData)
            
            lcc = await newLogCiChecker()
            await init(lcc)
            return

        case "work":
            lg.debug("work triggered via message")
            await lcc.init()
            await work(lcc)
            return
    }
}

async function init(lcc: LogCiChecker) {
    while (true) {
        await sleep(context.sleepIntv)
        await work(lcc)
    }
}

async function work(lcc: LogCiChecker) {
    navigator.locks.request("cidb:computer-work", () => work0(lcc))
}