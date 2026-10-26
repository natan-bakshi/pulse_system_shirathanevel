// PURE local comparison for a FUTURE Green webhook architecture.
// Reference assumption (subject to change): Base44's Credits docs say
// backend functions use APPROXIMATELY 1 integration credit / 100 invocations.
// It is NOT a workspace bill and excludes ALL provider/edge/database costs.
// No Base44 SDK calls, no timers, no network, no persistent state.
const positiveInteger=(n,max=1_000_000)=>
 Number.isSafeInteger(n)&&n>=0&&n<=max;
const precision=n=>Math.round((n+Number.EPSILON)*100)/100;
export function estimateGreenWebhookInvocationCredits({
 incomingEventsPerDay,buttonClicksPerDay,unknownEventsPerDay=0,
 days=30,invocationsPerCredit=100
}={}){
 const incoming=Number(incomingEventsPerDay),buttons=Number(buttonClicksPerDay),
  unknown=Number(unknownEventsPerDay),period=Number(days),ratio=Number(invocationsPerCredit);
 if(!positiveInteger(incoming)||!positiveInteger(buttons)||
  !positiveInteger(unknown)||buttons+unknown>incoming||
  !positiveInteger(period,366)||period===0||
  !positiveInteger(ratio,1_000_000)||ratio===0)
  throw Error('Invalid documented webhook forecast assumptions');
 const directInvocations=incoming*period;
 // A gateway MUST NOT silently discard unrecognized beta callback types:
 // unknown events stay on the backend investigation path, not the trash.
 const forwardedInvocations=(buttons+unknown)*period;
 return {
  scenario:'planning_estimate_only',
  days:period,assumedInvocationsPerCredit:ratio,
  directBase44Invocations:directInvocations,
  filteredGatewayBase44Invocations:forwardedInvocations,
  directEstimatedCredits:precision(directInvocations/ratio),
  gatewayEstimatedBase44Credits:precision(forwardedInvocations/ratio),
  backendCreditsPotentiallyAvoided:precision((directInvocations-forwardedInvocations)/ratio),
  filteredKnownNonButtonsPerMonth:(incoming-buttons-unknown)*period,
  unknownEventsMustBeForwarded:true,
  externalGatewayCostsExcluded:true,
  providerMessageChargesExcluded:true,
  databaseResourceCostsExcluded:true,
  actualWorkspaceUsageNotMeasured:true,
  providerWebhookNotEnabled:true,
  noNetworkCalls:true
 };
}
