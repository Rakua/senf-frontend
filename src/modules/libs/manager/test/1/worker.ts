import { ManagedWebWorker } from "../../manager.js"
import { sleep } from "../../../basic/misc.js"
import { TestInput, TestProgress, TestOutput, TestContext, InitData } from "./test.js"

declare var self: DedicatedWorkerGlobalScope;

const mww = new ManagedWebWorker<TestInput, TestProgress, TestOutput, InitData>(self, work, init)
const context: TestContext = { tasksCompleted: -1, initData: -1, initUint8: new Uint8Array() }

async function init(initData: InitData) {
    context.tasksCompleted = 0
    context.initData = initData.initData
    context.initUint8 = initData.uint8
    //if(mww.workerId() == 2) throw new Error("fail init for worker 2")
    console.log("worker %s of manager %s with shared context %O", mww.workerName(), mww.managerName(), context)
}

async function work(input: TestInput) {
    console.debug("Uint8 in worker: %O", input.uint8)

    for (let i = 0; i < input.n; i++) {        
        if (mww.shouldAbort()) return undefined
        await sleep(1000)    
        mww.progressed(i)
    }

    if (input.n == 5) {
        throw new Error("input 5 forbidden")
    }

    context.tasksCompleted++
    console.log("worker %s finished, context %O", mww.workerName(), context)

    const output = input.n
    return output
}

