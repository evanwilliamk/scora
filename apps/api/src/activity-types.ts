// What counts as a run. Strava's legacy `type` is 'Run' for road and trail
// runs (sport_type 'TrailRun') and 'VirtualRun' for treadmill and Zwift runs,
// which are training load like any other run.
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

export const isRun = (a: any): boolean => RUN_TYPES.has(a?.type) || RUN_TYPES.has(a?.sport_type);

// Outdoor runs only, for race predictions: treadmill distance is an estimate.
export const isOutdoorRun = (a: any): boolean => isRun(a) && a?.type !== 'VirtualRun' && a?.sport_type !== 'VirtualRun';
