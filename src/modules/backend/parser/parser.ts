export {
    InputError, PegSyntaxError, ParseResult, AbstractSyntaxTree,
    parse, parseTotal, isEmpty, isInputError, bodyMetadata, removeCommands, addNewlineBeforeNestableClosingTags,
    inputErrorMessage, replaceAliasesInUriTags, replaceKeyIdsWithAliasesInUriTags
}

import { escapeHtml, splitAt } from "../../libs/basic/misc.js"
import { DefaultLogger } from "../../libs/basic/logger.js"
import { SyntaxError as PegSyntaxError, parse as parse0 } from "./syntax.js"
import { isCiUrn } from "../../libs/etc/misc.js"
import { mainSettings } from "../../../config.js"
import { isKeyId } from "../../libs/etc/sdst.js"
import { aliasOf, keyIdOfAlias } from "../cidb/cidb.js"

//#region types
type ParseResult = {
    ast: AbstractSyntaxTree,
    error?: InputError | PegSyntaxError | Error
}

const inputErrorTypes = [
    'ErrUnknown', 'ErrOrphan', 'ErrUnknownCmd',
    'ErrTextLineContainsBlockCmd', 'ErrUnexpectedBlockClosingCmd',
    'ErrEmpty', 'ErrContainsIllegalCmd', 'ErrMissingEnd',
    'ErrCodeIllegalLang', 'ErrCodeMissingSpace',
    'ErrBlockMissingEnd', 'ErrBlockNotEmptyAfterEnd', 'ErrBlockContainsIllegalCmd', 'ErrBlockEmpty',
    'ErrCodeBlockIllegalLang', 'ErrCodeBlockNotEmptyAfterLanguage'] as const
type InputErrorType = typeof inputErrorTypes[number]

type InputError = {
    type: InputErrorType,
    value: string,
    startOffset: number,
    endOffset: number
    block?: "code" | "math" | "spoiler" | "quote",
    cmd?: "§@" | "§!" | "§?" | "§`" | "§$"
}

type AbstractSyntaxTree = Start

type Start = (EmptyBlock | TextBlock | CodeBlock | MathBlock | QuoteBlock | SpoilerBlock)[]
type EmptyBlock = { type: "EmptyBlock", breaks: number, value: string }
type TextBlock = { type: "TextBlock", value: TextLine[] }
type CodeBlock = { type: "CodeBlock", language: string | null, value: string }
type MathBlock = { type: "MathBlock", value: string }
type QuoteBlock = { type: "QuoteBlock", value: Start }
type SpoilerBlock = { type: "SpoilerBlock", value: Start }

type TextLineToken = Plain | LineBreak | Uri | Code | Math | Emphasis | Spoiler
type TextLine = { type: "TextBlock", value: TextLineToken[] }
type Plain = { type: "Plain", value: string, isQuoteLine: boolean, isEmpty: boolean, leadingBreak?: boolean }
type LineBreak = { type: "LineBreak", trailingWs: boolean, isQuoteLine: boolean, isEmpty: boolean, leadingBreak?: boolean }
type Uri = { type: "Uri", value: string, trailingWs: boolean, isQuoteLine: boolean, isEmpty: boolean, leadingBreak?: boolean }
type Code = { type: "Code", language: null | string, value: string, trailingWs: boolean, isQuoteLine: boolean, isEmpty: boolean, leadingBreak?: boolean }
type Math = { type: "Math", value: string, trailingWs: boolean, isQuoteLine: boolean, isEmpty: boolean, leadingBreak?: boolean }
type Emphasis = { type: "Emphasis", value: string, trailingWs: boolean, isQuoteLine: boolean, isEmpty: boolean, leadingBreak?: boolean }
type Spoiler = { type: "Spoiler", value: SpoilerContent, trailingWs: boolean, isQuoteLine: boolean, isEmpty: boolean, leadingBreak?: boolean }
type SpoilerContent = (Plain | Uri | Code | Math | Emphasis)[]
//#endregion

const lg = new DefaultLogger("parser")

function parse(input: string): ParseResult {
    const astWoCmd = parse0(removeCommands(input))
    try {
        const x = parse0(input)
        if (isInputError(x)) return { ast: astWoCmd, error: x }
        const ast = x as AbstractSyntaxTree
        postprocess(ast)
        return { ast: ast }
    } catch (e) {
        if (e instanceof PegSyntaxError) {
            const exp = new Set(e.expected.filter(x => x.type == "literal").map(x => x.text))
            const foundAt = e.location.start.offset
            const rest = input.slice(foundAt)
            const offendingTag = ["§>", "§]", "§es", "§eq"].find(x => rest.startsWith(x))
            if (offendingTag == undefined) return { ast: astWoCmd, error: e }

            const err: InputError = {
                type: "ErrUnexpectedBlockClosingCmd",
                value: offendingTag,
                startOffset: foundAt,
                endOffset: foundAt + offendingTag.length
            }

            return { ast: astWoCmd, error: err }
        } else {
            return {
                ast: astWoCmd, error: {
                    type: "ErrUnknown",
                    value: "",
                    startOffset: 0,
                    endOffset: 0
                }
            }
        }

    }
}

function parseTotal(input: string): AbstractSyntaxTree {
    try {
        const x = parse0(input)
        if (isInputError(x)) throw new Error(inputErrorMessage(x))
        const ast = x as AbstractSyntaxTree
        postprocess(ast)
        return ast
    } catch (e) {
        return parse0(removeCommands(input))
    }
}

function isInputError(x: any): boolean {
    return typeof x == "object" && x !== null && typeof x.type == "string" && x.type.startsWith("Err")
}

function isEmpty(x: any): boolean {
    if (typeof x == "string") return x.trim() == ""
    if (typeof x == "object" && x !== null && x.isEmpty !== undefined) return x.isEmpty
    if (Array.isArray(x)) return !x.map(isEmpty).some(x => x == false)
    return false
}

function replaceAliasesInUriTags(input: string) {
    const re = /(§*)@\$([a-zA-Z0-9\-\_]+)/g
    return input.replace(re, (match, paragraphSymbols: string, alias: string) => {
        if (paragraphSymbols.length % 2 == 0) return match

        const keyId = keyIdOfAlias(alias) ?? keyIdOfAlias(alias.replaceAll("_", " "))
        if (keyId === undefined) {
            lg.warn("Alias '%s' not found", alias)
            return match
        }

        return "§".repeat(paragraphSymbols.length) + "@" + keyId
    })
}

function replaceKeyIdsWithAliasesInUriTags(input: string) {
    const re = /(§*)@([a-zA-Z0-9\-\_]+)/g
    return input.replace(re, (match, paragraphSymbols: string, keyId: string) => {
        if (paragraphSymbols.length % 2 == 0 || !isKeyId(keyId)) return match

        const alias = aliasOf(keyId)
        return alias === undefined
            ? match
            : "§".repeat(paragraphSymbols.length) + "@$" + alias
    })
}

function bodyMetadata(ast: Start) {
    /*    
        compute info such as containsInlineMath, containsCodeBlock, nestingDepth, etc. from AST
        unknown languages used in code tags
        isEmpty? -> do not display 
    */
}

/**
 * Postprocess AST after parsing.
 * Checks if the argument of each uri tag is a URI, a keyId or invalid and adds
 * this information to the Uri token.
 */
function postprocess(ast: AbstractSyntaxTree) {
    for (const block of ast) {
        lg.debug("block of ast: %O", block)
        switch (block.type) {
            case "TextBlock":
                for (const line of block.value) {
                    for (let token of line.value) {
                        if (token.type != "Uri") continue

                        //add info to uri elements                 
                        let refType: "uri" | "keyid" | "invalid"
                        const sa = splitAt(token.value, ":")
                        if (sa.found) {
                            switch (sa.left) {
                                case "http":
                                case "https":
                                    try {
                                        new URL(token.value)
                                        refType = "uri"
                                    } catch (e) {
                                        refType = "invalid"
                                    }
                                    break

                                case "ci":
                                    refType = isCiUrn(token.value, mainSettings.platformName.get()) ? "uri" : "invalid"
                                    break

                                default:
                                    refType = "invalid"
                            }
                        } else {
                            refType = isKeyId(token.value) ? "keyid" : "invalid"
                        }
                        token = Object.assign(token, { kind: refType })
                        lg.debug("uri: %O", token)
                    }
                }
                break

            case "QuoteBlock":
            case "SpoilerBlock":
                postprocess(block.value)
                break
        }

    }
}

function removeCommands(input: string) {
    return input.replaceAll("§", "§§")
}

//todo: check if this function idempotent
function addNewlineBeforeNestableClosingTags(input: string) {
    //const pr = parse(input)
    //if(pr.error === undefined || !(pr.error instanceof PegSyntaxError)) return input

    const re = /[^§](§(§§)*(eq|es))/
    const res = input.split("\n").map(line => {
        const match = re.exec(line)
        if (match == null) return line
        const blockEndOffset = match.index + 1 + (match[1].length - "§xx".length)
        const left = line.slice(0, blockEndOffset)
        const right = line.slice(blockEndOffset)
        if (left.trim() == "") return line
        return left + "\n" + right
    }).join("\n")
    if (input === res) return res
    return addNewlineBeforeNestableClosingTags(res)
}

function inputErrorMessage(err: InputError) {
    const val = escapeHtml(err.value)

    switch (err.type) {
        case "ErrUnknown":
            return "An unknown error occurred..?"

        case "ErrOrphan":
            return "Orphan '§' found. Did you mean '§§'?"

        case "ErrUnknownCmd":
            return `Unknown command '${val}'.`

        case "ErrTextLineContainsBlockCmd":
            return `Unexpected block command '${val}' in line. A block command may not have any preceding content in its line.`

        case "ErrUnexpectedBlockClosingCmd":
            return `Unexpected ending block command '${val}'. Did you forget '${matchingOpenCmd(err.value)}'?`

        case "ErrEmpty":
            return `${err.cmd}-command cannot be empty.`

        case "ErrContainsIllegalCmd":
            return `${err.cmd}-command contains illegal command '${val}'.`

        case "ErrMissingEnd":
            return `${err.cmd}-command has no ending.`

        case "ErrCodeIllegalLang":
            return `§\`-command uses unknown language '${val}'. Did you forget a space after '§\'?`

        case "ErrCodeMissingSpace":
            return `§\`-command is missing a space or language. Did you forget a space before '${val.slice(2, -2)}'?`

        case "ErrBlockMissingEnd":
            return `The ${err.block} block has no ending. Did you forget '${closingBlockCmd(err.block!)}'?`

        case "ErrBlockNotEmptyAfterEnd":
            return `Line where ${err.block} block ends with '${closingBlockCmd(err.block!)}' is not empty.`

        case "ErrBlockContainsIllegalCmd":
            return `The ${err.block} block contains an illegal command '${val}'.`

        case "ErrBlockEmpty":
            return `The ${err.block} block cannot be empty.`

        case "ErrCodeBlockIllegalLang":
            return `The code block uses an unknown language '${val}'.`

        case "ErrCodeBlockNotEmptyAfterLanguage":
            return `A new line must be inserted before the code in a code block but '${val}' was found.`

        default:
            return err.type
    }
}

function matchingOpenCmd(x: string) {
    switch (x) {
        case "§>": return "§<"
        case "§]": return "§["
        case "§es": return "§bs"
        case "§eq": return "§bq"
        default: return "??"
    }
}

function closingBlockCmd(x: string) {
    switch (x) {
        case "math": return "§]"
        case "code": return "§>"
        case "quote": return "§eq"
        case "spoiler": return "§es"
        default: return "??"
    }
}
