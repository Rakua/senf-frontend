//#region import/export
export {
    queryWithProgress, queryWithoutProgress, fromKeys,
    queryWithoutProgressGen, queryWithProgressGen, fromKeysGen
}

import { IndexType, IndexTypeLiteral, IndexValuesSet, Query, QueryIndex, timeUnitToFactor, Variables } from "../types/query.js"
import { EntityName, Entity, getProperty, OrderableType, toEntity, EntityModel, EntityRecordType, entityNameToCiType } from "../types/entity.js"
import { entities, entityMainTable, PrimaryKeyOfEntity, PropertyContext } from "./entity.js"
import { db, TableName } from "./schema/db.js"
import { iteratorReturnValue } from "../../../libs/etc/misc.js"
import { CiType } from "../cidb.js"
import { UserCiRecord } from "./schema/v1.js"
import { distinctArray } from "../../../libs/basic/misc.js"
import { lg } from "../config.js"
import { normalizeLocation } from "../misc.js"
import { ciMetadata } from "../types/ci.js"
//#endregion

const noVariables: Variables = {
    string: {
        constant: {},
        parameterized: {}
    },
    number: {
        constant: {},
        parameterized: {}
    },
    date: {
        constant: {},
        parameterized: {}
    }
}

/**
 * Use to query the database for posts, echos, locations or posters.
 * Returns an array of primary keys that matches the query. 
 * Use `fromKeys` to get the entity data.
 */
async function* queryWithProgress<E extends EntityName>(context: PropertyContext, query: Query<E>, variables?: Variables) {
    type PK = PrimaryKeyOfEntity<E>
    type Progress = { total: number, processed: number }

    const ciType = entityNameToCiType(query.entity)

    variables ??= noVariables
    const queryFilter = query.filter ?? ((x: any) => true)
    const typeFilter = ciType != null
        ? (x: { ciType: () => CiType }) => x.ciType() == ciType
        : (x: any) => true
    const pageSize = 1000

    const pks: PK[] = Array.isArray(query.index)
        ? structuredClone(query.index) as PK[]
        : await applyIndex(query.entity, query.index, variables)

    const progress: Progress = { total: pks.length, processed: 0 }
    yield progress

    if (query.filter == undefined && query.order == undefined) {
        //no filter and order => return immediately
        progress.processed = progress.total
        yield progress
        return pks
    }

    type OrderablePK = { pk: PK, pos?: (OrderableType | undefined)[] }
    let res: OrderablePK[] = []
    for (let i = 0; i < pks.length / pageSize; i++) {
        const pagePks: PK[] = []
        for (let j = 0; j < pageSize; j++) {
            const el = pks.pop()
            if (el == undefined) break
            pagePks.push(el)
        }

        const records = (await (entities[query.entity].fetch as Entity<E>["fetch"])(pagePks))
        //assert: records.length == pagePks.length
        for (let j = 0; j < pagePks.length; j++) {
            const rec = records[j]
            if (rec == undefined) continue

            //apply query filter
            const ed = toEntity(query.entity, rec, context)
            if (!queryFilter(ed)) continue

            //for CI entities remove those not of the given type
            //e.g. for post CIs filter out echos CIs etc.
            if (!typeFilter(ed as any)) continue

            //add position array to primary key
            res.push({
                pk: pagePks[j],
                pos: query.order?.position(ed)
            })
        }

        progress.processed += pagePks.length
        yield progress
    }

    if (query.order == undefined) return res.map(v => v.pk)

    //apply query order (sort lexicographically)
    const cmp = lexCompare(query.order.ascending)
    res.sort((a, b) => cmp(a.pos!, b.pos!))
    return res.map(v => v.pk)
}

async function queryWithoutProgress<E extends EntityName>(context: PropertyContext, query: Query<E>, variables?: Variables) {
    return await iteratorReturnValue(queryWithProgress(context, query, variables))
}

function queryWithProgressGen(context: PropertyContext, defaultVariables?: Variables) {
    return <E extends EntityName>(query: Query<E>, variables?: Variables) =>
        queryWithProgress<E>(context, query, variables ?? defaultVariables)
}

function queryWithoutProgressGen(context: PropertyContext, defaultVariables?: Variables) {
    return <E extends EntityName>(query: Query<E>, variables?: Variables) =>
        queryWithoutProgress<E>(context, query, variables ?? defaultVariables)
}

function fromKeysGen(context: PropertyContext) {
    return <E extends EntityName>(entity: E, keys: PrimaryKeyOfEntity<E>[]) =>
        fromKeys<E>(context, entity, keys)
}

async function fromKeys<E extends EntityName>(context: PropertyContext, entity: E, keys: PrimaryKeyOfEntity<E>[]): Promise<EntityModel<E>[]> {
    type Fetch = (keys: PrimaryKeyOfEntity<E>[]) => Promise<(EntityRecordType<E> | undefined)[]>
    const fetch = entities[entity].fetch as Fetch
    const recs = (await fetch(keys)).filter(r => r != undefined)
    const res = recs.map(r => toEntity(entity, r, context))

    switch (entity) {
        case "post":
        case "echo":
            //filter out CIs of other types
            const t = entity == "post" ? CiType.Post : CiType.Echo
            return res.filter(e => (e as EntityModel<"post">).ciType() == t)
        default:
            return res
    }
}

/**
 * Computes an array of primary keys that match the given index
 * If entity is echo, compute indexes from t_userCi and t_userCiMetadata and join them
 */
async function applyIndex<E extends EntityName>(entity: E, index: QueryIndex<E>, variables: Variables): Promise<PrimaryKeyOfEntity<E>[]> {
    if (entity == "echo") {
        const res1 = await applyIndexTable(entity, index, variables, "t_userCi")
        const res2 = await applyIndexTable(entity, index, variables, "t_userCiMetadata")
        return distinctArray(res1.concat(res2))
    } else {
        const tableName = entityMainTable[entity]
        return await applyIndexTable(entity, index, variables, tableName)
    }
}

async function applyIndexTable<E extends EntityName>(entity: E, index: QueryIndex<E>, variables: Variables, table: TableName): Promise<PrimaryKeyOfEntity<E>[]> {
    type PK = PrimaryKeyOfEntity<E>
    type LookupWhereStrPred = typeof lookupWhereStrPred
    const lookupWhereStrPred = {
        "00": "anyOf",
        "01": "anyOfIgnoreCase",
        "10": "startsWithAnyOf",
        "11": "startsWithAnyOfIgnoreCase"
    } as const

    const indexColName = getProperty(entity, index.name).index!
    const whereClause = db[table].where(indexColName)
    const expectedCiType = entity == "post" ? CiType.Post
        : entity == "echo" ? CiType.Echo : null


    let additionalPks: PK[] = []

    let res = await (async () => {
        if (index.type == "string") {
            const prefix = index.prefix ?? false
            const ignoreCase = index.ignoreCase ?? false
            const boolToStr = (x: boolean) => x ? "1" : "0"
            const funcName = lookupWhereStrPred[boolToStr(prefix) + boolToStr(ignoreCase) as keyof LookupWhereStrPred]

            switch (index.values.type) {
                case "set":
                    const values = computeSetValues(index.type, index.values, variables)
                    if (index.name != "location") return whereClause[funcName](values)

                    if (prefix) {
                        //only search for https://xx.com/ as prefix 
                        //get all http locs with emppty pathname and search for them 
                        const domainLocations = []
                        for (const x of values) {
                            const url = URL.parse(x)
                            if (url != null && ["http:", "https:"].includes(url.protocol) && url.pathname == "/") {
                                domainLocations.push(url.href.slice(0,-1))
                            }
                        }
                        additionalPks = await db[table].where(indexColName).anyOf(domainLocations).primaryKeys() as PK[]
                        lg.debug("add pks: ", additionalPks)
                        return whereClause[funcName](values.map(normalizeLocation))
                    } else {
                        //exact => search for all equivalent variants of a location
                        return whereClause[funcName](values.flatMap(locationVariants))
                    }

                default:
                    throw new TypeError("QueryIndex of type string only supports values of type set; got " + index.values.type)
            }
        }

        //compute values
        const vars = variables[index.type]
        switch (index.values.type) {
            case "set":
                const values = computeSetValues(index.type, index.values, variables)
                return whereClause.anyOf(values)

            case "interval":
                if (index.values.start != undefined && index.values.end != undefined) {
                    return whereClause.between(index.values.start, index.values.end)
                } else if (index.values.start != undefined) {
                    return whereClause.aboveOrEqual(index.values.start)
                } else {
                    const end = index.values.end!
                    return whereClause.belowOrEqual(end)
                }

            case "youngerThan":
                const threshold = new Date(Date.now() - timeUnitToFactor(index.values.unit) * index.values.value)
                return whereClause.above(threshold)
        }
    })()

    if (expectedCiType != null) {
        //for post/echo queries filter out CIs that are not of type post/echo
        res = res.and(x => ciMetadata((x as unknown as UserCiRecord).ci).type == expectedCiType)
    }

    const res0 = await res.primaryKeys() as PK[]
    return res0.concat(additionalPks)
}

//#region helpers

/**
 * Returns a compare function that can be passed to `Array.sort` 
 * which orders lexicographically by a fixed-length array.
 * 
 * @param ascending determines whether the i-th component should
 * be ordered in ascending or descending order
 */
function lexCompare(ascending: boolean[]) {
    return (a: (OrderableType | undefined)[], b: (OrderableType | undefined)[]) => {
        if (a.length != b.length) throw new Error(`lexCompare: a and b must have same length, got ${a.length} and ${b.length}`)
        if (a.length != ascending.length) throw new Error(`lexCompare: a and asc must have same length, got ${a.length} and ${ascending.length}`)

        const sign = ascending.map(a => a ? 1 : -1)

        for (let i = 0; i < a.length; i++) {
            //cases where a[i] or b[i] is undefined
            if (a[i] == undefined && b[i] == undefined) continue
            if (a[i] == undefined && b[i] != undefined) return 1
            if (a[i] != undefined && b[i] == undefined) return -1

            if (typeof a[i] != typeof b[i]) throw new Error(`lexCompare: typeof a[i] = ${typeof a[i]} != typeof b[i] = ${typeof b[i]} at i = ${i}`)
            //why doesn't tsc complain that a[i]! and b[i]! cannot be compared using '<' ?
            if (a[i]! < b[i]!) return -1 * sign[i]
            if (a[i]! > b[i]!) return 1 * sign[i]
        }
        return 0
    }
}

function computeSetValues<T extends IndexTypeLiteral>(type: T, set: IndexValuesSet<IndexType<T>>, variables: Variables) {
    const values = set.literals
    //add values from variables
    if (set.variables) {
        for (const { name: varName, parameter: varParam } of set.variables) {
            const kind = varParam ? "parameterized" : "constant"
            const f = variables[type][kind][varName]
            if (f == undefined) throw new QueryVariableNotFoundError(varName, varParam)
            values.push(...f(varParam as string))
        }
    }
    return values
}

function locationVariants(location: string) {
    const url = URL.parse(location)
    if (url !== null && ["http:", "https:"].includes(url.protocol) && url.pathname == "/") {
        return [url.href, url.href.slice(0, -1)]
    } else {
        return [normalizeLocation(location)]
    }
}
//#endregion

//#region errors
class QueryVariableNotFoundError extends Error {
    readonly varName: string
    readonly varParam: string | undefined

    constructor(varName: string, varParam?: string) {
        const errMsg = varParam ? "Parameterized query" : "Query"
        super(`${errMsg} variable ${varName} does not exist (parameter = ${varParam})`)
        this.name = 'QueryVariableNotFoundError'
        this.varName = varName
        this.varParam = varParam
    }
}
//#endregion
