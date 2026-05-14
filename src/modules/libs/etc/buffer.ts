export { BufferOperation, BufferedOperation, ConcurrentBufferOperation }

import { AnyButUndefined } from "../basic/misc.js"

type BufferOperation<X, Y> = SyncBufferOperation<X, Y> | AsyncBufferOperation<X, Y>
type SyncBufferOperation<X, Y> = (buffer: X[]) => Y
type AsyncBufferOperation<X, Y> = (buffer: X[]) => Promise<Y>

class BufferedOperation<X, Y extends AnyButUndefined> {
    readonly bufferCapacity
    readonly bufferCustomCapacity
    #operation: BufferOperation<X, Y>

    #buffer: X[]
    #curCustomSize: number

    /**
     * @param bufferCapacity number of elements in the buffer for it to be automatically flushed. Set to `Number.POSITIVE_INFINITY` for a buffer that can only be flushed manually
     * @param bufferCustomCapacity set to `null` if not needed
     * @param operation called when the buffer contains at least `bufferCapacity` elements or the sum of the custom sizes of the buffer's elements is at least `bufferCustomCapacity`
     */
    constructor(bufferCapacity: number, bufferCustomCapacity: number | null, operation: BufferOperation<X, Y>) {
        bufferCustomCapacity ??= Number.POSITIVE_INFINITY

        if (bufferCapacity < 1) throw new Error("bufferSize must be larger than 0")
        if (bufferCustomCapacity < 1) throw new Error("bufferCustomSize must be larger than 0")

        this.bufferCapacity = bufferCapacity
        this.bufferCustomCapacity = bufferCustomCapacity
        this.#operation = operation
        this.#buffer = []
        this.#curCustomSize = 0
    }

    /**
     * Loads `el` into the buffer and flushes it if it is full and
     * returns the result of the buffer operation. Returns undefined 
     * if the buffer is not full yet.
     */
    async load(el: X, customSize?: number) {
        return await this.loadArr([el], customSize)
    }

    async loadArr(els: X[], totalCustomSize?: number): Promise<Y | undefined> {
        totalCustomSize ??= 0
        this.#buffer.push(...els)
        this.#curCustomSize += totalCustomSize

        //buffer full => flush
        if (this.#buffer.length >= this.bufferCapacity || this.#curCustomSize >= this.bufferCustomCapacity) {
            return await this.flush()
        }

        //buffer still loading
        return undefined 
    }

    /**
     * Executes the buffer operation. If the buffer is empty, 
     * `undefined` is returned without calling the buffer operation.
     */
    async flush(): Promise<Y | undefined> {
        if (this.#buffer.length == 0) return undefined //empty buffer => skip operation

        const res = await this.#operation(this.#buffer)
        this.#buffer = []
        this.#curCustomSize = 0
        return res
    }
}

/**
 * Turns a buffer operation into one that is executed concurrently, i.e.
 * flushing does not wait until the buffer operation finishes. It returns
 * a promise that resolves when the buffer operation has been completed and
 * keeps track of all promises to know when every buffer operation has finished.
 */
class ConcurrentBufferOperation<X, Y> {
    #op: AsyncBufferOperation<X, Y>
    #promises: Promise<Y>[]

    constructor(op: AsyncBufferOperation<X, Y>) {
        this.#op = op
        this.#promises = []
    }

    #cop(buffer: X[]) {
        const p = this.#op(buffer)
        this.#promises.push(p)
        return { promise: p }
    }

    getBufferOperation() {
        return this.#cop.bind(this)
    }

    promises() {
        return this.#promises
    }

    /**
     * After the final flush of the `BufferedOperation` instance, 
     * call and await this method to ensure that all calls to the
     * buffer operation have finished.
     */
    async allFinished() {
        return await Promise.allSettled(this.promises())
    }
}

//#region test
// async function bufferTest() {
//     const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

//     //waits for buffer[0] seconds and then sums the numbers in the buffer and returns the result
//     const op: AsyncBufferOperation<number, number> = async (buffer: number[]) => {
//         const waitFor = buffer[0]
//         await pause(waitFor * 1000)
//         console.debug("op wait for %ss", waitFor)
//         let res = 0
//         for (const x of buffer) {
//             res += x
//         }
//         return res
//     }
//     const buffer = new BufferedOperation(2, null, op)
    
//     const cop = new ConcurrentBufferOperation(op)
//     const cbuffer = new BufferedOperation(2, null, cop.getBufferOperation())

//     console.debug("Buffer test non-concurrent")
//     console.debug("load %O", await buffer.load(3))
//     console.debug("load %O", await buffer.load(1))

//     console.debug("load %O", await buffer.load(1))
//     console.debug("load %O", await buffer.load(2))

//     console.debug("load %O", await buffer.load(2))

//     console.debug("flush %O", await buffer.flush())

//     await pause(3000)
//     console.debug("Buffer test concurrent")
//     console.debug("load %O", await cbuffer.load(3))
//     console.debug("load %O", await cbuffer.load(1))

//     console.debug("load %O", await cbuffer.load(1))
//     console.debug("load %O", await cbuffer.load(2))

//     console.debug("load %O", await cbuffer.load(2))

//     console.debug("flush %O", await cbuffer.flush())
//     await Promise.allSettled(cop.promises())
//     console.debug("concurrent buffer ops have all settled")
// }
//#endregion