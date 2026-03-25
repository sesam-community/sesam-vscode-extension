export interface ValidatorOptions {
  maxProblems: number;
  validateUnknownFunctions: boolean;
  validateArgCount: boolean;
  validateJsonSyntax: boolean;
  validateDtlStructure: boolean;
  validateTransformInExpression: boolean;
  validatePathExpressions: boolean;
  /** Rule names declared in the current document, used for apply/apply-hops validation */
  ruleNames: Set<string>;
}
