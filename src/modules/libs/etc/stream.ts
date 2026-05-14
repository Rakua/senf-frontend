export {
    StreamWithBytesProcessedBeingTracked,
    streamFromData, streamToBlob, asyncGeneratorToStream, peekStream, unzippedStream
}

import { concatUint8Arrays } from "./sdst.js"

type Uint8Arr = Uint8Array<ArrayBuffer>

function streamFromData(data: BlobPart) {
    const blob = new Blob([data])
    return blob.stream()
}

async function streamToBlob(stream: ReadableStream, options?: BlobPropertyBag) {
    const r = stream.getReader()
    const chunks = []
    while (true) {
        const x = await r.read()
        if (x.done) break
        chunks.push(x.value)
    }
    return new Blob(chunks, options)
}

function asyncGeneratorToStream(gen: AsyncGenerator<Uint8Arr, void, unknown>) {
    return new ReadableStream({
        pull: async (controller) => {
            const res = await gen.next()
            if (res.done) controller.close()
            controller.enqueue(res.value as Uint8Arr)
        },
        type: "bytes"
    })
}

type PeekStream = {
    stream: ReadableStream<Uint8Arr>,
    prefix: Uint8Arr
}

/**
 * Reads the first `length` bytes (at most) from `stream` and returns a new stream
 * with the same contents as `stream` (i.e. including the prefix that has been read).
 * 
 * This can be used to determine the type of data in a stream (magic bytes) to 
 * determine how to process the stream.
 */
async function peekStream(stream: ReadableStream<Uint8Arr>, length: number): Promise<PeekStream> {
    let prefix = new Uint8Array()
    const reader = stream.getReader()

    while (prefix.length < length) {
        const x = await reader.read()

        if (x.done) {
            //end of stream reached
            return {
                stream: streamFromData(prefix) as ReadableStream<Uint8Arr>,
                prefix: prefix
            }
        }
        prefix = concatUint8Arrays(prefix, x.value)
    }

    let prefixRead = false

    //concat prefix with rest of stream
    const originalStream = new ReadableStream({
        async pull(controller) {
            if (!prefixRead) {
                prefixRead = true
                controller.enqueue(prefix)
                return
            }
            const x = await reader.read()
            if (x.done) {
                controller.close()
            } else {
                controller.enqueue(x.value)
            }
        }
    })

    return { stream: originalStream, prefix: prefix }
}

/**
 * If `stream` is gzipped, i.e. it starts with the magic bytes 1F8B, then a stream
 * with the decompressed contents of `stream` is returned. Otherwise, a stream 
 * with the same contents as `stream` is returned.
 * 
 * This function is idempotent.
 */
async function unzippedStream(stream: ReadableStream<Uint8Arr>) {
    const magicBytesGz = [31, 139] // 1F 8B

    const ps = await peekStream(stream, 2)
    if (ps.prefix.length < 2 || !(ps.prefix.at(0) == magicBytesGz[0] && ps.prefix.at(1) == magicBytesGz[1])) {
        //no a gzipped stream; return as is
        return ps.stream
    }

    //gzip compressed stream
    return ps.stream.pipeThrough(new DecompressionStream("gzip"))
}

/**
 * Tracks the number of bytes of a readable stream that have been processed by 
 * an external consumer. Whenever a new chunk is requested it is assumed that all
 * bytes read from the stream up to that point have been processed. Stated differently,
 * whenever a new chunk is requested the size of the previous chunk is added to the 
 * number of bytes that have been processed.
 * 
 * To signal that the final chunk has been processed, call the method `close()`. 
 */
class StreamWithBytesProcessedBeingTracked<T> {
    #stream: ReadableStream<T>
    #bytesProcessed: number = 0
    #lastChunkLength: number | null = null
    #callback: (bytesProcessed: number) => void

    /**
     * @param stream the stream for which the number of bytes that have been processed should be tracked
     * @param callback called when the number of bytes that have been processed changes
     */
    constructor(stream: ReadableStream<T>, callback: (bytesProcessed: number) => void) {
        this.#callback = callback
        const ts = new TransformStream({
            transform: (chunk, controller) => {
                if (this.#lastChunkLength != null) {
                    //last chunk was processed and new chunk is being read
                    //=> update bytes processed
                    this.#bytesProcessed += this.#lastChunkLength
                    this.#callback(this.#bytesProcessed)
                }
                this.#lastChunkLength = chunk.byteLength
                controller.enqueue(chunk)
            }
        })

        this.#stream = stream.pipeThrough(ts)
    }

    bytesProcessed() {
        return this.#bytesProcessed
    }

    stream() {
        return this.#stream
    }

    /**
     * Call this method to signal that the stream has been completely processed
     */
    close() {
        if (this.#lastChunkLength != null) {
            this.#bytesProcessed += this.#lastChunkLength
            this.#callback(this.#bytesProcessed)
        }
    }
}