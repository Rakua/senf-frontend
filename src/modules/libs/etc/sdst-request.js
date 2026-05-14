export { SDSTSignRequest, SDSTVerifyRequest }

/**
 * Use `var exportSDSTRequest = true` before importing this module to
 * export SDSTSignRequest and SDSTVerifyRequest to window object.
 */

const defaultSDSToolUrl = "https://sdstool.app"
const defaultTrustedOrigins = ["https://sdstool.app"]

class SDSTSignRequest {

    /**
     * @param {string | Object} signData
     * @param {{acceptedAlgorithms?: string[], acceptedDigestMethods?: string[], requirePublicKey?: boolean, contextId?: string}} [options]
     * @param {string} [sdstUrl]
     * @param {string} [rootOrigin] use to pass on the real origin when forwarding a sign request
     */
    constructor(signData, options, sdstUrl, rootOrigin) {
        options = options ?? {}
        sdstUrl = sdstUrl ?? defaultSDSToolUrl

        this.popupName = "SDSTSignRequest-" + new Date().toISOString()
        this.sdstUrl = new URL(requestSdstUrl(sdstUrl))
        this.request = { ...options, type: "sign", rootOrigin: rootOrigin, signData: signData }        
        this._rlRef = readyListener(this.request, this)
    }

    /** 
     * @returns {Promise<{signed: boolean, data?: string, contextId?: string}>}
     */
    start() {
        addEventListener("message", this._rlRef)
        const promise = new Promise((resolve) => {
            this._slRef = (ev) => this._signedListener(ev, resolve)
            addEventListener("message", this._slRef)
        })
        this.sdstWindow = window.open(this.sdstUrl + "#P", this.popupName)
        return promise
    }

    _signedListener(ev, resolve) {
        //ignore messages from other origins
        if(ev.origin !== this.sdstUrl.origin) return


        const data = ev.data
        if(data.isReady === true) return //ignore ready message

        if(data.signed === true) {
            resolve(data)
            return
        } else if(data.signed === false) {
            resolve(data)
            return
        }

        console.error("Failed to interpret message from SDSTool: %O", ev)
    }

    static trustedOrigins() {
        let trustedOrigins = defaultTrustedOrigins

        const toStr = localStorage.getItem("trustedOrigins")
        if(toStr != null) {
            trustedOrigins = trustedOrigins.concat(
                toStr.split(" ").map(x => x.trim()).filter(x => x != ""))
        }

        return trustedOrigins
    }

    static isTrustedOrigin(url) {
        try {
            return SDSTSignRequest.trustedOrigins().includes((new URL(url)).origin)
        } catch(e) {
            return false
        }
    }

    /**
     * Only pass on the rootOrigin of a request if it was set by a trusted origin.
     * Otherwise, it is undefined.
     */
    static rootOrigin(req) {
        if(req.rootOrigin != undefined) {
            if(SDSTSignRequest.isTrustedOrigin(req.origin)) {
                try {
                    return new URL(req.rootOrigin).origin
                } catch(e) {
                    console.error("rootOrigin of sign request %O is not a valid URL", req, e)
                    return req.origin
                }
            } else {
                console.warn("%s is not a trusted origin but tried to set rootOrigin for sign request to %s but will be ignored", req.origin, JSON.stringify(req.rootOrigin))
            }
        }
        return req.origin
    }

    static signFor(req) {
        if(req.origin == undefined) {
            //sign request via fragment id
            return new URL(req.callback).origin
        }

        //only accept rootOrigin if request comes from a trusted origin
        if(req.rootOrigin != undefined && SDSTSignRequest.isTrustedOrigin(req.origin)) {
            return new URL(req.rootOrigin).origin
        }
        return req.origin
    }
}

class SDSTVerifyRequest {

    /**
     * @param {string | Object} verifyData 
     * @param {string} sdstUrl 
     */
    constructor(verifyData, sdstUrl) {
        sdstUrl = sdstUrl ?? defaultSDSToolUrl

        this.popupName = "SDSTVerifyRequest-" + new Date().toISOString()
        this.sdstUrl = new URL(requestSdstUrl(sdstUrl))
        this.request = { type: "verify", verifyData: verifyData }
        this._rlRef = readyListener(this.request, this)
    }

    /**
     * Opens SDSTool and sends verify request. Only call this once.
     * Returns a promise that resolves when request has been send.
     */
    start() {
        addEventListener("message", this._rlRef)
        const promise = new Promise((resolve) => { this._resolve = resolve })
        this.sdstWindow = window.open(this.sdstUrl + "#P", this.popupName)

        return promise
    }

    onRequestSent() {
        this._resolve(true)
    }
}

/**
 * Generates a listener that sends the request to SDSTool as soon as 
 * SDSTool confirms that it is ready.
 * @param {{type: "verify", verifyData: string} | {type: "sign", verifyData: string}} request 
 * @param {SDSTSignRequest | SDSTVerifyRequest} sdstRequest 
 */
function readyListener(request, sdstRequest) {
    return function (ev) {
        //ignore messages from other origins
        if(ev.origin !== sdstRequest.sdstUrl.origin) return

        const data = ev.data
        if(data.isReady === true) {
            sdstRequest.sdstWindow.postMessage(request, sdstRequest.sdstUrl.origin)
            removeEventListener("message", sdstRequest._rlRef)
            if(typeof sdstRequest.onRequestSent == "function") {
                sdstRequest.onRequestSent()
            }
            return
        }

        console.error("Failed to interpret message from SDSTool: %O", ev)
        removeEventListener("message", sdstRequest._rlRef)
    }
}

function requestSdstUrl(baseUrl) {
    if(!baseUrl.endsWith("/")) baseUrl += "/"
    return baseUrl + "request.html"
}

if(window.exportSDSTRequest === true) {
    window.SDSTSignRequest = SDSTSignRequest
    window.SDSTVerifyRequest = SDSTVerifyRequest
}