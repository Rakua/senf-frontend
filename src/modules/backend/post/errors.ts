export {
    PostDoesNotExistError, PostUnsignedError, PostTimeMissingError, PostNoTicketError, PostNotInQueueError, 
    SignedTextDiffersError, CantSignPostWithTicketError, ServerError
}

import { PostPath, ItemLocation } from "./types.js"

class PostUnsignedError extends Error {
    readonly postId: string

    constructor(postId: string) {
        super("Expected post " + postId + " to be signed")
        this.name = 'PostUnsignedError'
        this.postId = postId
    }
}

class PostTimeMissingError extends Error {
    readonly postId: string

    constructor(postId: string) {
        super("Post " + postId + " has no post time set")
        this.name = 'PostTimeMissingError'
        this.postId = postId
    }
}

class PostNoTicketError extends Error {
    readonly postId: string

    constructor(postId: string) {
        super("Post " + postId + " has no ticket")
        this.name = 'PostNoTicketError'
        this.postId = postId
    }
}

class PostDoesNotExistError extends Error {
    readonly postId: string

    constructor(postId: string) {
        super("Post with id " + postId + " does not exist")
        this.name = 'PostDoesNotExistError'
        this.postId = postId
    }
}

class PostNotInQueueError extends Error {
    readonly postId: string
    readonly location: ItemLocation

    constructor(postId: string, location: ItemLocation) {
        super("Expected post " + postId + " in queue but found it in " + location)
        this.name = 'PostNotInQueueError'
        this.postId = postId
        this.location = location
    }
}

class CantSignPostWithTicketError extends Error {
    readonly postId: string
    readonly text: string

    constructor(postId: string, text: string) {
        super("Cannot sign post " + postId + " since it already has a ticket")
        this.name = 'CantSignPostWithTicketError'
        this.postId = postId
        this.text = text
    }
}

class SignedTextDiffersError extends Error {
    readonly postId: string
    readonly text: string

    constructor(postId: string, text: string) {
        super("Content of post " + postId + " differs from signed text")
        this.name = 'SignedTextDiffersError'
        this.postId = postId
        this.text = text
    }
}

class ServerError extends Error {
    readonly path: PostPath
    readonly errCode: number
    readonly errMsg: string | undefined

    constructor(path: PostPath, errCode: number, errMsg: string | undefined) {
        const noMsg = errMsg === null || errMsg === undefined || errMsg === ""
        const message = path + "-" + errCode + (noMsg ? "" : ": " + errMsg)
        super(message)
        this.name = 'ServerError'
        this.path = path
        this.errCode = errCode
        this.errMsg = errMsg
    }

    static fromJSON(str: string) {
        const obj = JSON.parse(str)
        return ServerError.fromObject(obj)
    }

    static fromObject(obj: { name: string; path: PostPath; errMsg: string | undefined; errCode: number }) {
        if (obj.name !== "ServerError") throw new TypeError("obj.name !== 'ServerError'")
        if (typeof obj.path != "string") throw new TypeError("typeof obj.path != 'string'")
        if (typeof obj.errMsg != "string") throw new TypeError("typeof obj.errMsg != 'string'")
        if (typeof obj.errCode != "number") throw new TypeError("typeof obj.errCode != 'number'")

        return new ServerError(obj.path, obj.errCode, obj.errMsg)
    }
}
