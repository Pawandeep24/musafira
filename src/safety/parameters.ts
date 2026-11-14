import { z } from "zod";

export const PARAMETER_IDS = [
  "lighting",
  "safetyStops",
  "crowd",
  "signal",
  "essentialServices",
  "openShops",
  "breakdownHelp",
  "roadType",
] as const;

export type ParameterId = (typeof PARAMETER_IDS)[number];
export type Weights = Readonly<Record<ParameterId, number>>;

export const MAX_WEIGHT = 10;

export interface ParameterInfo {
  readonly id: ParameterId;
  readonly label: string;
  readonly description: string;
  readonly defaultWeight: number;
}

export const PARAMETERS: readonly ParameterInfo[] = [
  {
    id: "lighting",
    label: "Street lighting",
    description: "Satellite night-light intensity blended with road class. Only counts after sunset.",
    defaultWeight: 10,
  },
  {
    id: "safetyStops",
    label: "Safety stops",
    description: "Police, hospitals, fuel pumps and 24/7 places open when you pass. Long gaps are penalised.",
    defaultWeight: 9,
  },
  {
    id: "crowd",
    label: "People around",
    description: "Live traffic when leaving now, otherwise open shops, bus stops and stations at your arrival time.",
    defaultWeight: 8,
  },
  {
    id: "signal",
    label: "Mobile signal",
    description: "Cell-tower density along the route. Dead zones are penalised.",
    defaultWeight: 5,
  },
  {
    id: "essentialServices",
    label: "Essential services",
    description: "Hospitals, clinics, pharmacies and police within 300 m.",
    defaultWeight: 5,
  },
  {
    id: "openShops",
    label: "Shops open",
    description: "Shops and eateries still open at least 15 minutes after you pass.",
    defaultWeight: 5,
  },
  {
    id: "breakdownHelp",
    label: "Breakdown help",
    description: "Fuel pumps and tyre or bike repair shops open along the way.",
    defaultWeight: 4,
  },
  {
    id: "roadType",
    label: "Road type",
    description: "Main roads over lanes, service roads and underpasses.",
    defaultWeight: 3,
  },
];

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(PARAMETERS.map((p) => [p.id, p.defaultWeight])) as Weights;

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly weights: Weights;
}

export const PRESETS: readonly Preset[] = [
  { id: "balanced", label: "Balanced", weights: DEFAULT_WEIGHTS },
  {
    id: "night-solo",
    label: "Riding alone at night",
    weights: { ...DEFAULT_WEIGHTS, lighting: 10, safetyStops: 10, crowd: 9, signal: 7, openShops: 6, roadType: 5 },
  },
  {
    id: "connected",
    label: "Stay connected",
    weights: { ...DEFAULT_WEIGHTS, signal: 10, safetyStops: 8, lighting: 7 },
  },
  {
    id: "low-fuel",
    label: "Low on fuel",
    weights: { ...DEFAULT_WEIGHTS, breakdownHelp: 10, essentialServices: 6 },
  },
];

export interface ScoringOptions {
  readonly darkStretchMeters: number;
  readonly maxStopGapMeters: number;
}

export const DEFAULT_OPTIONS: ScoringOptions = { darkStretchMeters: 500, maxStopGapMeters: 2000 };

const weight = z.number().min(0).max(MAX_WEIGHT);

// Unknown keys are dropped, not rejected, so profiles saved before a parameter was retired still load.
export const weightsSchema = z
  .object(Object.fromEntries(PARAMETER_IDS.map((id) => [id, weight.optional()])) as Record<ParameterId, z.ZodOptional<typeof weight>>)
  .transform((partial): Weights => ({ ...DEFAULT_WEIGHTS, ...stripUndefined(partial) }));

export const optionsSchema = z
  .object({
    darkStretchMeters: z.number().int().min(100).max(5000).optional(),
    maxStopGapMeters: z.number().int().min(500).max(20000).optional(),
  })
  .strict()
  .transform((partial): ScoringOptions => ({ ...DEFAULT_OPTIONS, ...stripUndefined(partial) }));

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
