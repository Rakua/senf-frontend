export { Queue, SimpleQueue, SegregatedQueue }

import { AnyButUndefined } from "../basic/misc.js"

interface Queue<T extends AnyButUndefined> {
    enqueue: (el: T) => void
    dequeue: () => T | undefined
    length: () => number
}

class SimpleQueue<T extends AnyButUndefined> implements Queue<T> {
    #queue: T[] = []

    enqueue(el: T) {
        this.#queue.push(el)
    }

    dequeue() {
        return this.#queue.shift()
    }

    length() {
        return this.#queue.length
    }
}

/**
 * Segregate elements into different queues based on the segregator and
 * round-robin these queues when dequeuing. 
 */
class SegregatedQueue<Item extends AnyButUndefined, SegregationType extends string | number> implements Queue<Item> {
    #segregator: (x: Item) => SegregationType
    #queue: Map<SegregationType, SimpleQueue<Item>>
    #types: SegregationType[]
    #curType: number //index to #types

    constructor(segregator: (x: Item) => SegregationType) {
        this.#queue = new Map()
        this.#types = []
        this.#curType = 0
        this.#segregator = segregator
    }

    enqueue(el: Item) {
        const type = this.#segregator(el)
        if (!this.#queue.has(type)) {
            this.#queue.set(type, new SimpleQueue())
            this.#types.push(type)
        }
        this.#queue.get(type)!.enqueue(el)
    }

    dequeue() {
        if (this.#queue.size == 0) return undefined
        const type = this.#types[this.#curType]

        const q = this.#queue.get(type)!
        const el = q.dequeue()
        if (q.length() == 0) {
            //queue for type became empty => remove it
            this.#queue.delete(type)
            this.#types.splice(this.#curType, 1)
            if (this.#curType == this.#queue.size) {
                //queue with last index was deleted -> reset index to 0
                this.#curType = 0
            }
        } else {
            this.#curType = (this.#curType + 1) % this.#types.length
        }

        return el
    }

    length() {
        let l = 0
        for (const [_, q] of this.#queue) {
            l += q.length()
        }
        return l
    }
}