export { JobQueue }

import { SegregatedQueue, SimpleQueue } from "../../libs/etc/queue.js"
import { TaskQueue, TaskQueueElement } from "../../libs/manager/types.js"
import { JobInDb, startedByUser } from "./types/job.js"

type QueueEl = TaskQueueElement<JobInDb>

class JobQueue implements TaskQueue<JobInDb> {
    fileQueue = new SimpleQueue<QueueEl>()
    urlFromUserQueue = new SimpleQueue<QueueEl>()
    urlFromArchiveQueue = new SegregatedQueue(segregator)
    crawlQueue = new SimpleQueue<QueueEl>()

    enqueue(el: QueueEl) {
        if (el.input.type == "file") {
            this.fileQueue.enqueue(el)
        } else if (el.input.type == "url") {
            if (startedByUser(el.input)) {
                this.urlFromUserQueue.enqueue(el)
            } else {
                this.urlFromArchiveQueue.enqueue(el)
            }
        } else {
            this.crawlQueue.enqueue(el)
        }
    }

    dequeue() {
        if (this.fileQueue.length() > 0) return this.fileQueue.dequeue()
        if (this.urlFromUserQueue.length() > 0) return this.urlFromUserQueue.dequeue()
        if (this.crawlQueue.length() > 0) return this.crawlQueue.dequeue()
        return this.urlFromArchiveQueue.dequeue()
    }

    length() {
        return this.fileQueue.length()
            + this.urlFromUserQueue.length()
            + this.urlFromArchiveQueue.length()
            + this.crawlQueue.length()
    }
}

function segregator(x: QueueEl) {
    try {
        if (x.input.type == "crawl" || x.input.type == "url") return new URL(x.input.url).origin
        return ""
    } catch (e) {
        return ""
    }
}