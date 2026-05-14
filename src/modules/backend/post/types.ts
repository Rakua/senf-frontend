export {    
    PostType, PostTypeTag, SignedText, PostContent, PostTime, PostError,
    PostPath, ItemLocation,
    Ticket, 
    PostPhase, PostPhaseTicket, PostPhaseWait, PostPhaseSubmit, PostPhasePosted,
    postPhaseTicket, postPhaseWait, postPhaseSubmit, postPhasePosted, equalPhase
}

type PostType = "post" | "echo" | "anti"
type PostTypeTag = "anti"
type SignedText = { text: string, keyId: string }
type PostContent = {
    location: string,
    waitingTimeSec: number,
    typeTag?: PostTypeTag,
    content: string,
    signedText?: SignedText
}

type PostTime = { client: Date, server: Date }

type PostError = {
    phase: PostPhase,
    errorName: string,
    errorMsg: string,
    date: Date
}

enum PostPath {
    Ticket = "ticket",
    Wait = "wait",
    Submit = "submit",
    Cancel = "cancel"
}

enum ItemLocation {
    Enqueued = "enqueued",
    Posted = "posted",
    Aborted = "aborted"
}

//#region waiting ticket
type Ticket = {
    ticketId: string,
    requestedWaitingTimeSec: number,
    elapsedWaitingTimeSec: number,
    issuedAt: Date,
    lastRenewed: Date,
    validFrom: Date,
    validUntil: Date
}
//#endregion

//#region post phase
type PostPhase = PostPhaseTicket | PostPhaseWait | PostPhaseSubmit | PostPhasePosted

/**
 * Before a post has a waiting ticket
 */
type PostPhaseTicket = {
    "phase": PostPath.Ticket
}

/**
 * Before a post has a redeemable waiting ticket (elapsed waiting time < requested waiting time)
 */
type PostPhaseWait = {
    "phase": PostPath.Wait
    "elapsedWaitingTimeSec": number
}

/**
 * Before a post has been successfully submitted
 */
type PostPhaseSubmit = {
    "phase": PostPath.Submit
}

type PostPhasePosted = {
    "phase": "posted"
}

const postPhasePosted: PostPhasePosted = { "phase": "posted" }
const postPhaseSubmit: PostPhaseSubmit = { "phase": PostPath.Submit }
const postPhaseTicket: PostPhaseTicket = { "phase": PostPath.Ticket }
const postPhaseWait = (elapsedWaitingTimeSec: number): PostPhaseWait => ({
    "phase": PostPath.Wait,
    "elapsedWaitingTimeSec": elapsedWaitingTimeSec
})

function equalPhase(a: PostPhase, b: PostPhase) {
    if (a.phase != b.phase) return false
    if (a.phase == PostPath.Wait && a.elapsedWaitingTimeSec != (b as PostPhaseWait).elapsedWaitingTimeSec) return false
    return true
}
//#endregion