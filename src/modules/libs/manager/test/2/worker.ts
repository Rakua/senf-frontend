import { ManagedWebWorker } from "../../manager.js"
import { sleep } from "../../../basic/misc.js"
import { TestInput, TestProgress, TestOutput, TestContext } from "./test.js"

declare var self: DedicatedWorkerGlobalScope;

const mww = new ManagedWebWorker<TestInput, TestProgress, TestOutput>(self, work)
const context: TestContext = { tasksCompleted: -1, initData: -1, initUint8: new Uint8Array() }

async function work(input: TestInput) {
    console.log("work from test2 worker")

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

