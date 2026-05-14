export {
    DuplicateTaskIdError, TaskDoesNotExistError, TaskNotAssignedError,
    WorkerBusyError, WorkerNotBusyError, WorkerInitDataUndefined,
    GenericWebWorkerError
}

import { TaskId } from "./types.js"

class DuplicateTaskIdError extends Error {
    taskId: TaskId

    constructor(taskId: TaskId) {
        super(`Task ${taskId} already exists`)
        this.name = "DuplicateTaskIdError"
        this.taskId = taskId
    }
}

class TaskDoesNotExistError extends Error {
    taskId: TaskId

    constructor(taskId: TaskId) {
        super(`Task ${taskId} does not exist`)
        this.name = "TaskDoesNotExistError"
        this.taskId = taskId
    }
}

class TaskNotAssignedError extends Error {
    taskId: TaskId

    constructor(taskId: TaskId) {
        super(`Task ${taskId} is not assigned to any worker`)
        this.name = "TaskNotAssignedError"
        this.taskId = taskId
    }
}

class WorkerBusyError extends Error {
    ev: MessageEvent

    constructor(ev: MessageEvent) {
        super(`Worker busy but got new task`)
        this.name = "WorkerBusyError"
        this.ev = ev
    }
}

class WorkerNotBusyError extends Error {
    ev: MessageEvent

    constructor(ev: MessageEvent) {
        super(`Worker got abort signal but is not busy`)
        this.name = "WorkerNotBusyError"
        this.ev = ev
    }
}

class WorkerInitDataUndefined extends Error {
    ev: MessageEvent

    constructor(ev: MessageEvent) {
        super(`Worker got init message with undefined init data`)
        this.name = "WorkerInitDataUndefined"
        this.ev = ev
    }
}

/**
 * If a managed web worker throws something other than an error in `work()`
 * then it is wrapped in GenericWebWorkerError.
 */
class GenericWebWorkerError extends Error {
    value: any

    constructor(value: any) {
        try {
            const str = JSON.stringify(value)
            super(`A managed web worker has thrown the value: ${JSON.stringify(value)}`)
        } catch (e) {
            super(`A managed web worker has thrown a non-serializable value`)
        }

        this.name = "GenericWebWorkerError"
        this.value = value
    }
}

