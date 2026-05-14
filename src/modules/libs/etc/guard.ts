export {
    Guard, Constraints, DescribedType, TypeMismatch, TypeDescribesItself, FullTypePredicate,
    typeOf, guard, fallback, hasType,
    primitiveType, literalType, unionType, intersectionType, tupleType, arrayType, recordType, optionalType,
    guards, toArrayGuard, literalGuard,
    andConstraints, toArrayConstraint, finiteConstraint, integerConstraint, urlConstraint,
    uniqueConstraint,
    customFullTypePredicate
}

import { AnyButUndefined, IntersectTuple, nonUniqueValue } from "../basic/misc.js"

//#region types

/**
 * A guard is a type predicate which checks whether `x` has type `T`. If
 * not, it indirectly returns the reason why by modifying `rv.value`.
 */
type Guard<T> = (x: any, rv: { value: null }) => x is T
type Constraints<T> = (x: T) => boolean | { reason: any }
type ConstraintsWithReason<T, S> = (x: T) => true | { reason: S }
type TypeMatch = typeof typeMatch
type TypeMismatch = IllegalType | MissingProperty | SuperfluousProperties | PredicateFail
type TypeMismatchCommon = { match: false, path: PropertyPath, offendingValue: any }
type IllegalType = TypeMismatchCommon & {
    type: "illegalType",
    error: {
        expectedType: string,
        gotType: string
    }
}
type MissingProperty = TypeMismatchCommon & {
    type: "missingProperty",
    error: {
        key: string
    }
}
type SuperfluousProperties = TypeMismatchCommon & {
    type: "superfluousProperties",
    error: {
        superfluousKeys: string[],
        allowedKeys: string[]
    }
}
type PredicateFail = TypeMismatchCommon & {
    type: "predicateFail",
    name: string,
    error: any
}


type PropertyPath = (string | number)[] //string => property name, number => array index

/**
 * The value of outputType should not be used. Its type is only used to transport 
 * the information what type x has if it satisfies the type predicate, i.e. when
 * `match` is true.
 * 
 * If `T` is the type of a property `a` and `optional` is true then the property
 * `a` may be omitted in an object.
 */
type FullTypePredicate<T> = {
    type: typeof FULL_PREDICATE,
    predicate: TypePredicate<T>,
    optional?: boolean
}

type TypePredicate<T> = (x: any) => {
    match: boolean,
    name: string,
    outputType: T, // runtime value undefined
    error?: any // why the value did not match the predicate
}

type RecordKeyTypeLabel = "string" | "number" | "symbol"
type RecordKeyType<T extends RecordKeyTypeLabel> =
    T extends "string" ? string :
    T extends "number" ? number :
    T extends "symbol" ? symbol : never

/**
 * Todo: should only be satisfied if T describes itself
 * - T contains no type unions
 * - T contains no tuples
 * - applying DescribedType to T does not change it
 */
type TypeDescribesItself<T> = T

// type TypeDescribesItselfTodo<T> = T
//     T extends DescribedType<T> ? (DescribedType<T> extends T ? T : never) : never

type DescribedType<T> =
    T extends number ? number :
    T extends Number ? Number :
    T extends TypeError ? TypeError :
    T extends RangeError ? RangeError :
    T extends ReferenceError ? ReferenceError :
    T extends SyntaxError ? SyntaxError :
    T extends EvalError ? EvalError :
    T extends URIError ? URIError :
    T extends Error ? Error :
    T extends Date ? Date :
    T extends URL ? URL :
    T extends RegExp ? RegExp :
    T extends Promise<infer S> ? Promise<S> :
    T extends Set<infer S> ? Set<S> :
    T extends WeakSet<infer S> ? WeakSet<S> :
    T extends Map<infer K, infer V> ? Map<K, V> :
    T extends WeakMap<infer K, infer V> ? WeakMap<K, V> :
    T extends Int8Array ? Int8Array :
    T extends Int16Array ? Int16Array :
    T extends Int32Array ? Int32Array :
    T extends Uint8Array ? Uint8Array :
    T extends Uint16Array ? Uint16Array :
    T extends Uint32Array ? Uint32Array :
    T extends Uint8ClampedArray ? Uint8ClampedArray :
    T extends Float32Array ? Float32Array :
    T extends Float64Array ? Float64Array :
    T extends Symbol ? Symbol :
    T extends ArrayBuffer ? ArrayBuffer :
    T extends DataView ? DataView :
    T extends FullTypePredicate<infer S> ? S :
    T extends (...args: any[]) => any ? T :
    T extends Record<keyof any, any> ? { [K in keyof T]: DescribedType<T[K]> } :
    T extends (infer S)[] ? DescribedType<S>[] :
    T

//#endregion

const FULL_PREDICATE: unique symbol = Symbol("FULL_PREDICATE")
const typeMatch = { match: true } as const

//#region main functions

/**
 * More specific version of the JS typeof operator that returns `"null"` 
 * and `"array"` for such values instead of `"object"`.
 */
function typeOf(x: any) {
    if (x === null) return "null"
    if (Array.isArray(x)) return "array"
    return typeof x
}

//wrap T1 and T2 in tuple to prevent distribution
type EquivalentTypes<T1, T2> = [T1] extends [T2] ? ([T2] extends [T1] ? true : false) : false
type GuardTypeGuard<T, CT extends Constraints<any>> = CT extends Constraints<infer T2>
    ? (EquivalentTypes<DescribedType<T>, T2> extends true
        ? Guard<DescribedType<T>>
        : { never: never, error: "type of parameter y and constraints are not compatible", y: T, constraints: CT })
    : never

/**
 * Creates a guard from the type described by `y`. The `constraints` parameter can 
 * be used to check more specific properties such as relations among properties.
 * 
 * @param constraints should return `true` on success and `false` or `{reason: any}` on failure
 * 
 * @example
 * const g = guard({a: [""]}, x => x.a.length > 0 ? true : {reason: "empty"})
 * const rv = {value: null}
 * const x : any = "a"
 * if(g(x,rv)) {
 *     console.log("length of first string in a", x.a[0].length)
 * } else {
 *     console.log(rv.value as any) //reason the guard rejected
 * }
 */
function guard<T>(y: T): Guard<DescribedType<T>>;
function guard<T, CT extends Constraints<any>>(y: T, constraints: CT): GuardTypeGuard<T, CT>;
function guard<T>(y: T, constraints?: Constraints<DescribedType<T>>): Guard<DescribedType<T>> {
    constraints ??= x => true
    return function (x: any, rv: { value: null }): x is DescribedType<T> {
        if (hasType(x, y, rv)) {
            const res = constraints(x)
            if (res === true) return true
            rv.value = res === false ? "constraints failed" : res.reason
        }
        return false
    }
}

/**
 * Returns `value` if `value` passes `guard` and `fallbackValue` otherwise.
 */
function fallback<T>(value: any, fallbackValue: T, guard: Guard<T>): T {
    return guard(value, { value: null }) ? value : fallbackValue
}

/**
 * Checks if `x` has the type described by `y`. 
 * 
 * If `exact` is true then for every plain object `z` contained in `y` it is also 
 * checked that the corresponding part `w` in `x` contains no fields  that do not 
 * also occur in `z`. Otherwise, `x` may contain additional fields.
 * 
 * A plain object is an object which is not null, not an array, not an instance
 * of a class and not a full type predicate, e.g. `{x: 1, y: true}` is a plain
 * object.
 * 
 * @param rv `rv.value` contains a value of type `TypeMismatch` if `false` is returned
 * @param exact `false` by default
 * 
 * @example
 * const y = { a: false, b: "" }
 * let x: any = undefined
 * const rv = { value: null }
 * if (hasType(x, y, rv)) {
 *     //x has type { a: boolean, b: string }
 * } else {
 *     const tm = rv.value as unknown as TypeMismatch
 *     console.log("x doesn't have the required type: %O", tm)
 * }
 */
function hasType<S>(x: any, y: S, rv: { value: null }, exact?: boolean): x is DescribedType<S> {
    const res = hasTypeRec(x, y, [], exact ?? false)
    rv.value = res as any
    return res.match
}

/**
 * Checks if `x` has the type described by `y`.
 * 
 * If `y` is a primitive value then `x` must be a primitive value of 
 * the same type.
 * 
 * If `y` is an array then `x` must be an array and all elements of
 * `x` must be of the type described by the first element of `y`. 
 * If `y` is empty then the the elements of `x` can be of any type.
 * 
 * If `y` is an object but not null and not an array then the following
 * is checked. If `y` has a property `constructor` of type `function` 
 * then `x.constructor === y.constructor` must hold (check if they are
 * instances of the same class). Otherwise, all the properties that `y` has 
 * must be subtypes of the corresponding ones in `y`.
 */
function hasTypeRec(x: any, y: any, path: PropertyPath, exact: boolean): TypeMatch | TypeMismatch {
    const tmc: TypeMismatchCommon = {
        match: false,
        path: path,
        offendingValue: x
    }

    const toy = typeOf(y)
    switch (toy) {
        case "string":
        case "number":
        case "bigint":
        case "boolean":
        case "symbol":
        case "undefined":
        case "null":
            return typeOf(x) == toy ? typeMatch : illegalType(path, x, y)

        case "function":
            throw new TypeError("y cannot contain a function")

        case "array":
            if (typeOf(x) != "array") return illegalType(path, x, y)
            if (y.length == 0) return typeMatch //y empty => elements of x can be of any type
            for (let i = 0; i < x.length; i++) {
                const res = hasTypeRec(x[i], y[0], path.concat([i]), exact)
                if (!res.match) return res
            }
            return typeMatch

        case "object":
            if (isFullTypePredicate(y)) {
                const res = y.predicate(x)
                return res.match ? typeMatch : {
                    type: "predicateFail",
                    name: res.name,
                    error: res.error,
                    ...tmc
                }
            }

            if (!isPlainObject(y)) {
                //y is an instance of a class => check if x is an instance of the same class                    
                return x.constructor === y.constructor ? typeMatch : illegalType(path, x, y)
            }

            //y is a plain object => check each property
            for (const key in y) {
                const yk = y[key]
                const keyIsOptional = isFullTypePredicate(yk) && yk.optional === true

                if (!(key in x) && !keyIsOptional) {
                    //x does not have key as (inherited) property
                    return {
                        type: "missingProperty",
                        error: { key: key },
                        ...tmc
                    }
                }
                const res = hasTypeRec(x[key], y[key], path.concat([key]), exact)
                if (!res.match) return res
            }

            if (exact) {
                const xKeys = new Set(Object.keys(x))
                const yKeys = new Set(Object.keys(y))
                const diffKeys = xKeys.difference(yKeys)
                if (diffKeys.size > 0) {
                    return {
                        type: "superfluousProperties",
                        error: {
                            superfluousKeys: Array.from(diffKeys),
                            allowedKeys: Array.from(yKeys)
                        },
                        ...tmc
                    }
                }
            }
            return typeMatch
    }
}
//#endregion

//#region functions and constants to construct values to describe types

/**
 * This object can be used to represent primitive types instead of
 * using arbitrary literals
 */
const primitiveType = {
    boolean: false,
    number: 0,
    bigint: 0n,
    string: "",
    null: null,
    undefined: undefined
} as const

/**
 * Constructs a type predicate consisting of the union of literals passed 
 * as arguments.
 * 
 * @example
 * literalType("a","b")
 * 
 * const x = ["a","b"] as const
 * literalType(...x)
 * 
 * enum X { A = "a", B = "b" }
 * literalType(...Object.values(X))
 */
function literalType<S extends string | number | boolean>(...y: S[]): FullTypePredicate<S> {
    const retVal = predicateReturnValue<S>("literal")
    const f = (x: any) => {
        const err = y.includes(x) ? undefined : { expected: y, got: x }
        return retVal(err)
    }
    return toFullTypePredicate(f)
}

function unionType<S extends [...any[]]>(...y: S): FullTypePredicate<DescribedType<S[number]>> {
    return customFullTypePredicate("union", (x, retVal) => {
        const rvArr = []
        for (let i = 0; i < y.length; i++) {
            const rv = { value: null }
            if (hasType(x, y[i], rv)) return retVal()
            rvArr.push(rv.value)
        }

        return retVal(rvArr)
    })
}

function intersectionType<S extends [...any[]]>(...y: S): FullTypePredicate<DescribedType<IntersectTuple<S>>> {
    return customFullTypePredicate("intersection", (x, retVal) => {
        for (let i = 0; i < y.length; i++) {
            const rv = { value: null }
            if (!hasType(x, y[i], rv)) return retVal(rv.value)
        }

        return retVal()
    })
}

function tupleType<S extends [...any[]]>(...y: S): FullTypePredicate<DescribedType<S>> {
    return customFullTypePredicate("tuple", (x, retVal) => {
        if (typeOf(x) != "array")
            return retVal({ expectedType: "array", gotType: typeOf(x) })
        if (x.length != y.length)
            return retVal({ expectedLength: y.length, gotLength: x.length })

        const rvArr: { index: number, mismatch: TypeMismatch }[] = []
        for (let i = 0; i < y.length; i++) {
            const rv = { value: null }
            if (!hasType(x[i], y[i], rv))
                rvArr.push({ index: i, mismatch: rv.value as unknown as TypeMismatch })
        }

        return rvArr.length == 0 ? retVal() : retVal(rvArr)
    })
}

/**
 * The `options` parameter allows to specify a min and max length for the array.
 * 
 * todo: test
 */
function arrayType<S>(y: S, options?: { minLength?: number, maxLength?: number }): FullTypePredicate<DescribedType<S>[]> {
    const minLen = options?.minLength ?? 0
    const maxLen = options?.maxLength ?? Number.POSITIVE_INFINITY

    const retVal = predicateReturnValue<DescribedType<S>[]>("array")
    const f = (x: any) => {
        const rv = { value: null }

        if (Array.isArray(x)) {
            //if x is an array then check its length before checking 
            //the type of its elements for efficiency
            if (x.length < minLen)
                return retVal({ minLength: minLen, gotLength: x.length })
            if (x.length > maxLen)
                return retVal({ minLength: maxLen, gotLength: x.length })
        }
        if (!hasType(x, [y], rv))
            return retVal(rv.value as unknown as TypeMismatch)

        return retVal()
    }
    return toFullTypePredicate(f)
}


/**
 * Returns a full type predicate for the type `Record<K,T>`
 */
function recordType<K extends RecordKeyTypeLabel, T>(type: K, y: T): FullTypePredicate<Record<RecordKeyType<K>, DescribedType<T>>> {
    const retVal = predicateReturnValue<Record<RecordKeyType<K>, DescribedType<T>>>("record")
    const f = (x: any) => {
        const rv = { value: null }

        if (typeOf(x) != "object") return retVal({ type: "illegalType", got: typeOf(x), expected: "object" })
        for (const key in x) {
            if (typeOf(key) != type) {
                return retVal({
                    type: "illegalKeyType",
                    key: key,
                    got: typeOf(key),
                    expected: type
                })
            }
            const val = x[key]
            if (!hasType(val, y, rv)) {
                return retVal({
                    type: "illegalValueType",
                    key: key,
                    value: val,
                    error: rv.value as unknown as TypeMismatch
                })
            }
        }
        return retVal()
    }
    return toFullTypePredicate(f)
}

/**
 * Same as `unionType(x, undefined)` except if the returned type 
 * is used as type of some property `prop` in an object then `prop` 
 * can be omitted in that object. Use `unionType(x, undefined)` 
 * instead if the property should not be omittable.
 */
function optionalType<S>(x: S): FullTypePredicate<DescribedType<S> | undefined> {
    const ftp = unionType(x, undefined)
    ftp.optional = true
    return ftp
}

type PRV<S> = ReturnType<typeof predicateReturnValue<DescribedType<S>>>
/**
 * Use to define your own custom full type predicates. The parameter `f`
 * is the predicate function which gets the value `x` to be checked and
 * a special function `retVal` as parameters. It should call 
 * `return retVal()` if `x` matches and `return retVal(err)` otherwise, 
 * where `err` is a plain object describing why `x` does not match.
 */
function customFullTypePredicate<S>(predicateName: string, f: (x: any, retVal: PRV<S>) => ReturnType<TypePredicate<DescribedType<S>>>): FullTypePredicate<DescribedType<S>> {
    const retVal = predicateReturnValue<DescribedType<S>>(predicateName)
    return toFullTypePredicate((x: any) => f(x, retVal))
}
//#endregion

//#region constraints: use to check properties of values that are more specific than their shape

/**
 * Combines multiple constraints into a single one such that 
 * the resulting constraint is satisfied iff all input constraints
 * are. The constraints are tested in the order provided and 
 * testing stops as soon as the first constraint that fails is found.
 */
function andConstraints<T>(...c: Constraints<T>[]): Constraints<T> {
    return x => {
        for (let i = 0; i < c.length; i++) {
            const ciRes = c[i](x)
            if (ciRes !== true) return ciRes
        }
        return true
    }
}

function toArrayConstraint<T>(c: Constraints<T>): ConstraintsWithReason<T[], { index: number, reason: any }> {
    return x => {
        for (let i = 0; i < x.length; i++) {
            const res = c(x[i])
            if (res !== true)
                return { reason: { index: i, reason: res } }
        }
        return true
    }
}

/**
 * Only works for types `T` such that `T` is serializable as JSON and
 * the order of properties is normalized
 */
function uniqueConstraint<T extends AnyButUndefined>(): ConstraintsWithReason<T[], { nonUniqueValue: T }> {
    return (x: T[]) => {
        const nuv = nonUniqueValue(x)
        return nuv === undefined ? true : { reason: { nonUniqueValue: nuv } }
    }
}

function finiteConstraint(): ConstraintsWithReason<number, "not finite"> {
    return x => Number.isFinite(x) ? true : { reason: "not finite" }
}

function integerConstraint(): ConstraintsWithReason<number, "not an integer"> {
    return x => x % 1 == 0 ? true : { reason: "not an integer" }
}

const urlInvalidProtocol = "invalid protocol"
const urlInvalidConstructor = "URL constructor failed"
type UrlConstraintReason = UrlConstraintReasonConstructor | UrlConstraintReasonInvalidProtocol
type UrlConstraintReasonConstructor = { message: typeof urlInvalidProtocol, expected: string[], got: string }
type UrlConstraintReasonInvalidProtocol = { message: typeof urlInvalidConstructor, error: any }
function urlConstraint(protocols?: string[]): ConstraintsWithReason<string, UrlConstraintReason> {
    protocols ??= ["http", "https"]
    return x => {
        try {
            const url = new URL(x)
            const protocol = url.protocol.slice(0, -1)
            return protocols.includes(protocol) ? true
                : { reason: { message: urlInvalidProtocol, expected: protocols, got: protocol } }
        } catch (e) {
            return { reason: { message: urlInvalidConstructor, error: e } }
        }
    }
}
//#endregion

//#region convenience guards
const guards = {
    integer: guard(0, integerConstraint()),
    nonNegativeInteger: guard(0, andConstraints(integerConstraint(), x => x >= 0 ? true : { reason: "negative" })),
    positiveInteger: guard(0, andConstraints(integerConstraint(), x => x > 0 ? true : { reason: "not positive" })),
    url: guard("", urlConstraint()),
}

/**
 * Converts a guard for `T` into a guard for `T[]` by applying `g` to every
 * element of the array.
 */
function toArrayGuard<T>(g: Guard<T>, constraints?: Constraints<T[]>): Guard<T[]> {
    constraints ??= x => true

    return function (x: any, rv: { value: null }): x is T[] {
        if (!Array.isArray(x)) {
            rv.value = illegalType([], x, []) as any
            return false
        }
        for (let i = 0; i < x.length; i++) {
            if (!g(x[i], rv)) {
                rv.value = { index: i, reason: rv.value } as any
                return false
            }
        }

        const res = constraints(x)
        rv.value = res === true ? null : (res === false ? "constraints failed" : res.reason)
        return res === true
    }
}

function literalGuard<T extends string | number>(...literals: T[]) {
    return guard(literalType(...literals))
}

//#endregion

//#region helper functions
function toFullTypePredicate<T>(f: TypePredicate<T>): FullTypePredicate<T> {
    return { type: FULL_PREDICATE, predicate: f }
}

function isFullTypePredicate(x: any): x is FullTypePredicate<unknown> {
    return typeOf(x) == "object" && x.type === FULL_PREDICATE
}

function isPlainObject(x: any) {
    return typeOf(x) == "object" && x.constructor.name == "Object"
}

function predicateReturnValue<T>(name: string, error?: any) {
    return (error?: any) => ({
        match: error === undefined,
        name: name,
        outputType: undefined as T,
        error: error
    })
}

function illegalType(path: PropertyPath, x: any, y: any): IllegalType {
    const tx = typeOf(x)
    const ty = typeOf(y)

    return {
        match: false,
        type: "illegalType",
        path: path,
        offendingValue: x,
        error: {
            expectedType: ty == "object" ? y.constructor.name : ty,
            gotType: tx == "object" ? x.constructor.name : tx,
        }
    }
}
//#endregion

// function example() {
//     //conventional definition of a type
//     type Book = BookMagazine | BookHardcover
//     type BookCommon = {
//         title: string,
//         authors: Author[],
//         isbn: string,
//         price: number
//     }
//     type Author = [string, string] //first name; last name
//     type Genre = "drama" | "scifi" | "thriller"
//     type BookMagazine = BookCommon & {
//         type: "magazine",
//         issue: number,
//         date: Date
//     }
//     type BookHardcover = BookCommon & {
//         type: "hardcover"
//         genre: Genre
//     }

//     //defintion of a type in terms of runtime values
//     //since constants are not hoisted the order differs from the type defintions
//     const exAuthor = tupleType("", "")
//     const exBookCommon = {
//         title: "",
//         authors: [exAuthor],
//         isbn: "",
//         price: 0
//     }

//     const genres = ["drama", "scifi", "thriller"] as const
//     const exGenre = literalType(...genres)
//     const exBookMagazine = {
//         ...exBookCommon,
//         type: literalType("magazine"),
//         issue: 0,
//         date: new Date()
//     }
//     const exBookHardcover = {
//         ...exBookCommon,
//         type: literalType("hardcover"),
//         genre: exGenre
//     }
//     const exBook = unionType(exBookHardcover, exBookMagazine)
//     type ExBook = DescribedType<typeof exBook>

//     //let tsc verify that both type definitions are equivalent 
//     type CheckEquivalence = [Book] extends [ExBook]
//         ? ([ExBook] extends [Book]
//             ? "Book is equivalent to ExBook"
//             : "ExBook does not extend Book")
//         : "Book does not extend ExBook"

//     //usage example
//     let x: any = {
//         type: "hardcover",
//         title: "asd",
//         authors: ["Bob"],
//         isbn: "123ABC",
//         price: 34
//     }
//     const rv = { value: null } //used to store information in case of a mismatch
//     if (hasType(x, exBook, rv)) {
//         //value of x is of type Book
//         switch (x.type) {
//             case "hardcover":
//                 console.log(x.genre)
//                 break

//             case "magazine":
//                 console.log(x.date.toISOString())
//                 break
//         }
//     } else {
//         const tm = rv.value as unknown as TypeMismatch
//         console.log("x is not a book because: %O", tm)
//     }
// }