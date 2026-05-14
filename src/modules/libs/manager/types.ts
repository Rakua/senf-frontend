import { Queue } from "../etc/queue.js"

export {
    ManagerMessage, ManagerMessageInit, ManagerMessageTask, ManagerMessageAbort,
    WorkerMessage, WorkerMessageInitialized, WorkerMessageInitializationFailed, WorkerMessageStarted, WorkerMessageProgressed, WorkerMessageCompleted, WorkerMessageAborted, WorkerMessageFailed,
    TaskId, Task, TaskStatus, taskStatus, TaskReport, TaskQueue, TaskQueueElement, TaskReject, TaskRejectAborted, TaskRejectFailed,
    ManagedWorker, WorkerId, WorkerStatus, WorkerStatusInit, WorkerStatusIdle, WorkerStatusBusy,
    ManagerOptions, NewTaskOptions
}

//#region worker related
type WorkerId = number

type ManagedWorker = {
    id: WorkerId,
    worker: Worker,
    status: WorkerStatus
}

type WorkerStatus = WorkerStatusInit | WorkerStatusIdle | WorkerStatusBusy
type WorkerStatusInit = { type: "init" }
type WorkerStatusIdle = { type: "idle" }
type WorkerStatusBusy = { type: "busy", taskId: TaskId }

type ManagerOptions<Input, InitData> = {
    workerOptions?: WorkerOptions,
    managerName?: string,
    taskQueue?: TaskQueue<Input>,
    taskIdFromInput?: (x: Input) => TaskId,
    initData?: InitData,
    initOptions?: StructuredSerializeOptions
}

/**
 * @param useDefaultCatchHandler set to true if no catch handler is registered on the promise 
 * returned by `Manager.newTask`. This prevents the console from printing "Uncaught (in promise)"
 * in case the task is aborted by the user or fails and instead gracefully outputs something to
 * the log.
 */
type NewTaskOptions = {
    structuredSerializeOptions?: StructuredSerializeOptions,
    useDefaultCatchHandler?: boolean
}
//#endregion

//#region task related
type TaskId = string

type Task<Input, Progress, Output> = {
    taskId: TaskId,
    status: TaskStatus,

    createdOn: Date,
    updatedOn: Date,

    input: Input,
    options?: StructuredSerializeOptions,
    lastProgress?: Progress,
    output?: Output,
    error?: Error, //if worker threw an error, this is stored here (implies status = "failed")

    resolve: (value: Output | PromiseLike<Output>) => void,
    reject: (err: TaskReject) => void,
    abortResolve?: (value: boolean | PromiseLike<boolean>) => void,
    abortPromise?: Promise<boolean>
}

type TaskReject = TaskRejectFailed | TaskRejectAborted
type TaskRejectFailed = { type: "failed", error: Error }
type TaskRejectAborted = { type: "aborted" }

const taskStatus = [
    "enqueued",
    "waiting", //task dequeued and sent to worker but worker has not yet started on it
    "started",
    "completed",
    "aborted",
    "failed" //worker threw an error
] as const
type TaskStatus = typeof taskStatus[number]

type TaskQueue<Input> = Queue<TaskQueueElement<Input>>
type TaskQueueElement<Input> = { taskId: TaskId, input: Input }

type TaskReport<Input, Progress, Output> = {
    taskId: TaskId,
    status: TaskStatus,
    workerId?: number,

    createdOn: Date,
    updatedOn: Date,

    input: Input,
    lastProgress?: Progress,
    output?: Output,
    error?: Error
}
//#endregion

//#region messages from manager to worker
type ManagerMessage<Input, InitData> = ManagerMessageInit<InitData> | ManagerMessageTask<Input> | ManagerMessageAbort

type ManagerMessageInit<InitData> = {
    type: "init",
    managerName: string,
    workerName: string,
    workerId: number,
    data?: InitData
}

type ManagerMessageTask<Input> = {
    type: "task",
    input: Input
}

type ManagerMessageAbort = {
    type: "abort"
}
//#endregion

//#region messages from worker to manager
type WorkerMessage<Progress, Output> = WorkerMessageInitialized | WorkerMessageInitializationFailed | WorkerMessageStarted | WorkerMessageProgressed<Progress> | WorkerMessageCompleted<Output> | WorkerMessageAborted | WorkerMessageFailed

type WorkerMessageInitialized = {
    type: "initialized"
}

type WorkerMessageInitializationFailed = {
    type: "initFailed",
    error: Error
}

type WorkerMessageStarted = {
    type: "started"
}

type WorkerMessageProgressed<Progress> = {
    type: "progressed",
    progress: Progress
}

type WorkerMessageCompleted<Output> = {
    type: "completed",
    output: Output
}

type WorkerMessageAborted = {
    type: "aborted"
}

type WorkerMessageFailed = {
    type: "failed",
    error: Error
}
//#endregion

