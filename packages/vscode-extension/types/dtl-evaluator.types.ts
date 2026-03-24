export interface DtlObject {
  [key: string]: DtlValue;
}

export type DtlValue = string | number | boolean | null | DtlValue[] | DtlObject;

export type EvalEntity = DtlObject;

export type EvalStatus = "ok" | "discarded" | "error";

export interface EvalResult {
  status: EvalStatus;
  output: EvalEntity;
  warnings: string[];
}

export interface EvalContext {
  source: DtlObject;
  target: DtlObject;
  current?: DtlValue; // _
  parent?: DtlObject; // _P
  warnings: string[];
}
