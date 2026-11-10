/** Efeitos diferidos do concreto: fluência e retração (NBR 6118, Anexo A) e análise AAEM. */
export * from './nbr6118a'
export { type LongTermParams, type SectionRheology, DEFAULT_LONG_TERM, resolveLongTerm, sectionRheology, sectionAirPerimeter, rheologyOf, hasConcreteFrames, annexAForFrame } from './params'
export { type FrameCreep, type CreepStepResult, creepStep, systemFrameForces } from './aaem'
export { runLongTerm, outputTimes } from './longterm'
export { type StageTimeOptions, runStagesInTime } from './stagesTime'
