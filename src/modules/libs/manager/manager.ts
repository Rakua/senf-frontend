//#region import/export
export {
    Manager, ManagedWebWorker,
    TaskQueue, TaskQueueElement, TaskId,
    ManagerEvent, ManagerEventAborted, ManagerEventStarted, ManagerEventProgressed, ManagerEventCompleted, ManagerEventFailed,
    modName, addListener, removeListener, eventIsTaskRelated, taskRelatedEventTypes
}

import { ManagedWebWorker } from "./worker.js"

import { EventEmitter, EventHandler, Events } from "../basic/events.js"
import { lg, modName } from "./config.js"
import { DuplicateTaskIdError, TaskDoesNotExistError, TaskNotAssignedError } from "./errors.js"
import { ManagerEvent, ManagerEventAborted, ManagerEventStarted, ManagerEventProgressed, ManagerEventCompleted, ManagerEventFailed, eventIsTaskRelated, taskRelatedEventTypes, ManagerEventTaskRelated } from "./events.js"
import { ManagedWorker, TaskId, Task, TaskQueue, ManagerOptions, ManagerMessageInit, TaskStatus, TaskReport, ManagerMessageTask, WorkerMessage, WorkerId, taskStatus, ManagerMessageAbort, NewTaskOptions, TaskReject, TaskQueueElement, WorkerStatus } from "./types.js"
import { SimpleQueue } from "../etc/queue.js"
//#endregion

const events = new Events<ManagerEvent<any, any, any>>()
const addListener = events.export().addListener
const removeListener = events.export().removeListener

const managerMsgAbort: ManagerMessageAbort = { type: "abort" }

class Manager<Input, Progress, Output, InitData = unknown> implements EventEmitter<ManagerEvent<Input, Progress, Output>> {
    readonly managerName: string
    readonly workerUrl: string | URL

    #workers: ManagedWorker[]
    #workerTargetSize: number
    #workerOptions: WorkerOptions
    #workerIdGenerator: WorkerIdGenerator
    #initMsg: { initData?: InitData, options?: StructuredSerializeOptions }

    #tasks: Map<TaskId, Task<Input, Progress, Output>>
    #taskQueue: TaskQueue<Input>
    #generateTaskId: (x: Input) => TaskId

    readonly #events
    readonly addListener
    readonly removeListener

    constructor(noOfWorkers: number, workerUrl: string | URL, options?: ManagerOptions<Input, InitData>) {
        //if (typeof workerUrl == "string") workerUrl = new URL(workerUrl) //normalize workerUrl to URL
        options = options ?? {}

        this.managerName = options.managerName ?? crypto.randomUUID()
        this.workerUrl = workerUrl

        this.#tasks = new Map()
        this.#taskQueue = options.taskQueue ?? new SimpleQueue() //default to simple queue if no queue is provided
        this.#generateTaskId = options.taskIdFromInput ?? (() => crypto.randomUUID())
        this.#workerOptions = options.workerOptions ?? {}
        //default worker type is module for managed web workers unless specified otherwise
        if (!Object.hasOwn(this.#workerOptions, "type")) this.#workerOptions.type = "module"

        this.#events = new Events<ManagerEvent<Input, Progress, Output>>()
        this.addListener = this.#events.export().addListener
        this.removeListener = this.#events.export().removeListener

        //initialize workers
        this.#workerTargetSize = noOfWorkers
        this.#workerIdGenerator = new WorkerIdGenerator()
        this.#initMsg = { initData: options.initData, options: options.initOptions }
        this.#workers = []
        for (let i = 0; i < this.#workerTargetSize; i++) {
            this.#spawnWorker()
        }

        //try to reach target size whenever a task has finished
        this.addListener(() => this.targetSize(), ["aborted", "completed", "failed"])
    }

    setInitMessage(initData: InitData, initOptions?: StructuredSerializeOptions) {
        this.#initMsg = { initData: initData, options: initOptions }
    }

    /**
     * Use to remove a completed, failed or aborted task from manager
     * @returns true if task was removed
     */
    cleanTask(taskId: TaskId) {
        const t = this.#tasks.get(taskId)
        if (t === undefined) return false
        if (!(t.status == "completed" || t.status == "aborted" || t.status == "failed")) return false
        this.#tasks.delete(taskId)
        return true
    }

    //#region getters
    noOfWorkers(type?: WorkerStatus['type'] | WorkerStatus['type'][]) {
        if (type == undefined) return this.#workers.length
        if (!Array.isArray(type)) type = [type]
        return this.#workers.filter(mw => type.includes(mw.status.type)).length
    }

    noOfInitializedWorkers() {
        return this.#workers.filter(mw => mw.status.type != "init").length
    }

    workersReport() {
        return this.#workers.map(w => ({ id: w.id, status: w.status }))
    }

    hasTask(taskId: TaskId) {
        return this.#tasks.has(taskId)
    }

    listTasks(status?: TaskStatus | TaskStatus[]): TaskId[] {
        if (status === undefined) status = [...taskStatus]
        if (status !== undefined && !Array.isArray(status)) status = [status]
        return Array.from(this.#tasks)
            .filter(([_, value]) => status?.includes(value.status))
            .map(([_, value]) => value.taskId)
    }

    taskReport(taskId: TaskId): TaskReport<Input, Progress, Output> {
        const t = this.#tasks.get(taskId)
        if (t == undefined) throw new TaskDoesNotExistError(taskId)

        return {
            taskId: t.taskId,
            status: t.status,
            input: t.input,
            lastProgress: t.lastProgress,
            output: t.output,
            createdOn: t.createdOn,
            updatedOn: t.updatedOn
        }
    }

    addListenerForTask(taskId: TaskId, handler: EventHandler<ManagerEvent<Input, Progress, Output>>, listensTo?: ManagerEventTaskRelated<Input, Progress, Output>['type'][]) {
        if (listensTo === undefined) listensTo = ["aborted", "completed", "enqueued", "failed", "progressed", "started"]
        return this.addListener((ev) => {
            if (ev.data.taskId === taskId) handler(ev)
        }, listensTo)
    }

    hasUnfinishedTasks() {
        return this.listTasks(["enqueued", "started", "waiting"]).length > 0
    }
    //#endregion

    /**
     * Causes the manager to try and adjust the number of workers to reach 
     * the target size. If the target size is larger than the current no. 
     * of workers then new workers will be spawned. If it is smaller then 
     * idling workers will be terminated until the target size is reached.
     * 
     * If it is not possible to reach the target size because all workers
     * are busy then the manager will call this method automatically again
     * as soons as a task has finished since a worker might be idling then.
     * 
     * If `noOfWorkers` is undefined, then the last targetSize will be 
     * assumed. 
     */
    targetSize(noOfWorkers?: number) {
        if (noOfWorkers !== undefined) this.#workerTargetSize = noOfWorkers

        const diff = this.#workerTargetSize - this.#workers.length
        if (diff > 0) {
            //target size > no. of workers => add new workers
            for (let i = 0; i < diff; i++) {
                this.#spawnWorker()
            }
        } else if (diff < 0) {
            //target size < no. of workers => terminate idling workers
            for (let i = 0; i < -1 * diff; i++) {
                if (!this.#terminateIdlingWorker()) break                
            }
        }
    }

    /**
     * If the `output` property of the return value is ignored, set `useDefaultCatchHandler` 
     * in the `options` parameter to `true` to log an error thrown by the worker
     */
    newTask(input: Input, options?: NewTaskOptions): { taskId: TaskId, output: Promise<Output> } {
        const useDefaultCatchHandler = options?.useDefaultCatchHandler ?? false

        const now = new Date()
        const taskId = this.#generateTaskId(input)
        if (this.#tasks.has(taskId)) throw new DuplicateTaskIdError(taskId)

        const promise = new Promise<Output>((resolve, reject) => {
            //store and enqueue task
            this.#tasks.set(taskId, {
                taskId: taskId,
                status: "enqueued",

                createdOn: now,
                updatedOn: now,

                input: input,
                options: options?.structuredSerializeOptions,

                resolve: resolve,
                reject: reject
            })
            this.#taskQueue.enqueue({ taskId: taskId, input: input })
        })

        if (useDefaultCatchHandler) promise.catch((reason: TaskReject) => {
            switch (reason.type) {
                case "failed":
                    lg.error("Task with task id %s failed: %O", taskId, reason.error)
                    break
                case "aborted":
                    lg.log("Task with task id %s was aborted by user", taskId)
                    break
            }
        })

        this.#emitEvent({
            type: "enqueued",
            data: {
                taskId: taskId,
                managerName: this.managerName,
                input: input
            }
        })
        this.#processQueueWithDelay()
        return { taskId: taskId, output: promise }
    }

    /**
     * Aborts the task with the given `taskId`. Calling this method more than once 
     * has no effect. Only the first call will cause the manager to send an abort
     * message to the webworker and subsequent calls will immediately return the 
     * promise created on the first call.
     * 
     * @returns resolves to `true` when the task has been aborted and `false` if it
     * has completed or failed before abortion was possible
     */
    abortTask(taskId: TaskId): Promise<boolean> {
        const t = this.#tasks.get(taskId)
        if (t === undefined) throw new TaskDoesNotExistError(taskId)

        //abort has been already called => return promise from first abort call
        if (t.abortPromise !== undefined) return t.abortPromise

        //if task is still enqueued, there might be no worker assigned to it
        const mw = this.#findWorker(taskId)
        const workerName = mw === undefined ? "?" : this.#workerName(mw.id)
        const workerId = mw === undefined ? -1 : mw.id
        const names = {
            managerName: this.managerName,
            workerName: workerName,
            workerId: workerId
        }

        const abortPromise = new Promise<boolean>((abortResolve) => {
            switch (t.status) {
                case "enqueued":
                    //not assigned to worker => no need to send abort message
                    //the task will be removed from the queue in this.#processQueue
                    t.status = "aborted"
                    abortResolve(true)
                    this.#emitEvent({
                        type: "aborted",
                        data: {
                            taskId: t.taskId,
                            input: t.input,
                            aborted: true,
                            ...names
                        }
                    })
                    break

                case "waiting":
                    t.abortResolve = abortResolve
                    //wait with sending abort message until worker has started
                    break

                case "started":
                    if (mw === undefined) {
                        //task in status started but no worker found for it
                        const err = new TaskNotAssignedError(taskId)
                        lg.impossible("%s: %O", err.message, err)
                        throw err
                    }
                    t.abortResolve = abortResolve
                    mw.worker.postMessage(managerMsgAbort)
                    break

                case "aborted":
                    //will never happen
                    lg.impossible("Task %O has status aborted before it has been aborted?!", t)
                    break

                //nothing to abort since task has already finished
                default:
                    abortResolve(false)
                    const evAborted2: ManagerEventAborted<Input> = {
                        type: "aborted",
                        data: {
                            taskId: t.taskId,
                            input: t.input,
                            aborted: false,
                            ...names
                        }
                    }
                    this.#emitEvent(evAborted2)
                    break
            }
        })
        t.abortPromise = abortPromise
        return abortPromise
    }

    #processQueueWithDelay() {
        setTimeout(() => this.#processQueue(), 0)
    }

    #processQueue() {
        const mw = this.#findIdleWorker()
        if (mw === undefined) return //no free worker => cannot process queue

        const qt = this.#taskQueue.dequeue()
        if (qt === undefined) return //empty queue => nothing to process

        const t = this.#tasks.get(qt.taskId)
        if (t === undefined) {
            lg.impossible("Task %O in queue not contained in this.#tasks", qt)
            return
        }

        if (t.status == "aborted") {
            //task has been aborted before it started, skip it and continue with next element in queue
            this.#processQueue()
            return
        }

        if (t.status != "enqueued") {
            lg.impossible("Expected task %O to have status enqueued, got %s", t, t.status)
            return
        }

        //assign task to free worker
        t.status = "waiting"
        t.updatedOn = new Date()
        mw.status = { type: "busy", taskId: t.taskId }
        const msg: ManagerMessageTask<Input> = {
            type: "task",
            input: t.input
        }
        mw.worker.postMessage(msg, t.options)
    }

    #onWorkerMessage(mw: ManagedWorker, ev: MessageEvent<WorkerMessage<Progress, Output>>) {
        const now = new Date()
        const msg = ev.data

        const workerName = this.#workerName(mw.id)
        const names = {
            managerName: this.managerName,
            workerName: workerName,
            workerId: mw.id
        }

        switch (mw.status.type) {
            case "init":
                switch (msg.type) {
                    case "initialized":
                        //worker finished init                        
                        this.#freeWorker(mw)
                        this.#emitEvent({
                            type: "initialized",
                            data: names
                        })
                        break
                    case "initFailed":
                        //worker init failed
                        this.#removeWorker(mw)
                        this.#emitEvent({
                            type: "initFailed",
                            data: {
                                error: msg.error,
                                ...names
                            }
                        })
                        break
                    default:
                        //unexpected message
                        lg.impossible("Got illegal message %O from initializing worker %s", ev, workerName)
                }
                break

            case "idle":
                lg.impossible("Got message %O from managed worker %s that should be idling (message ignored)", ev, workerName)
                break

            case "busy": {
                const taskId = mw.status.taskId
                const t = this.#tasks.get(taskId)
                if (t === undefined) {
                    lg.impossible("TaskId %s associated with worker %s does not exist", mw.status.taskId, this.#workerName(mw.id))
                    break
                }

                switch (msg.type) {
                    case "started":
                        t.status = "started"
                        t.updatedOn = now

                        this.#emitEvent({
                            type: "started",
                            data: {
                                taskId: taskId,
                                input: t.input,
                                ...names
                            }
                        })

                        //if task was aborted in waiting state, send abort message after worker has started
                        if (t.abortResolve !== undefined) mw.worker.postMessage(managerMsgAbort)

                        break

                    case "progressed":
                        t.lastProgress = msg.progress
                        t.updatedOn = now

                        this.#emitEvent({
                            type: "progressed",
                            data: {
                                taskId: taskId,
                                input: t.input,
                                progress: msg.progress,
                                ...names
                            }
                        })
                        break

                    case "completed":
                        t.status = "completed"
                        t.output = msg.output
                        t.updatedOn = now

                        t.resolve(msg.output)
                        if (t.abortResolve !== undefined) t.abortResolve(false)

                        this.#emitEvent({
                            type: "completed",
                            data: {
                                taskId: taskId,
                                input: t.input,
                                output: msg.output,
                                ...names
                            }
                        })
                        this.#freeWorker(mw)
                        break

                    case "aborted":
                        t.status = "aborted"
                        t.updatedOn = now

                        t.reject({ type: "aborted" })
                        if (t.abortResolve !== undefined) t.abortResolve(true)

                        this.#emitEvent({
                            type: "aborted",
                            data: {
                                taskId: taskId,
                                input: t.input,
                                aborted: true,
                                ...names
                            }
                        })
                        this.#freeWorker(mw)
                        break

                    case "failed":
                        t.status = "failed"
                        t.error = msg.error
                        t.updatedOn = now

                        t.reject({ type: "failed", error: t.error })
                        if (t.abortResolve !== undefined) t.abortResolve(false)

                        this.#emitEvent({
                            type: "failed",
                            data: {
                                taskId: taskId,
                                input: t.input,
                                error: t.error,
                                ...names
                            }
                        })
                        this.#freeWorker(mw)
                        break

                    default:
                        lg.impossible("Got illegal message %O from busy worker %s", ev, workerName)
                }
            }
        }
    }

    //#region worker related
    #freeWorker(mw: ManagedWorker) {
        mw.status = { type: "idle" }
        this.#processQueueWithDelay()
    }

    //terminates an idling worker (if none exists, nothing happens)
    #terminateIdlingWorker(): boolean {
        const mw = this.#findIdleWorker()
        if (mw === undefined) return false
        return this.#removeWorker(mw)
    }

    //terminates worker and removes it from this.#workers
    #removeWorker(mw: ManagedWorker): boolean {
        mw.worker.terminate()
        const oldLen = this.#workers.length
        this.#workers = this.#workers.filter(mwx => mwx.id != mw.id)
        return this.#workers.length < oldLen
    }

    #findIdleWorker(): ManagedWorker | undefined {
        return this.#workers.find(mw => mw.status.type == "idle")
    }

    #findWorker(taskId: TaskId): ManagedWorker | undefined {
        return this.#workers.find(mw => mw.status.type == "busy" && mw.status.taskId == taskId)
    }

    #spawnWorker() {
        const workerId = this.#workerIdGenerator.id()
        const workerName = this.#workerName(workerId)
        const worker = new Worker(this.workerUrl, { ...this.#workerOptions, name: workerName })
        const mw: ManagedWorker = { id: workerId, worker: worker, status: { type: "init" } }
        this.#workers.push(mw)

        worker.addEventListener("message", (ev) => this.#onWorkerMessage(mw, ev))
        this.#postInitMsg(mw)
    }

    #workerName(workerId: number) {
        return `worker#${workerId}@${this.managerName}`
    }
    //#endregion

    //#region etc
    #postInitMsg(mw: ManagedWorker): void {
        const msg: ManagerMessageInit<InitData> = {
            type: "init",
            managerName: this.managerName,
            workerName: this.#workerName(mw.id),
            workerId: mw.id,
            data: this.#initMsg?.initData
        }
        mw.worker.postMessage(msg, this.#initMsg?.options)
    }

    #emitEvent(ev: ManagerEvent<Input, Progress, Output>) {
        this.#events.emitEvent(ev)
        events.emitEvent(ev)
    }
    //#endregion
}

class WorkerIdGenerator {
    #cur: number

    constructor() {
        this.#cur = 0
    }

    id() {
        const id = this.#cur
        this.#cur++
        return id
    }
}
