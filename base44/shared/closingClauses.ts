// Exclude card authorizations for routes where the administrator does not require a card.
export function closingClauses(clauses,requireToken,requireDeposit){
 return (clauses||[]).filter(c=>requireToken||(!["token","regular","exceptional"].includes(c.code)&&(c.code!=="fee"||requireDeposit)));
}
export function withoutCardClauses(snapshot){
 const select=clauses=>closingClauses(clauses,false,snapshot.require_deposit);
 return {...snapshot,clauses:select(snapshot.clauses),translations:snapshot.translations?Object.fromEntries(Object.entries(snapshot.translations).map(([lang,v]:[string,any])=>[lang,{...v,clauses:select(v.clauses)}])):undefined};
}