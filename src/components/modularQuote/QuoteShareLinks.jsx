import React from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {toast} from 'sonner';
export default function QuoteShareLinks({link,pdf}) {
  async function copy(){try{await navigator.clipboard.writeText(link);toast.success('הקישור הועתק');}catch{toast.error('ניתן לסמן ולהעתיק את הקישור מהשדה');}}
  return <div className="space-y-3">{link&&<div className="rounded-lg border p-3 space-y-2"><label htmlFor="modular-share-url" className="text-sm font-medium">קישור ללקוח — כל מי שמחזיק בו יכול לצפות בהצעה</label><Input id="modular-share-url" dir="ltr" value={link} readOnly onFocus={e=>e.target.select()}/><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={copy}>העתק קישור</Button><Button variant="outline" asChild><a href={link} target="_blank" rel="noreferrer">פתח קישור</a></Button><Button variant="outline" asChild><a href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer">שתף בוואטסאפ</a></Button></div></div>}{pdf&&<div className="rounded-lg border p-3"><Button asChild><a href={pdf} target="_blank" rel="noreferrer" download>פתח / הורד PDF</a></Button><p className="text-xs text-muted-foreground mt-2">ניתן לשלוח את הקובץ לאחר ההורדה.</p></div>}</div>;
}