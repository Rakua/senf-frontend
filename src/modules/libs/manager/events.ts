export {
    ManagerEvent, ManagerEventType, ManagerEventTaskRelated,
    ManagerEventEnqueued, ManagerEventStarted, ManagerEventProgressed, ManagerEventCompleted, ManagerEventAborted, ManagerEventFailed,
    ManagerEventWorkerInitFailed, ManagerEventWorkerInitialized,
    eventIsTaskRelated, taskRelatedEventTypes
}

import { TaskId } from "./types.js"

type ManagerEvent<Input, Progress, Output> =
    ManagerEventWorkerInitialized | ManagerEventWorkerInitFailed | ManagerEventTaskRelated<Input, Progress, Output>
    //ManagerEventWorkerInitialized | ManagerEventWorkerInitFailed | ManagerEventWorkerIdle | ManagerEventTaskRelated<Input, Progress, Output>

type ManagerEventTaskRelated<Input, Progress, Output> =
    ManagerEventEnqueued<Input> | ManagerEventStarted<Input> | ManagerEventProgressed<Input, Progress> | ManagerEventCompleted<Input, Output> | ManagerEventAborted<Input> | ManagerEventFailed<Input>

type ManagerEventType = ManagerEvent<unknown, unknown, unknown>['type']

//#region task related events
type ManagerEventEnqueued<Input> = {
    type: "enqueued",
    data: {
        taskId: TaskId,
        managerName: string,
        input: Input
    }
}

type ManagerEventStarted<Input> = {
    type: "started",
    data: ManagerEventTaskCommon<Input>
}

type ManagerEventProgressed<Input, Progress> = {
    type: "progressed",
    data: ManagerEventTaskCommon<Input> & {
        progress: Progress
    }
}

type ManagerEventCompleted<Input, Output> = {
    type: "completed",
    data: ManagerEventTaskCommon<Input> & {
        output: Output
    }
}

type ManagerEventAborted<Input> = {
    type: "aborted",
    data: ManagerEventTaskCommon<Input> & {
        aborted: boolean
    }
}

type ManagerEventFailed<Input> = {
    type: "failed",
    data: ManagerEventTaskCommon<Input> & {
        error: Error
    }
}

type ManagerEventTaskCommon<Input> = {
    taskId: TaskId,
    managerName: string,
    workerName: string,
    workerId: number,
    input: Input
}
//#endregion

//#region worker-related events
type ManagerEventWorkerInitialized = {
    type: "initialized",
    data: ManagerEventWorkerCommon
}

type ManagerEventWorkerInitFailed = {
    type: "initFailed",
    data: ManagerEventWorkerCommon & {
        error: Error
    }
}

type ManagerEventWorkerCommon = {
    managerName: string,
    workerName: string,
    workerId: number
}
//#endregion

function eventIsTaskRelated<Input, Progress, Output>(ev: ManagerEvent<Input, Progress, Output>): ev is ManagerEventTaskRelated<Input, Progress, Output> {
    return (ev as ManagerEventTaskRelated<Input, Progress, Output>).data.input !== undefined
}

const taskRelatedEventTypes: ManagerEvent<any, any, any>['type'][] = ["enqueued", "started", "progressed", "completed", "aborted", "failed"]