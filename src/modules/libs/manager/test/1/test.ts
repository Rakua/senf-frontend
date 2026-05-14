export { testManager, TestInput, TestProgress, TestOutput, TestContext, InitData }

import { DefaultLogger } from "../../../basic/logger.js"
import { Manager } from "../../manager.js"

type TestInput = { n: number, uint8: Uint8Array }
type TestProgress = number
type TestOutput = number
type TestContext = { tasksCompleted: number, initData: number, initUint8: Uint8Array }
type InitData = { initData: number, uint8: Uint8Array }

const lg = new DefaultLogger("thread.ts")

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

    const initData: InitData = {
        initData: 22,
        uint8: uint8arr(1, 2, 3)
    }
    const manager = new Manager<TestInput, TestProgress, TestOutput>(
        3, "modules/libs/manager/test/worker.js", { managerName: "testManager", initData: initData })

    const uint8 = uint8arr(4, 5, 6)
    const t = manager.newTask({ n: 5, uint8: uint8 }, { useDefaultCatchHandler: true, structuredSerializeOptions: { transfer: [uint8.buffer] } })
    t.output.then((out) => lg.info("task completed: %O", out))

    //setTimeout(async () => lg.info("Abort task res: %s", await manager.abortTask(t.taskId)), 5000)

    return { managaer: manager, uint8: uint8 }
}