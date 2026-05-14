export { periodEx, periodGuard }

import { FullTypePredicate, guard, literalType, optionalType, unionType } from "../../../../libs/etc/guard.js"
import { Period } from "./PeriodSelect.js"

const periodYoungerThanUnit = literalType("minute", "hour", "day", "week", "month", "year")
const periodYoungerThan = { type: literalType("youngerThan"), unit: periodYoungerThanUnit, value: 0 }
const periodIntervalStart = { type: literalType("interval"), start: new Date(), end: optionalType(new Date()) }
const periodIntervalEnd = { type: literalType("interval"), start: optionalType(new Date()), end: new Date() }
const periodInterval = unionType(periodIntervalStart, periodIntervalEnd)
const periodEx = unionType(null, periodYoungerThan, periodInterval)

const periodGuard = guard<FullTypePredicate<Period>>(periodEx)