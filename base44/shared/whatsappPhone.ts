// Canonical destination parsing for person-to-person WhatsApp messages.
// A syntactically valid E.164 number is NOT proof of WhatsApp registration.
// Group JIDs are intentionally handled separately and never normalized here.
export type WhatsAppPhoneResult = {
  status:'VALID'|'INVALID'|'NEEDS_COUNTRY_CODE';
  reason:string;
  canonicalE164:string;
  digits:string;
  chatId:string;
};
const valid=(digits:string):WhatsAppPhoneResult=>({
  status:'VALID',reason:'OK',canonicalE164:'+'+digits,
  digits,chatId:digits+'@c.us'
});
const bad=(status:'INVALID'|'NEEDS_COUNTRY_CODE',reason:string):WhatsAppPhoneResult=>({
  status,reason,canonicalE164:'',digits:'',chatId:''
});
export function parseWhatsAppPhone(phone:any):WhatsAppPhoneResult {
  const raw=String(phone??'').trim();
  if(!raw)return bad('INVALID','EMPTY');
  // Do not silently strip an extension, a second phone, a group, or a URL
  // into a different recipient. Display formatting may contain separators.
  if(raw.length>45 || !/^[+0-9\s().-]+$/.test(raw) ||
    (raw.match(/\+/g)||[]).length>1 || (raw.includes('+')&&!raw.startsWith('+')))
    return bad('INVALID','UNSUPPORTED_CHARACTERS');
  const compact=raw.replace(/[\s().-]/g,'');
  if(!/^\+?\d+$/.test(compact))return bad('INVALID','INVALID_CHARACTERS');
  const explicitInternational=compact.startsWith('+')||compact.startsWith('00');
  let digits=compact.startsWith('+')?compact.slice(1):compact.startsWith('00')?compact.slice(2):compact;
  if(!digits||digits.startsWith('0')&&explicitInternational)return bad('INVALID','INVALID_COUNTRY_CODE');
  if(!explicitInternational){
    // Israel's domestic mobile and national telephone formats are the only
    // ones inferred without a country code; foreign trunk-0 is ambiguous.
    if(/^05\d{8}$/.test(digits)||/^0[2-9]\d{7}$/.test(digits))digits='972'+digits.slice(1);
    else if(/^5\d{8}$/.test(digits))digits='972'+digits;
    else if(digits.startsWith('0'))return bad('NEEDS_COUNTRY_CODE','COUNTRY_CODE_REQUIRED');
    else if(digits.startsWith('9720'))return bad('INVALID','INVALID_ISRAEL_TRUNK');
    else if(!/^972[1-9]\d{7,9}$/.test(digits) &&
      !/^1\d{10}$/.test(digits) &&
      !/^44\d{9,10}$/.test(digits) &&
      !/^33\d{9}$/.test(digits) &&
      !/^49\d{7,12}$/.test(digits) &&
      !/^91\d{10}$/.test(digits))
      return bad('NEEDS_COUNTRY_CODE','COUNTRY_CODE_REQUIRED');
  }
  // E.164 maximum is fifteen digits; the low bound is a syntactic guard,
  // not country-specific validation or confirmation of recipient identity.
  if(!/^[1-9]\d{7,14}$/.test(digits))return bad('INVALID','INVALID_LENGTH');
  if(/^9720/.test(digits))return bad('INVALID','INVALID_ISRAEL_TRUNK');
  return valid(digits);
}
