import test from 'node:test';
import assert from 'node:assert/strict';
import {englishQuoteIssuesFromError,englishQuoteVisibleSamplesFromError} from '../src/i18n/englishQuoteIssues.js';

test('422 quote translation error reveals exact IDs for event and services',()=>{
 const e={response:{status:422,data:{
  error:'The English quote has 2 untranslated or outdated content fields.',
  fields:['event.child_name','service.es01.package_description']
 }}};
 assert.deepEqual(englishQuoteIssuesFromError(e),[
  'event.child_name','service.es01.package_description']);
});
test('non-English errors cannot be mislabeled as translation issues',()=>{
 assert.equal(englishQuoteIssuesFromError({response:{status:500,
  data:{error:'Temporary PDF service failure'}}}),null);
});
test('missing backend details returns empty issue list but opens review dialog',()=>{
 const e={response:{status:422,data:{error:'The English quote has 1 untranslated or outdated content fields.'}}};
 assert.deepEqual(englishQuoteIssuesFromError(e),[]);
});
test('duplicate and malformed fields are filtered',()=>{
 const e={response:{status:422,data:{fields:['event.child_name','event.child_name',{},'']}}};
 assert.deepEqual(englishQuoteIssuesFromError(e),['event.child_name','']);
});
