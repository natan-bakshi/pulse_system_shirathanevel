export const israelDateTime=value=>value?new Intl.DateTimeFormat("he-IL",{timeZone:"Asia/Jerusalem",dateStyle:"short",timeStyle:"short"}).format(new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(String(value))?value:String(value)+"Z")):"";
export const israelDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))?String(value).split("-").reverse().join("."):value||"";
