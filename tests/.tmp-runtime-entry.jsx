import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import EventForm from '../src/components/events/EventForm.jsx';
import {LanguageProvider} from '../src/i18n/LanguageProvider.jsx';
const queryClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
const root=createRoot(document.getElementById('root'));
root.render(<MemoryRouter><QueryClientProvider client={queryClient}><LanguageProvider><EventForm isOpen={true} event={null} onClose={()=>{}} onSave={()=>{}} /></LanguageProvider></QueryClientProvider></MemoryRouter>);
