export { testManager, TestInput, TestProgress, TestOutput, TestContext }

import { DefaultLogger } from "../../../basic/logger.js"
import { Manager } from "../../manager.js"

type TestInput = { n: number }
type TestProgress = number
type TestOutput = number
type TestContext = { tasksCompleted: number, initData: number, initUint8: Uint8Array }

const lg = new DefaultLogger("manager-test")

/*
    todo: 
    - test Promise.resolve() to interrupt -> does not work -> need await sleep(0)
*/

function uint8arr(a: number, b: number, c: number) {
    const x = new Uint8Array(3)
    x[0] = a
    x[1] = b
    x[2] = c
    return x
}

function testManager() {

    const manager = new Manager<TestInput, TestProgress, TestOutput>(
        3, "modules/libs/manager/test2/worker.js", { managerName: "testManager2" })

    //const t = manager.newTask({ n: 5 }, { useDefaultCatchHandler: true })
    //t.output.then((out) => lg.info("task completed: %O", out))

    //manager.addListener((ev) => lg.log("EV: %O", ev))
    //setTimeout(async () => lg.info("Abort task res: %s", await manager.abortTask(t.taskId)), 5000)

    return { manager: manager }
}