export class ProcessError extends Error {
    constructor(message: string, readonly stderr: string) { super(message); }
}

export class StopError extends Error {
    constructor() { super('Stopped by user'); }
}

export class SkipTrack extends Error {
    constructor(readonly reason: string) { super(reason); }
}