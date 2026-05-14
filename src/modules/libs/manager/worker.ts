export { ManagedWebWorker }

import { AnyButUndefined } from "../basic/misc.js"
import { lg } from "./config.js"
import { GenericWebWorkerError, WorkerBusyError, WorkerInitDataUndefined, WorkerNotBusyError } from "./errors.js"
import { ManagerMessage, WorkerMessageAborted, WorkerMessageCompleted, WorkerMessageFailed, WorkerMessageInitializationFailed, WorkerMessageInitialized, WorkerMessageProgressed, WorkerMessageStarted } from "./types.js"

class ManagedWebWorker<Input, Progress, Output extends AnyButUndefined, InitData = unknown> {
    #managerName: string
    #workerName: string
    #workerId: number

    #busy: boolean
    #abortFlag: boolean

    readonly #self: DedicatedWorkerGlobalScope
    readonly #work: (x: Input) => Promise<Output | undefined>
    readonly #init?: (initData: InitData) => Promise<void>

    /**
     * The function `work` should adhere to the following rules where `mww` refers to 
     * the instance of the ManagedWebWorker in the web worker:
     * - regularly give the worker an opportunity to register abort signals (e.g. by 
     *   calling `await Promise.resolve()` in case of a long sync computation)
     * - regularly check if an abort signal was received via `mww.shouldAbort()` and
     *   return undefined in that case (`if (mww.shouldAbort()) return undefined`)
     * - return undefined **only if** an abort signal was received
     * - call `mww.progressed()` to report progress (optional)
     * 
     * If the `init` parameter is provided for the web worker then initData must be set 
     * by the manager in the constructor in the parameter `options` or with the method 
     * `setInitMessage`.
     * 
     * @param self global scope of the webworker `self`
     * @param work called for every new task
     * @param init use to initialize worker
     */
    constructor(self: DedicatedWorkerGlobalScope, work: (x: Input) => Promise<Output | undefined>, init?: (initData: InitData) => Promise<void>) {
        this.#managerName = "?"
        this.#workerName = "?"
        this.#workerId = -1

        this.#busy = false
        this.#abortFlag = false

        this.#self = self
        this.#work = work
        this.#init = init
        this.#self.onmessage = this.onMessage.bind(this)
    }

    async onMessage(ev: MessageEvent<ManagerMessage<Input, InitData>>) {
        const msg = ev.data
        switch (msg.type) {
            case "init":
                this.#managerName = msg.managerName
                this.#workerName = msg.workerName
                this.#workerId = msg.workerId

                if (this.#init !== undefined) {
                    try {
                        if (msg.data === undefined) throw new WorkerInitDataUndefined(ev)
                        await this.#init(msg.data)
                        this.#initialized()
                    } catch (e) {
                        //failed to initialize => report to manager and terminate
                        lg.error("Managed worker %s failed to initialize: %O", this.#workerName, e)
                        this.#initFailed(e)
                        this.#self.close()
                    }
                } else {
                    //no init function to call
                    this.#initialized()
                }
                
                break

            case "task":
                if (this.#busy) {
                    //manager should have known that worker is busy
                    const err = new WorkerBusyError(ev)
                    lg.impossible("%s: %O", err.message, err)
                    throw new WorkerBusyError(ev)
                }

                this.#busy = true
                try {
                    this.#started()
                    const output = await this.#work(msg.input)
                    if (output === undefined) {
                        this.#aborted()
                    } else {
                        this.#completed(output)
                    }
                } catch (e) {
                    this.#failed(e)
                } finally {
                    this.#busy = false
                    this.#abortFlag = false
                }
                break

            case "abort":
                if (!this.#busy) {
                    //worker not busy, ignore abort signal
                    const err = new WorkerNotBusyError(ev)
                    lg.impossible("%s: %O", err.message, err)
                    throw new WorkerNotBusyError(ev)
                }

                this.#abortFlag = true
                break
        }
    }

    /**
     * Regularly check this flag in `work()` and if it is true, return
     * undefined in `work()` to let the manager know the task has been
     * aborted.
     */
    shouldAbort() {
        return this.#abortFlag
    }

    //#region messages to manager
    #initialized() {
        const msg: WorkerMessageInitialized = { type: "initialized" }
        this.#self.postMessage(msg)
    }

    #initFailed(e: any) {
        const err = e instanceof Error ? e : new GenericWebWorkerError(e)
        const msg: WorkerMessageInitializationFailed = { type: "initFailed", error: err }
        this.#self.postMessage(msg)

    }

    //called by managed web worker before it starts `work()`
    #started() {
        const msg: WorkerMessageStarted = { type: "started" }
        this.#self.postMessage(msg)
    }

    /**
     * Call in `work()` to let manager know the latest progress of 
     * the task being worked on
     */
    progressed(progress: Progress) {
        const msg: WorkerMessageProgressed<Progress> = { type: "progressed", progress: progress }
        this.#self.postMessage(msg)
    }


    // called when `work()` returns; output = return value of `work()`
    #completed(output: Output) {
        const msg: WorkerMessageCompleted<Output> = { type: "completed", output: output }
        this.#self.postMessage(msg)
    }

    // called when `work()` returns undefined; `work()` should check  
    #aborted() {
        const msg: WorkerMessageAborted = { type: "aborted" }
        this.#self.postMessage(msg)
    }

    // called when `work()` throws an error
    #failed(e: any) {
        const err = e instanceof Error ? e : new GenericWebWorkerError(e)
        const msg: WorkerMessageFailed = { type: "failed", error: err }
        this.#self.postMessage(msg)
    }
    //#endregion

    //#region names
    managerName() {
        return this.#managerName
    }

    workerName() {
        return this.#workerName
    }

    workerId() {
        return this.#workerId
    }
    //#endregion    
}

// type WorkGenerator<Input, Progress, Output> =
//     (input: Input) => AsyncGenerator<Awaited<Progress>, Awaited<Output>, void>
