export interface ValidatorOptions {
  maxProblems: number;
  validateUnknownFunctions: boolean;
  validateArgCount: boolean;
  validateJsonSyntax: boolean;
  validateDtlStructure: boolean;
  validateTransformInExpression: boolean;
  validatePathExpressions: boolean;
  /** Phase E: missing _id / type / source on pipe and system configs */
  validateConfigStructure: boolean;
  /** Rule names declared in the current document, used for apply/apply-hops validation */
  ruleNames: Set<string>;
}
