export { PostItem, PostItemObject }

import { settings } from "./config.js"
import { equalPhase, PostContent, PostError, PostPhase, postPhasePosted, postPhaseSubmit, postPhaseTicket, postPhaseWait, PostTime, PostType, SignedText, Ticket } from "./types.js"
import { toClientTime, toServerTime } from "../time.js"
import { PostUnsignedError, PostTimeMissingError, PostNoTicketError } from "./errors.js"
import { toIsoStringWoMs } from "../../libs/basic/misc.js"

/**
 * Used to reconstruct PostItem from storage & postMessage
 */
type PostItemObject = {
    type: "PostItem",
    id: string, //UUID identifying this post

    postContent: PostContent,
    shouldBeSigned: boolean,
    postTime?: PostTime,

    ticket?: Ticket,
    ci?: any,
    abortedByUser?: boolean
    postErrors?: PostError[]
}

class PostItem {
    readonly type: string //always "PostItem"; for reviving from localStorage
    readonly id: string

    postContent: PostContent
    shouldBeSigned: boolean
    postTime?: PostTime

    ticket?: Ticket
    ci?: any
    abortedByUser?: boolean

    postErrors: PostError[]

    /**
     * Only supply the first two parameters for constructing a new PostItem.
     * The other parameters are used when reconstructing a PostItem from storage
     * in PostItem.fromObject, 
     */
    constructor(postContent: PostContent, shouldBeSigned: boolean,
        id?: string, postTime?: PostTime, ticket?: Ticket, ci?: any, abortedByUser?: boolean, postErrors?: PostError[]) {
        this.type = "PostItem"

        this.postContent = postContent
        this.shouldBeSigned = shouldBeSigned

        this.id = id != undefined ? id : crypto.randomUUID()
        this.postTime = postTime
        this.ticket = ticket
        this.ci = ci
        this.abortedByUser = abortedByUser
        this.postErrors = Array.isArray(postErrors) ? postErrors : []
    }

    //#region getters
    postId() {
        return this.id
    }

    hasTicket() {
        return this.ticket != null
    }

    getTicket() {
        if (!this.hasTicket()) throw new PostNoTicketError(this.id)
        return this.ticket
    }

    ticketId() {
        if (!this.hasTicket()) throw new PostNoTicketError(this.id)
        return this.ticket!.ticketId
    }

    isSigned() {
        return this.postContent.signedText != undefined
    }

    missingSignature() {
        return this.shouldBeSigned && !this.isSigned()
    }

    getKeyId() {
        if (!this.isSigned()) return undefined
        return this.postContent.signedText!.keyId
    }

    isAbortedByUser() {
        return this.abortedByUser === true
    }

    abortReason() {
        const le = this.lastError()

        if (this.isAbortedByUser()) return "by user"
        if (this.missingSignature()) return "missing signature"
        if (le !== null) return le.errorMsg
        return "?"
    }

    lastError(): PostError | null {
        if (this.postErrors.length == 0) return null
        return this.postErrors[this.postErrors.length - 1]
    }

    lastErrorInCurrentPhase(): PostError | null {
        const le = this.lastError()
        if (le == null || !equalPhase(le.phase, this.currentPhase())) return null
        return le
    }

    countErrorsInCurrentPhase(): number {
        const curPhase = this.currentPhase()
        for (let i = 0; i < this.postErrors.length; i++) {
            if (!equalPhase(curPhase, this.postErrors[this.postErrors.length - 1 - i].phase))
                return i
        }
        return this.postErrors.length
    }

    currentPhase(): PostPhase {
        if (typeof this.ci == "object" && this.ci != null)
            return postPhasePosted
        if (this.ticket == null)
            return postPhaseTicket
        if (this.ticket.elapsedWaitingTimeSec = this.ticket.requestedWaitingTimeSec)
            return postPhaseSubmit

        return postPhaseWait(this.ticket.elapsedWaitingTimeSec)
    }

    /**
     * @returns CI text as submitted to server
     */
    ciText() {
        if (this.postTime == undefined) throw new PostTimeMissingError(this.id)
        if (this.missingSignature()) throw new PostUnsignedError(this.id)
        return this.postContent.signedText == undefined ? this.toText() : this.postContent.signedText.text
    }

    postType(): PostType {
        if (this.postContent.typeTag == undefined) {
            return this.postContent.content == "" ? "echo" : "post"
        } else {
            return this.postContent.typeTag
        }
    }

    hasPostTime() {
        return this.postTime != undefined
    }

    getPostTime() {
        if (this.postTime == undefined) throw new PostTimeMissingError(this.id)
        return this.postTime
    }

    /**
     * @returns waiting time in ms
     */
    getWaitingTime() {
        return 1000 * this.postContent.waitingTimeSec
    }

    /**
     * @returns earliest time by which this post could be submitted
     */
    earliestSubmissionDate() {
        if (this.postTime == undefined) throw new PostTimeMissingError(this.id)

        if (this.hasTicket()) {
            const now = new Date()
            const t = this.ticket!

            const remainingWtOnTicket = 1000 * (t.requestedWaitingTimeSec - t.elapsedWaitingTimeSec)
            const waitedSinceCurrentTicket = now.getTime() - toClientTime(t.lastRenewed).getTime()
            const remainingWt = remainingWtOnTicket - waitedSinceCurrentTicket
            return new Date(now.getTime() + remainingWt)
        }

        return new Date(this.postTime.client.getTime() + this.getWaitingTime())
    }

    /**
     * 
     * @returns post without signature; use for sign request
     */
    toText() {
        if (this.postTime == undefined) throw new PostTimeMissingError(this.id)

        //subtract postTimeOffset to prevent future error from server, i.e. when
        //timestamp in signed text is larger than current timestamp at server
        const ts = new Date(this.postTime.server.getTime() - settings.postTimeOffset.get())

        let text = ""
        text = "@" + this.postContent.location + "\n"
        text += settings.platformName.get() + " " + toIsoStringWoMs(ts)
        if (this.postContent.waitingTimeSec > 0) text += " " + (this.getWaitingTime() / 60000) + "min"
        if (this.postContent.typeTag != undefined) text += " " + this.postContent.typeTag
        if (this.postContent.content !== "") text += "\n" + this.postContent.content

        return text
    }
    //#endregion

    //#region setters
    setPostTime(clientTime: Date) {
        this.postTime = {
            client: clientTime,
            server: toServerTime(clientTime)
        }
    }

    setSignedText(signedText: SignedText) {
        this.postContent.signedText = signedText
    }

    unsetSignedText() {
        this.postContent.signedText = undefined
    }

    setShouldBeSigned(shouldBeSigned: boolean) {
        this.shouldBeSigned = shouldBeSigned
    }

    setTicket(ticket: Ticket) {
        this.ticket = ticket
    }

    setAbortedByUser() {
        this.abortedByUser = true
    }

    setCi(ci: any) {
        this.ci = ci
    }

    appendError(error: Error) {
        this.postErrors.push({
            phase: this.currentPhase(),
            errorName: error.name,
            errorMsg: error.message,
            date: new Date()
        })
    }
    //#endregion

    //#region static

    static fromJSON(str: string) {
        const obj = JSON.parse(str)
        return PostItem.fromObject(obj)
    }

    static fromObject(obj: PostItem | PostItemObject) {
        if (obj instanceof PostItem) return obj
        return new PostItem(obj.postContent,
            obj.shouldBeSigned,
            obj.id,
            obj.postTime,
            obj.ticket,
            obj.ci,
            obj.abortedByUser,
            obj.postErrors
        )
    }
    //#endregion
}
