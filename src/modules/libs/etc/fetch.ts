export { modName, proxiedFetch, proxiedFetchJson, proxiedFetchText, setDefaultFetchOptions }

import { fromJsonTotal } from "../basic/misc.js"
import { DefaultLogger } from "../basic/logger.js"

//#region types
type ProxyOptions = {
    proxies: FetchProxy[]
    noProxyUrlPatterns: RegExp[] // only apply proxies if no regexp in nonProxied matches
}

type FetchProxy = {
    type: "get", //proxy gets json with fetch via POST request
    url: string,
    pattern?: RegExp | null //only applied if null/undef or regexp matches $METHOD $URL
}

type FetchResponse<T> = FetchResponseOk<T> | FetchResponseError
type FetchResponseOk<T> = {
    type: "ok",
    response: Response,
    result: T
}

type FetchResponseError = {
    type: "error",
    response: Response
}

//#endregion

const modName = "fetch"
const lg = new DefaultLogger(modName)

let defaultProxyOptions: ProxyOptions = {
    proxies: [],
    noProxyUrlPatterns: []
}

function setDefaultFetchOptions(options: ProxyOptions) {
    defaultProxyOptions = options
}

async function proxiedFetch(input: RequestInfo | URL, requestInit?: RequestInit, options?: ProxyOptions): Promise<Response> {
    const url: URL = input instanceof Request ?
        new URL(input.url) : (input instanceof URL ? input : new URL(input))
    const urlStr = url.href

    const optionsUsed = structuredClone(defaultProxyOptions)
    Object.assign(optionsUsed, options ?? {})

    //todo: proxy logic 

    //todo: if proxy is defined, use it for fetch
    return await fetch(input, requestInit)
}

async function proxiedFetchText(input: RequestInfo | URL, requestInit?: RequestInit, options?: ProxyOptions) {
    const resp = await proxiedFetch(input, requestInit, options)
    return {
        response: resp,
        text: await resp.text()
    }
}

async function proxiedFetchJson<T = any>(input: RequestInfo | URL, requestInit?: RequestInit, options?: ProxyOptions) {
    const resp = await proxiedFetchText(input, requestInit, options)
    return {
        response: resp.response,
        text: resp.text,
        data: fromJsonTotal<T>(resp.text)
    }
}