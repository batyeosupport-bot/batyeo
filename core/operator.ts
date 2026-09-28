/** Legal identity of whoever operates the service, shown on /terms and /privacy. Read from the deployment
 *  so a change of legal entity (micro-entreprise today, SASU later) is a variable change, not a release. */
export interface OperatorIdentity {
 name:string|null; legalForm:string|null; siret:string|null; address:string|null; email:string|null; phone:string|null;
 mediatorName:string|null; mediatorUrl:string|null;
 /** Everything the consumer code requires on the page is present: identity, SIRET, address, contact, mediator. */
 complete:boolean;
}
export function resolveOperator(env:Record<string,string|undefined>):OperatorIdentity {
 const v=(k:string)=>env[k]?.trim()||null;
 const o={name:v('OPERATOR_NAME'),legalForm:v('OPERATOR_LEGAL_FORM'),siret:v('OPERATOR_SIRET'),address:v('OPERATOR_ADDRESS'),email:v('OPERATOR_EMAIL'),phone:v('OPERATOR_PHONE'),mediatorName:v('OPERATOR_MEDIATOR_NAME'),mediatorUrl:v('OPERATOR_MEDIATOR_URL')};
 return {...o,complete:Boolean(o.name&&o.siret&&o.address&&o.email&&o.mediatorName&&o.mediatorUrl)};
}
