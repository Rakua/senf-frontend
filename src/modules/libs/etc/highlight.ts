export { modName, renderCode }

import { DefaultLogger } from "../basic/logger.js"
import hljs from "../highlight/highlight.js"
import "../highlight/languages.js"

const modName = "highlight"
const lg = new DefaultLogger(modName)

const ignoreIllegals = true
const disableAutoDetect = true
const autoDetect = ["basic", "c", "javascript", "cpp", "csharp", "css", "go", "haskell", "java", "javascript", "json", "latex", "lisp", "markdown", "perl", "php-template", "php", "prolog", "python", "rust", "scheme", "typescript", "xml", "yaml", "plaintext"]

/**
 * @returns user-specified language if unknown
 */
function renderCode(el: HTMLElement) {
    const code = el.textContent
    el.dataset.code = code ?? ""
    const lang = el.dataset.language
    lg.debug("lang value: %s",JSON.stringify(el.dataset.language))

    if (lang !== undefined || disableAutoDetect) {        
        const langToUse = lang == undefined || hljs.getLanguage(lang) == undefined ? "plaintext" : lang
        lg.debug("langToUse: %s", langToUse)
        el.innerHTML = hljs.highlight(code, { language: langToUse, ignoreIllegals: ignoreIllegals }).value

        if(hljs.getLanguage(lang) == undefined) return lang
    } else {        
        lg.debug("autodetect lang")
        const res = hljs.highlightAuto(code, autoDetect)
        lg.debug("autodetected language: %s (%O)", res.language, res.relevance)
        el.innerHTML = res.value
    }
    return undefined
}

