export { tmpl, TmplDataError, TmplDataNotAnArrayError, TmplNotFoundError }


function tmpl(tmplName, tmplData, preferred) {
    return ""
}

class TmplDataError extends Error {
}

class TmplDataNotAnArrayError extends Error {
}

class TmplNotFoundError extends Error {
}
