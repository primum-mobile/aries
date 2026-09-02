export const STEP_CADENCE_SCHEMA_VERSION: number;

export type StepCadenceSnapshot = {
  schemaVersion: number;
  counters: Record<string, number>;
  outcomes: Record<string, number>;
  capabilities: Record<string, boolean>;
};

export type StepCadenceCollector = {
  recordRawInput(input: { inputId: number; at: number; docId?: string | null }): void;
  beginBurst(): void;
  recordIntent(input: { appliedInputs?: number }): void;
  recordCanvas(input: {
    inputIds?: number[];
    appliedInputs?: number;
    intentAt?: number | null;
    at: number;
    docId?: string | null;
    displayDatetime?: string | null;
  }): void;
  recordBoundary(input: {
    inputIds?: number[];
    appliedInputs?: number;
    intentAt?: number | null;
    canvasAt: number;
    nextFrameAt: number | null;
    postRenderAt: number | null;
    secondFrameAt: number | null;
    nextFrameTimestamp?: number | null;
    secondFrameTimestamp?: number | null;
    postRenderOrder?: number | null;
    secondFrameOrder?: number | null;
    docId?: string | null;
  }): void;
  recordSessionChange(input: {
    at: number;
    docId?: string | null;
    displayDatetime?: string | null;
    duringBurst?: boolean;
  }): void;
  recordSettleStart(input?: { duringBurst?: boolean }): void;
  recordBoundaryTimeout(inputIds?: number[]): void;
  resolveInputsWithoutBoundary(inputIds?: number[], outcome?: string): void;
  recordLongTask(input: { duration: number; at: number }): void;
  setCapability(name: string, value: boolean): void;
  snapshot(): StepCadenceSnapshot;
  reset(): void;
};

export function createStepCadenceCollector(options?: {
  maxTrackedInputs?: number;
  onSample?: (name: string, value: number, at: number) => void;
}): StepCadenceCollector;
