import React from 'react';
import {Button} from '@/components/ui/button';
import {useLanguage} from '@/i18n/LanguageProvider';

// Isolates a failed event editor from the entire Events page. Does not mutate,
// retry a network request, or create an event; the operator can dismiss safely.
export class EventFormErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state={failure:null};
  }
  static getDerivedStateFromError(error){
    return {failure:String(error?.name||'Error')};
  }
  componentDidCatch(error,info){
    // Browser diagnostics only: no Event/contact form data is logged.
    console.error('[EventForm] Render failure:',error,info?.componentStack);
  }
  render(){
    if(!this.state.failure)return this.props.children;
    return <div role="alert" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4" dir={this.props.dir||'rtl'}>
      <section className="bg-white text-gray-900 rounded-xl shadow-xl max-w-md w-full p-6 space-y-3">
        <h2 className="text-lg font-bold">{this.props.message||'לא ניתן לפתוח את טופס האירוע'}</h2>
        <p className="text-sm">{this.props.description||'אירעה תקלה בטעינת העורך. אפשר לסגור ולנסות שוב, בלי לשנות נתונים.'}</p>
        <p className="text-xs text-gray-500">Error: {this.state.failure}</p>
        <Button onClick={this.props.onClose}>{this.props.closeLabel||'סגור'}</Button>
      </section>
    </div>;
  }
}

export default function LocalizedEventFormBoundary({children,onClose}){
  const {dir,t}=useLanguage();
  return <EventFormErrorBoundary dir={dir} onClose={onClose}
    message={t('לא ניתן לפתוח את טופס האירוע')}
    description={t('אירעה תקלה בטעינת העורך. אפשר לסגור ולנסות שוב, בלי לשנות נתונים.')}
    closeLabel={t('סגור')}>{children}</EventFormErrorBoundary>;
}
