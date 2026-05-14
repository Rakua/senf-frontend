{{
//remove last line if empty
function rllie(x) {
  const y = x.split("\n")
  if(y.length == 1) return y[0]
  const ll = y.pop()
  return (ll.trim() == "" ? y : y.concat(ll)).join("\n")
}

function isEmpty(x) {
  if(typeof x == "string") return x.trim() == ""
  if(typeof x == "object" && x !== null && x.isEmpty !== undefined) return x.isEmpty
  if(Array.isArray(x)) return !x.map(isEmpty).some(x => x == false)
  return false
}

function isInputError(x) {
  return typeof x == "object" && x !== null && typeof x.type == "string" && x.type.startsWith("Err")
}

function isQuoteLine(x) {
  return x[0].type=="Plain" && x[0].value.startsWith(">") && !x.some(y => y.type == "LineBreak")
}

}}

{
  //check that input does not contain unknown commands or orphan §'s
  const f0 = m => m.index + m[1].length-1

  const cmds = ["n","@","!","?","`","$","<",">","[","]","bq","eq","bs","es"]
  const errs = Array.from(input.matchAll(/(\§+)([^ \t\n\§]*)/g).map(m =>
    m[1].length % 2 == 0 ? null //even number of § means the match is no command (all escaped)
      : (m[2] == "" //no text after §
          ? {type: "ErrOrphan", value: "§", startOffset: f0(m), endOffset: f0(m)+1}
          : (!cmds.some(cmd => m[2].startsWith(cmd))
            ? {type: "ErrUnknownCmd", value: "§"+m[2], startOffset: f0(m), endOffset: f0(m)+1+m[2].length} : null))
    ).filter(x => x != null))

  if(errs.length > 0) return errs[0]

  //ensure input ends with '\n'
  if(input == "" || !input.endsWith("\n")) input += "\n"

  let prevLineNonEmptyNonQuote = false
}

//#region main

//Start must always end with \n
Start      = x:(EmptyBlock / TextBlock / CodeBlock / MathBlock / QuoteBlock / SpoilerBlock / InputError)+
  { return isInputError(x[x.length-1]) ? x[x.length-1] : x }

EmptyBlock = lines:(OptWs Nl)+
  { return { type: "EmptyBlock", breaks: lines.length, value: "\n".repeat(lines.length), isEmpty: true } }

TextBlock = lines:(TextLine Nl)+
  {
    const val = lines.map(l => l[0])
    prevLineNonEmptyNonQuote = false //reset after end of text block
    return {
      type: "TextBlock",
      value: val,
      isEmpty: !val.some(textLine => textLine.value.some(part => part.type != "LineBreak"))
    }
  }

TextLine   = x:(Plain / LineBreak / Uri / Code / Math / Emphasis / Spoiler)+
  { 
    const lb = prevLineNonEmptyNonQuote && isQuoteLine(x)
    prevLineNonEmptyNonQuote = !isQuoteLine(x) && !isEmpty(x)
    
    return { type: "TextLine", value: x, isQuoteLine: isQuoteLine(x), isEmpty: isEmpty(x), leadingBreak: lb } 
  }

//#endregion

//#region block commands

CodeBlock
  = OptWs CodeStartCmd lang:CodeLanguage? OptWs Nl x:CommandFreeContent CodeEndCmd OptWs Nl
  { return { type: "CodeBlock", language: lang, value: rllie(x), isEmpty: rllie(x) == "" } }

MathBlock
  = OptWs MathStartCmd x:CommandFreeContent MathEndCmd OptWs Nl
  { return { type: "MathBlock", value: x, isEmpty: isEmpty(x) } }

QuoteBlock
  = OptWs QuoteStartCmd x:Start OptWs QuoteEndCmd OptWs Nl
  { return { type: "QuoteBlock", value: x, isEmpty: isEmpty(x) } }

SpoilerBlock
  = OptWs SpoilerStartCmd x:Start OptWs SpoilerEndCmd OptWs Nl
  { return { type: "SpoilerBlock", value: x, isEmpty: isEmpty(x) } }

CommandFreeContent
  = x:(Txt / Ws / Nl / EscapeCmd)+
  { return x.join("") }

//#endregion

//#region inline commands

Plain "non-empty plain text without line break"
  = x:(OptWs (Txt / EscapeCmd) OptWs)+
  { return { type: "Plain", value: x.map(y => y.join("")).join("") } }

LineBreak
  = OptWs BreakCmd tws:OptWs
  { return { type: "LineBreak", trailingWs: tws != "" } }

Uri
  = OptWs UriCmd x:(Txt / EscapeCmd)+ tws:OptWs
  { return { type: "Uri", value: x.join(""), trailingWs: tws.length > 1 } }

Code
  = OptWs CodeCmd lang:CodeLanguage? " " x:(Plain/Ws) CodeCmd tws:OptWs
  { return { type: "Code", language: lang, value: typeof x == "string" ? x : x.value, trailingWs: tws != "" } }

Math
  = OptWs MathCmd x:Plain MathCmd tws:OptWs
  { return { type: "Math", value: x.value, trailingWs: tws != "" } }

Emphasis
  = OptWs EmphasisCmd x:Plain EmphasisCmd tws:OptWs
  { return { type: "Emphasis", value: x.value, trailingWs: tws != "" } }

Spoiler
  = OptWs SpoilerCmd x:(Plain / Uri / Code / Math / Emphasis)+ SpoilerCmd tws:OptWs
  { return { type: "Spoiler", value: x, trailingWs: tws != "" } }

//#endregion

//#region command groups

InlineCmd       = InlineSingleCmd / InlinePairCmd
InlineSingleCmd = EscapeCmd / BreakCmd / UriCmd
InlinePairCmd   = EmphasisCmd / SpoilerCmd / CodeCmd / MathCmd

BlockCmd        = BlockStartCmd / BlockEndCmd
BlockStartCmd   = CodeStartCmd / MathStartCmd / QuoteStartCmd / SpoilerStartCmd
BlockEndCmd     = CodeEndCmd / MathEndCmd / QuoteEndCmd / SpoilerEndCmd

AnyCmd          = InlineCmd / BlockCmd

//#endregion

//#region tokens
CodeLanguage     = "yaml" / "xml" / "x86asm" / "wasm" / "vhdl" / "verilog" / "vbscript" / "vbnet" / "typescript" / "swift" / "sql" / "smalltalk" / "shell" / "scss" / "scheme" / "scala" / "rust" / "ruby" / "r" / "python-repl" / "python" / "prolog" / "powershell" / "plaintext" / "php-template" / "php" / "pgsql" / "perl" / "ocaml" / "objectivec" / "nim" / "mipsasm" / "matlab" / "mathematica" / "markdown" / "makefile" / "lua" / "llvm" / "lisp" / "less" / "latex" / "kotlin" / "julia" / "json" / "javascript" / "java" / "ini" / "html" / "haskell" / "graphql" / "gradle" / "go" / "glsl" / "fsharp" / "fortran" / "erlang" / "elm" / "elixir" / "ebnf" / "diff" / "delphi" / "d" / "css" / "csharp" / "cpp" / "coq" / "coffeescript" / "cmake" / "clojure" / "c" / "bnf" / "basic" / "bash" / "armasm" / "arduino" / "actionscript" / "abnf"

EscapeCmd        = "§§"           { return "§" }
BreakCmd         = "§n"
UriCmd           = "§@"

EmphasisCmd      = "§!"
SpoilerCmd       = "§?"
CodeCmd          = "§`"
MathCmd          = "§$"

CodeStartCmd     = "§<"
CodeEndCmd       = "§>"
MathStartCmd     = "§["
MathEndCmd       = "§]"
QuoteStartCmd    = "§bq"
QuoteEndCmd      = "§eq"
SpoilerStartCmd  = "§bs"
SpoilerEndCmd    = "§es"

Nl  "new line"   = "\n"
OptWs            = x:Ws?          { return x ?? "" }
Ws  "whitespace" = x:[ \t]+       { return x.join("") }
Txt "text"       = x:[^\n \t§]u+  { return x.join("") }

//#endregion

//#region input errors

InputError
  = x:(CodeBlockError / MathBlockError / QuoteBlockError / SpoilerBlockError / TextLineError) .*
  { return x }

TextLineError
  =  x:(TextLine* UriError / TextLine* CodeError / TextLine* MathError / TextLine* EmphasisError
       / TextLine* SpoilerError / TextLine+ ErrTextLineContainsBlockCmd)
  { return x[1] }
PlainOrEmpty = Plain / OptWs

ErrTextLineContainsBlockCmd = x:BlockStartCmd
  { return { type: "ErrTextLineContainsBlockCmd", value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

//#endregion

//#region quote block errors
QuoteBlockError =  ErrQuoteBlockMissingEnd / ErrQuoteBlockNotEmptyAfterEnd

ErrQuoteBlockMissingEnd = ows:OptWs x:ErrQuoteBlockMissingEndStartToken y:Start OptWs !.
  { return isInputError(y) ? y : { type: "ErrBlockMissingEnd", block: "quote", ...x } }
ErrQuoteBlockMissingEndStartToken = x:QuoteStartCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrQuoteBlockNotEmptyAfterEnd
  = OptWs QuoteStartCmd y:Start QuoteEndCmd OptWs x:TextAfterEndTag
  { return isInputError(y) ? y : { type: "ErrBlockNotEmptyAfterEnd", block: "quote", ...x } }

//#endregion

//#region spoiler block errors
SpoilerBlockError =  ErrSpoilerBlockMissingEnd / ErrSpoilerBlockNotEmptyAfterEnd

ErrSpoilerBlockMissingEnd = ows:OptWs x:ErrSpoilerBlockMissingEndStartToken y:Start OptWs !.
  { return isInputError(y) ? y : { type: "ErrBlockMissingEnd", block:"spoiler", ...x } }
ErrSpoilerBlockMissingEndStartToken = x:SpoilerStartCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrSpoilerBlockNotEmptyAfterEnd
  = OptWs SpoilerStartCmd y:Start OptWs SpoilerEndCmd OptWs x:TextAfterEndTag
  { return isInputError(y) ? y : { type: "ErrBlockNotEmptyAfterEnd", block:"spoiler", ...x } }
//#endregion

//#region code block errors
CodeBlockError = ErrCodeBlockMissingEnd / ErrCodeBlockContainsIllegalCmd / ErrCodeBlockEmpty
                / ErrCodeBlockNotEmptyAfterEnd / ErrCodeBlockIllegalLang / ErrCodeBlockNotEmptyAfterLanguage

ErrCodeBlockMissingEnd = ows:OptWs x:CodeStartCmd (CommandFreeContent / (!CodeEndCmd AnyCmd))* !.
  {
    const os = location().start.offset+ows.length
    const oe = os + x.length
    return { type: "ErrBlockMissingEnd", block: "code", value: x, startOffset: os, endOffset: oe }
  }

ErrCodeBlockContainsIllegalCmd = OptWs CodeStartCmd (CommandFreeContent)? x:ErrCodeBlockIllegalCmd
  { return { type: "ErrBlockContainsIllegalCmd", block: "code", ...x } }
ErrCodeBlockIllegalCmd = !(EscapeCmd / CodeEndCmd) x:AnyCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrCodeBlockEmpty = ows:OptWs CodeStartCmd CodeLanguage? OptWs Nl? CodeEndCmd
  {
    const os = location().start.offset+ows.length
    const oe = location().end.offset
    return {type:"ErrBlockEmpty", block: "code", value: input.slice(os,oe), startOffset: os, endOffset: oe}
  }

ErrCodeBlockNotEmptyAfterEnd
  = OptWs CodeStartCmd CodeLanguage? OptWs Nl CommandFreeContent CodeEndCmd OptWs x:ErrCodeBlockNotEmptyAfterEndIllegal
  { return { type: "ErrBlockNotEmptyAfterEnd", block: "code", ...x } }
ErrCodeBlockNotEmptyAfterEndIllegal = x:(Txt / AnyCmd) y:(Ws / Txt / AnyCmd)*
  { return { value: x+y.join(""), startOffset: location().start.offset, endOffset: location().end.offset } }

ErrCodeBlockIllegalLang = ows:OptWs CodeStartCmd x:ErrCodeBlockIllegalLangName
  { return { type: "ErrCodeBlockIllegalLang", ...x } }
ErrCodeBlockIllegalLangName = !(CodeLanguage (" " / "\t" / Nl)) x:(Txt / EscapeCmd)+
  { return { value: x.join(""), startOffset: location().start.offset, endOffset: location().end.offset } }

ErrCodeBlockNotEmptyAfterLanguage
  = OptWs CodeStartCmd CodeLanguage? Ws x:TextAfterEndTag
  { return { type: "ErrCodeBlockNotEmptyAfterLanguage", ...x } }
//#endregion

//#region math block errors
MathBlockError = ErrMathBlockMissingEnd / ErrMathBlockContainsIllegalCmd / ErrMathBlockEmpty / ErrMathBlockNotEmptyAfterEnd

ErrMathBlockMissingEnd = ows:OptWs x:MathStartCmd (CommandFreeContent / (!MathEndCmd AnyCmd))* !.
  {
    const os = location().start.offset+ows.length
    const oe = os + x.length
    return { type: "ErrBlockMissingEnd", block:"math", value: x, startOffset: os, endOffset: oe }
  }

ErrMathBlockContainsIllegalCmd = OptWs MathStartCmd (CommandFreeContent)? x:ErrMathBlockIllegalCmd
  { return { type: "ErrBlockContainsIllegalCmd", block:"math", ...x } }
ErrMathBlockIllegalCmd = !(EscapeCmd / MathEndCmd) x:AnyCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrMathBlockEmpty = ows:OptWs MathStartCmd (Ws / Nl)* MathEndCmd
  {
    const os = location().start.offset+ows.length
    const oe = location().end.offset
    return {type:"ErrBlockEmpty", block:"math", value: input.slice(os,oe), startOffset: os, endOffset: oe}
  }

ErrMathBlockNotEmptyAfterEnd
  = OptWs MathStartCmd CommandFreeContent MathEndCmd OptWs x:TextAfterEndTag
  { return { type: "ErrBlockNotEmptyAfterEnd", block:"math", ...x } }

TextAfterEndTag = x:(Txt / AnyCmd) y:(Ws / Txt / AnyCmd)*
  { return { value: x+y.join(""), startOffset: location().start.offset, endOffset: location().end.offset } }
//#endregion

//#region uri errors
UriError = ErrUriEmpty / ErrUriContainsIllegalCmd

ErrUriEmpty = PlainOrEmpty x:ErrUriEmptyStart & (Ws / Nl)
  {  return { type: "ErrEmpty", cmd: x.value, ...x }}
ErrUriEmptyStart = x:UriCmd { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrUriContainsIllegalCmd = PlainOrEmpty UriCmd x:ErrUriIllegalParam
  {  return { type: "ErrContainsIllegalCmd", cmd: x, ...x }}
ErrUriIllegalParam = x:(Txt/AnyCmd)+
  { return { value: x.join(""), startOffset: location().start.offset, endOffset: location().end.offset } }
//#endregion

//#region code errors
CodeError = ErrCodeMissingEnd / ErrCodeContainsIllegalCmd / ErrCodeEmpty / ErrCodeMissingSpace / ErrCodeIllegalLang

ErrCodeMissingEnd = ows:OptWs x:CodeCmd (Txt / Ws / (!CodeCmd AnyCmd) )* & Nl
  {
    const os = location().start.offset+ows.length
    const oe = os + x.length
    return { type: "ErrMissingEnd", cmd: x, value: x, startOffset: os, endOffset: oe }
  }

ErrCodeContainsIllegalCmd = OptWs a:CodeCmd (Plain/Ws)? x:ErrCodeIllegalCmd
  { return { type: "ErrContainsIllegalCmd", cmd: a, ...x } }
ErrCodeIllegalCmd = !(EscapeCmd / CodeCmd) x:AnyCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrCodeEmpty = ows:OptWs a:CodeCmd CodeLanguage? " "? CodeCmd
  {
    const os = location().start.offset+ows.length
    const oe = location().end.offset
    return {type:"ErrEmpty", cmd: a, value: input.slice(os,oe), startOffset: os, endOffset: oe}
  }

ErrCodeMissingSpace = ows:OptWs CodeCmd (Txt / (!CodeCmd AnyCmd))+ CodeCmd
  {
    const os = location().start.offset+ows.length
    const oe = location().end.offset
    return {type:"ErrCodeMissingSpace", value: input.slice(os,oe), startOffset: os, endOffset: oe}
  }

ErrCodeIllegalLang = ows:OptWs CodeCmd x:ErrCodeIllegalLangName " "
  { return { type: "ErrCodeIllegalLang", ...x } }
ErrCodeIllegalLangName = !(CodeLanguage " ") x:(Txt / AnyCmd)+
  { return { value: x.join(""), startOffset: location().start.offset, endOffset: location().end.offset } }
//#endregion

//#region math errors
MathError = ErrMathMissingEnd / ErrMathContainsIllegalCmd / ErrMathEmpty

ErrMathMissingEnd = ows:OptWs x:MathCmd (Txt / Ws / (!MathCmd AnyCmd) )* & Nl
  {
    const os = location().start.offset+ows.length
    const oe = os + x.length
    return { type: "ErrMissingEnd", cmd: x, value: x, startOffset: os, endOffset: oe }
  }

ErrMathContainsIllegalCmd = OptWs a:MathCmd (Plain/Ws)? x:ErrMathIllegalCmd
  { return { type: "ErrContainsIllegalCmd", cmd: a, ...x } }
ErrMathIllegalCmd = !(EscapeCmd / MathCmd) x:AnyCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrMathEmpty = ows:OptWs a:MathCmd OptWs MathCmd
  {
    const os = location().start.offset+ows.length
    const oe = location().end.offset
    return {type:"ErrEmpty", cmd: a, value: input.slice(os,oe), startOffset: os, endOffset: oe}
  }
//#endregion

//#region emphasis errors
EmphasisError = ErrEmphasisMissingEnd / ErrEmphasisContainsIllegalCmd / ErrEmphasisEmpty

ErrEmphasisMissingEnd = ows:OptWs x:EmphasisCmd (Txt / Ws / (!EmphasisCmd AnyCmd) )* & Nl
  {
    const os = location().start.offset+ows.length
    const oe = os + x.length
    return { type: "ErrMissingEnd", cmd: x, value: x, startOffset: os, endOffset: oe }
  }

ErrEmphasisContainsIllegalCmd = OptWs a:EmphasisCmd (Plain/Ws)? x:ErrEmphasisIllegalCmd
  { return { type: "ErrContainsIllegalCmd", cmd: a, ...x } }
ErrEmphasisIllegalCmd = !(EscapeCmd / EmphasisCmd) x:AnyCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrEmphasisEmpty = ows:OptWs a:EmphasisCmd OptWs EmphasisCmd
  {
    const os = location().start.offset+ows.length
    const oe = location().end.offset
    return {type:"ErrEmpty", cmd: a, value: input.slice(os,oe), startOffset: os, endOffset: oe}
  }
//#endregion

//#region spoiler errors
SpoilerError = ErrSpoilerMissingEnd / ErrSpoilerContainsIllegalCmd / ErrSpoilerEmpty / ErrSpoilerContainsError

ErrSpoilerContainsError
  = OptWs SpoilerCmd (Plain / Uri / Code / Math / Emphasis)* x:ErrSpoilerContainsErrorErr
  { return x }

ErrSpoilerContainsErrorErr = UriError / CodeError / MathError / EmphasisError

ErrSpoilerMissingEnd = ows:OptWs x:SpoilerCmd (Txt / Ws / (!SpoilerCmd AnyCmd) )* & Nl
  {
    const os = location().start.offset+ows.length
    const oe = os + x.length
    return { type: "ErrMissingEnd", cmd: x, value: x, startOffset: os, endOffset: oe }
  }

ErrSpoilerContainsIllegalCmd = OptWs a:SpoilerCmd (Plain/Ws)? x:ErrSpoilerIllegalCmd
  { return { type: "ErrContainsIllegalCmd", cmd: a, ...x } }
ErrSpoilerIllegalCmd = !(EscapeCmd / SpoilerCmd / UriCmd / EmphasisCmd / CodeCmd / MathCmd) x:AnyCmd
  { return { value: x, startOffset: location().start.offset, endOffset: location().end.offset } }

ErrSpoilerEmpty = ows:OptWs a:SpoilerCmd OptWs SpoilerCmd
  {
    const os = location().start.offset+ows.length
    const oe = location().end.offset
    return {type:"ErrEmpty", cmd: a, value: input.slice(os,oe), startOffset: os, endOffset: oe}
  }
//#endregion
